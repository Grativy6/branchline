"""Transactional, hash-chained persistence for bounded Hearthline records."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Mapping

MAX_JSON_CHARS = 100_000
MAX_JSON_DEPTH = 16
MAX_RECORDS = 100_000

class StoreIntegrityError(ValueError):
    code = "UNTRUSTED_STORAGE"

def _depth(value: Any, level: int = 0) -> int:
    if level > MAX_JSON_DEPTH:
        raise ValueError("JSON nesting exceeds the bounded limit")
    if isinstance(value, Mapping):
        return max([level] + [_depth(v, level + 1) for v in value.values()])
    if isinstance(value, list):
        return max([level] + [_depth(v, level + 1) for v in value])
    return level

def canonical_json(value: Any) -> str:
    _depth(value)
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(encoded) > MAX_JSON_CHARS:
        raise ValueError("JSON exceeds the bounded size")
    return encoded

def sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()

def scoped_namespace(adapter: str, user: str, root: str | Path, namespace: str = "public") -> str:
    parts = tuple(str(x) for x in (adapter, user, Path(root).resolve(), namespace))
    raw = "".join(f"{len(part)}:{part};" for part in parts)
    return "scope-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()

class SharedScopedStore:
    def __init__(self, root: str | Path, namespace: str = "public", *, adapter: str = "hearthline", user: str = "default") -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.namespace = scoped_namespace(adapter, user, self.root, namespace)
        self._lock = threading.RLock()
        self._db = self.root / ".hearthline-store.sqlite3"
        self._init()

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self._db, timeout=30, isolation_level=None)
        con.execute("PRAGMA busy_timeout=30000")
        deadline = time.monotonic() + 10
        while True:
            try:
                con.execute("PRAGMA journal_mode=WAL")
                break
            except sqlite3.OperationalError as exc:
                if (getattr(exc, "sqlite_errorcode", 0) & 255) not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) or time.monotonic() >= deadline:
                    con.close()
                    raise
                time.sleep(0.02)
        return con

    def _init(self) -> None:
        with closing(self._connect()) as con:
            con.execute("CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, seq INTEGER NOT NULL, record_hash TEXT NOT NULL, prev_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace, seq), UNIQUE(namespace, record_hash))")

    @property
    def path(self) -> Path:
        return self._db

    def _snapshot(self):
        # Verify and return the same SELECT snapshot, even if another helper
        # appends immediately afterward. A second query could pair newer rows
        # with an older head and spuriously reject the next revision.
        with closing(self._connect()) as con:
            rows = con.execute("SELECT seq,record_hash,prev_hash,payload FROM records WHERE namespace=? ORDER BY seq", (self.namespace,)).fetchall()
        previous = "GENESIS"
        for expected, (seq, record_hash, prev_hash, payload) in enumerate(rows, 1):
            if seq != expected or prev_hash != previous:
                raise StoreIntegrityError("sequence or previous-hash mismatch")
            try:
                obj = json.loads(payload, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))
                if canonical_json(obj) != payload or sha256_text(prev_hash + "\n" + payload) != record_hash:
                    raise StoreIntegrityError("record hash mismatch")
            except (json.JSONDecodeError, ValueError, TypeError) as exc:
                raise StoreIntegrityError(str(exc)) from exc
            previous = record_hash
        return rows, {"trusted": True, "status": "VALID", "records": len(rows), "head": previous}

    def verify(self) -> dict[str, Any]:
        try:
            return self._snapshot()[1]
        except StoreIntegrityError as exc:
            return {"trusted": False, "status": "UNTRUSTED_STORAGE", "error": str(exc), "namespace": self.namespace}

    def read(self) -> dict[str, Any]:
        rows, check = self._snapshot()
        return {"records": [json.loads(row[3]) for row in rows], "head": check["head"], "namespace": self.namespace}

    def append(self, record: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(record, dict):
            raise TypeError("record must be an object")
        payload = canonical_json(record)
        with self._lock, closing(self._connect()) as con:
            con.execute("BEGIN IMMEDIATE")
            rows = con.execute("SELECT seq,record_hash,prev_hash,payload FROM records WHERE namespace=? ORDER BY seq", (self.namespace,)).fetchall()
            previous = "GENESIS"
            for expected, (seq, record_hash, prev_hash, old_payload) in enumerate(rows, 1):
                if seq != expected or prev_hash != previous or sha256_text(prev_hash + "\n" + old_payload) != record_hash:
                    con.rollback(); raise StoreIntegrityError("untrusted storage")
                previous = record_hash
            seq = len(rows) + 1
            if seq > MAX_RECORDS:
                con.rollback(); raise ValueError("store record limit exceeded")
            record_hash = sha256_text(previous + "\n" + payload)
            con.execute("INSERT INTO records(namespace,seq,record_hash,prev_hash,payload) VALUES(?,?,?,?,?)", (self.namespace, seq, record_hash, previous, payload))
            con.commit()
        return {**record, "_store_seq": seq, "_store_hash": record_hash, "_store_prev": previous}

    def append_if_head(self, expected_head: str, record: dict[str, Any]) -> dict[str, Any] | None:
        """Atomically append only if the observed chain head is still current."""
        if not isinstance(record, dict):
            raise TypeError("record must be an object")
        payload = canonical_json(record)
        with self._lock, closing(self._connect()) as con:
            con.execute("BEGIN IMMEDIATE")
            rows = con.execute("SELECT seq,record_hash,prev_hash,payload FROM records WHERE namespace=? ORDER BY seq", (self.namespace,)).fetchall()
            previous = "GENESIS"
            for expected, (seq, record_hash, prev_hash, old_payload) in enumerate(rows, 1):
                if seq != expected or prev_hash != previous or sha256_text(prev_hash + "\n" + old_payload) != record_hash:
                    con.rollback(); raise StoreIntegrityError("untrusted storage")
                previous = record_hash
            actual = previous
            if actual != expected_head:
                con.rollback(); return None
            seq = len(rows) + 1
            if seq > MAX_RECORDS:
                con.rollback(); raise ValueError("store record limit exceeded")
            record_hash = sha256_text(actual + "\n" + payload)
            con.execute("INSERT INTO records(namespace,seq,record_hash,prev_hash,payload) VALUES(?,?,?,?,?)", (self.namespace, seq, record_hash, actual, payload))
            con.commit()
        return {**record, "_store_seq": seq, "_store_hash": record_hash, "_store_prev": actual}

    def export(self) -> dict[str, Any]:
        return {"format": "hearthline-store-v1", **self.read()}

class ScopedStore(SharedScopedStore):
    """Compatibility name retained for the existing server surface."""
