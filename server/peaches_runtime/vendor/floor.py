"""Stateless verification primitives for the PEACHES floor.

This module deliberately has no database, append operation, global sequence,
checker identity, key generation, or checker signature.  Issuers construct an
unsigned body, sign the bytes returned by :func:`issuer_signature_message`, and
attach that signature with :func:`prepare_floor_stamp`.

A positive verification result is narrow: the supplied object has the frozen
shape, its content-derived values agree, and the signature validates under the
public key carried by that object.  It does not establish who controlled that
key, the truth of the declaration or either time, or any authority, consent,
ethics, standing, legal effect, priority, or admission by a Book.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from datetime import datetime
from typing import Any, Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


FLOOR = "peaches.floor/1"
STAMP_SCHEMA = "peaches.floor.stamp/1"
OBSERVATION_SCHEMA = "peaches.floor.observation/1"

SAFE_INTEGER_MAX = 2**53 - 1
MAX_JSON_BYTES = 1_000_000
MAX_JSON_DEPTH = 32
MAX_JSON_ITEMS = 10_000

_ISSUER_DOMAIN = b"PEACHES-ISSUER-ID-V1\x00"
_STAMP_ID_DOMAIN = b"PEACHES-STAMP-ID-V1\x00"
_STAMP_SIGNATURE_DOMAIN = b"PEACHES-STAMP-SIGNATURE-V1\x00"
_OBSERVATION_ID_DOMAIN = b"PEACHES-OBSERVATION-ID-V1\x00"
_RUBRIC_ID_DOMAIN = b"PEACHES-RUBRIC-ID-V1\x00"

# RFC 8032 / Edwards25519 constants.  The backend signature check is preceded
# by explicit point and scalar validation because some Ed25519 providers accept
# small-order identity encodings under a relaxed verification equation.
_ED25519_P = 2**255 - 19
_ED25519_L = 2**252 + 27742317777372353535851937790883648493
_ED25519_D = (-121665 * pow(121666, _ED25519_P - 2, _ED25519_P)) % _ED25519_P
_ED25519_SQRT_M1 = pow(2, (_ED25519_P - 1) // 4, _ED25519_P)

_STAMP_FIELDS = frozenset({
    "schema",
    "floor",
    "issuer",
    "declaration",
    "claimed_at",
    "nonce",
    "rubric_id",
    "stamp_id",
    "signature",
})
_UNSIGNED_FIELDS = _STAMP_FIELDS - frozenset({"stamp_id", "signature"})
_ISSUER_FIELDS = frozenset({"key_type", "public_key", "issuer_id"})
_CONTENT_FIELDS = frozenset({"media_type", "bytes", "sha256"})
_SIGNATURE_FIELDS = frozenset({"suite", "value"})
_OBSERVATION_FIELDS = frozenset({
    "schema",
    "floor",
    "stamp_id",
    "observed_no_later_than",
    "method_id",
    "evidence",
    "observation_id",
})
_OBSERVATION_CORE_FIELDS = _OBSERVATION_FIELDS - frozenset({"observation_id"})

_B64URL_RE = re.compile(r"^[A-Za-z0-9_-]*$")
_STAMP_ID_RE = re.compile(r"^peaches:stamp:v1:[0-9a-f]{64}$")
_RUBRIC_ID_RE = re.compile(r"^peaches:rubric:v1:[0-9a-f]{64}$")
_UTC_SECONDS_RE = re.compile(
    r"^(?P<year>[0-9]{4})-(?P<month>[0-9]{2})-(?P<day>[0-9]{2})"
    r"T(?P<hour>[0-9]{2}):(?P<minute>[0-9]{2}):(?P<second>[0-9]{2})Z$"
)


class FloorError(ValueError):
    """Raised when a value cannot conform to the frozen floor format."""


def _valid_scalar_string(value: str, *, label: str = "string") -> str:
    if not isinstance(value, str):
        raise FloorError(f"{label}_must_be_string")
    if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise FloorError(f"{label}_contains_non_scalar_unicode")
    return value


def _utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be")


def _canonical_value(value: Any, depth: int, counter: list[int]) -> Any:
    if depth > MAX_JSON_DEPTH:
        raise FloorError("maximum_json_depth_exceeded")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        # bool is checked first because bool is a subclass of int in Python.
        if value < -SAFE_INTEGER_MAX or value > SAFE_INTEGER_MAX:
            raise FloorError("integer_out_of_safe_range")
        return value
    if isinstance(value, float):
        raise FloorError("floats_are_not_permitted")
    if isinstance(value, str):
        return _valid_scalar_string(value)
    if isinstance(value, Mapping):
        counter[0] += len(value)
        if counter[0] > MAX_JSON_ITEMS:
            raise FloorError("maximum_json_items_exceeded")
        keys = list(value.keys())
        if any(not isinstance(key, str) for key in keys):
            raise FloorError("object_keys_must_be_strings")
        for key in keys:
            _valid_scalar_string(key, label="object_key")
        return {
            key: _canonical_value(value[key], depth + 1, counter)
            for key in sorted(keys, key=_utf16_sort_key)
        }
    if isinstance(value, list):
        counter[0] += len(value)
        if counter[0] > MAX_JSON_ITEMS:
            raise FloorError("maximum_json_items_exceeded")
        return [_canonical_value(item, depth + 1, counter) for item in value]
    raise FloorError(f"unsupported_json_type:{type(value).__name__}")


def canonical_bytes(value: Any) -> bytes:
    """Encode a value using the bounded ``PEACHES-CJSON-1`` profile.

    The profile is the integer-only subset of RFC 8785/JCS used by the floor:
    valid Unicode-scalar JSON strings, UTF-16 object-key ordering, compact
    UTF-8, and no BOM.  Strings are preserved exactly and never normalized.
    """

    canonical = _canonical_value(value, 0, [0])
    try:
        encoded = json.dumps(
            canonical,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, UnicodeError, ValueError) as exc:
        raise FloorError("canonical_json_encoding_failed") from exc
    if len(encoded) > MAX_JSON_BYTES:
        raise FloorError("maximum_json_bytes_exceeded")
    return encoded


def _parse_int(text: str) -> int:
    if text == "-0":
        raise FloorError("negative_zero_is_not_permitted")
    try:
        value = int(text)
    except ValueError as exc:
        raise FloorError("invalid_integer") from exc
    if value < -SAFE_INTEGER_MAX or value > SAFE_INTEGER_MAX:
        raise FloorError("integer_out_of_safe_range")
    return value


def _reject_float(_: str) -> None:
    raise FloorError("floats_are_not_permitted")


def _reject_constant(_: str) -> None:
    raise FloorError("non_finite_numbers_are_not_permitted")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise FloorError(f"duplicate_json_key:{key}")
        result[key] = value
    return result


def strict_json_loads(data: str | bytes | bytearray) -> Any:
    """Parse JSON while rejecting duplicate keys before map construction."""

    if isinstance(data, (bytes, bytearray)):
        raw = bytes(data)
        if len(raw) > MAX_JSON_BYTES:
            raise FloorError("maximum_json_bytes_exceeded")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise FloorError("json_must_be_utf8") from exc
    elif isinstance(data, str):
        try:
            raw = data.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise FloorError("json_contains_non_scalar_unicode") from exc
        if len(raw) > MAX_JSON_BYTES:
            raise FloorError("maximum_json_bytes_exceeded")
        text = data
    else:
        raise FloorError("json_input_must_be_text_or_bytes")
    try:
        value = json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_int=_parse_int,
            parse_float=_reject_float,
            parse_constant=_reject_constant,
        )
    except FloorError:
        raise
    except (json.JSONDecodeError, UnicodeError, ValueError, RecursionError) as exc:
        raise FloorError("invalid_json") from exc
    # Apply depth, item-count, Unicode, integer, and canonical-size limits.
    canonical_bytes(value)
    return value


def _sha256_hex(prefix: bytes, payload: bytes) -> str:
    return hashlib.sha256(prefix + payload).hexdigest()


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(value: Any, *, label: str, length: int | None = None) -> bytes:
    if not isinstance(value, str) or not _B64URL_RE.fullmatch(value):
        raise FloorError(f"{label}_must_be_unpadded_base64url")
    try:
        decoded = base64.b64decode(
            value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
        )
    except (ValueError, TypeError) as exc:
        raise FloorError(f"{label}_must_be_unpadded_base64url") from exc
    if _b64url_encode(decoded) != value:
        raise FloorError(f"{label}_must_be_canonical_base64url")
    if length is not None and len(decoded) != length:
        raise FloorError(f"{label}_must_decode_to_{length}_bytes")
    return decoded


def _ed25519_add(
    left: tuple[int, int, int, int], right: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    """Add Edwards25519 points represented in extended coordinates."""

    x1, y1, z1, t1 = left
    x2, y2, z2, t2 = right
    a = ((y1 - x1) * (y2 - x2)) % _ED25519_P
    b = ((y1 + x1) * (y2 + x2)) % _ED25519_P
    c = (2 * _ED25519_D * t1 * t2) % _ED25519_P
    d = (2 * z1 * z2) % _ED25519_P
    e = (b - a) % _ED25519_P
    f = (d - c) % _ED25519_P
    g = (d + c) % _ED25519_P
    h = (b + a) % _ED25519_P
    return (
        (e * f) % _ED25519_P,
        (g * h) % _ED25519_P,
        (f * g) % _ED25519_P,
        (e * h) % _ED25519_P,
    )


def _ed25519_double(
    point: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    x, y, z, _ = point
    a = (x * x) % _ED25519_P
    b = (y * y) % _ED25519_P
    c = (2 * z * z) % _ED25519_P
    d = (-a) % _ED25519_P
    e = ((x + y) * (x + y) - a - b) % _ED25519_P
    g = (d + b) % _ED25519_P
    f = (g - c) % _ED25519_P
    h = (d - b) % _ED25519_P
    return (
        (e * f) % _ED25519_P,
        (g * h) % _ED25519_P,
        (f * g) % _ED25519_P,
        (e * h) % _ED25519_P,
    )


def _ed25519_multiply(
    scalar: int, point: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    result = (0, 1, 1, 0)
    addend = point
    while scalar:
        if scalar & 1:
            result = _ed25519_add(result, addend)
        addend = _ed25519_double(addend)
        scalar >>= 1
    return result


def _ed25519_is_identity(point: tuple[int, int, int, int]) -> bool:
    x, y, z, _ = point
    return (
        z % _ED25519_P != 0
        and x % _ED25519_P == 0
        and (y - z) % _ED25519_P == 0
    )


def _decode_ed25519_point(
    encoded: bytes, *, label: str, reject_identity: bool
) -> tuple[int, int, int, int]:
    """Strictly decode a canonical prime-subgroup Edwards25519 point."""

    if len(encoded) != 32:
        raise FloorError(f"{label}_must_be_32_bytes")
    encoded_integer = int.from_bytes(encoded, "little")
    x_sign = encoded_integer >> 255
    y = encoded_integer & ((1 << 255) - 1)
    if y >= _ED25519_P:
        raise FloorError(f"{label}_noncanonical_y")

    y_squared = (y * y) % _ED25519_P
    numerator = (y_squared - 1) % _ED25519_P
    denominator = (_ED25519_D * y_squared + 1) % _ED25519_P
    if denominator == 0:
        raise FloorError(f"{label}_not_on_curve")
    x_squared = (numerator * pow(denominator, _ED25519_P - 2, _ED25519_P)) % _ED25519_P
    x = pow(x_squared, (_ED25519_P + 3) // 8, _ED25519_P)
    if (x * x - x_squared) % _ED25519_P != 0:
        x = (x * _ED25519_SQRT_M1) % _ED25519_P
    if (x * x - x_squared) % _ED25519_P != 0:
        raise FloorError(f"{label}_not_on_curve")
    if x == 0 and x_sign == 1:
        raise FloorError(f"{label}_noncanonical_x_sign")
    if (x & 1) != x_sign:
        x = (-x) % _ED25519_P

    canonical = (y | ((x & 1) << 255)).to_bytes(32, "little")
    if canonical != encoded:
        raise FloorError(f"{label}_noncanonical_encoding")
    point = (x, y, 1, (x * y) % _ED25519_P)
    if reject_identity and _ed25519_is_identity(point):
        raise FloorError(f"{label}_identity_not_permitted")
    if not _ed25519_is_identity(_ed25519_multiply(_ED25519_L, point)):
        raise FloorError(f"{label}_not_prime_subgroup")
    return point


def _validate_ed25519_signature_encoding(public_key: bytes, signature: bytes) -> None:
    _decode_ed25519_point(
        public_key, label="issuer_public_key", reject_identity=True
    )
    _decode_ed25519_point(signature[:32], label="signature_R", reject_identity=False)
    if int.from_bytes(signature[32:], "little") >= _ED25519_L:
        raise FloorError("signature_S_noncanonical")


def _require_exact_fields(
    value: Any, fields: frozenset[str], *, label: str
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise FloorError(f"{label}_must_be_object")
    if any(not isinstance(key, str) for key in value.keys()):
        raise FloorError(f"{label}_keys_must_be_strings")
    actual = set(value.keys())
    if actual != fields:
        missing = sorted(fields - actual)
        extra = sorted(actual - fields)
        detail = []
        if missing:
            detail.append("missing=" + ",".join(missing))
        if extra:
            detail.append("extra=" + ",".join(str(key) for key in extra))
        raise FloorError(f"{label}_fields:" + ";".join(detail))
    return value


def _validate_timestamp(value: Any, *, label: str) -> datetime:
    if not isinstance(value, str):
        raise FloorError(f"{label}_must_be_canonical_utc_seconds")
    match = _UTC_SECONDS_RE.fullmatch(value)
    if not match:
        raise FloorError(f"{label}_must_be_canonical_utc_seconds")
    parts = {name: int(number) for name, number in match.groupdict().items()}
    if parts["year"] == 0:
        raise FloorError(f"{label}_must_be_valid_gregorian_date")
    try:
        return datetime(
            parts["year"],
            parts["month"],
            parts["day"],
            parts["hour"],
            parts["minute"],
            parts["second"],
        )
    except ValueError as exc:
        raise FloorError(f"{label}_must_be_valid_gregorian_date") from exc


def _validate_media_type(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 255
        or any(ord(char) < 0x20 or ord(char) > 0x7E for char in value)
    ):
        raise FloorError("media_type_must_be_1_to_255_printable_ascii")
    return value


def _content_object(exact_bytes: bytes, media_type: str) -> dict[str, str]:
    if not isinstance(exact_bytes, bytes):
        raise FloorError("content_must_be_bytes")
    return {
        "media_type": _validate_media_type(media_type),
        "bytes": _b64url_encode(exact_bytes),
        "sha256": "sha256:" + hashlib.sha256(exact_bytes).hexdigest(),
    }


def _validate_content(value: Any, *, label: str) -> bytes:
    content = _require_exact_fields(value, _CONTENT_FIELDS, label=label)
    _validate_media_type(content["media_type"])
    exact_bytes = _b64url_decode(content["bytes"], label=f"{label}_bytes")
    expected = "sha256:" + hashlib.sha256(exact_bytes).hexdigest()
    if content["sha256"] != expected:
        raise FloorError(f"{label}_sha256_mismatch")
    return exact_bytes


def derive_issuer_id(public_key: bytes) -> str:
    """Return the v1 content-derived identifier for an Ed25519 public key."""

    if not isinstance(public_key, bytes) or len(public_key) != 32:
        raise FloorError("public_key_must_be_32_bytes")
    return "peaches:issuer:v1:" + _sha256_hex(_ISSUER_DOMAIN, public_key)


def derive_stamp_id(unsigned_body: Mapping[str, Any]) -> str:
    """Return the v1 content-derived identifier for an unsigned stamp body."""

    body, _ = _validate_unsigned_stamp(unsigned_body)
    return "peaches:stamp:v1:" + _sha256_hex(
        _STAMP_ID_DOMAIN, canonical_bytes(body)
    )


def derive_rubric_id(media_type: str, rubric_bytes: bytes) -> str:
    """Return the v1 identifier for supplied, detached rubric bytes."""

    if not isinstance(rubric_bytes, bytes):
        raise FloorError("rubric_must_be_bytes")
    media_type = _validate_media_type(media_type)
    payload = media_type.encode("ascii") + b"\x00" + rubric_bytes
    return "peaches:rubric:v1:" + _sha256_hex(_RUBRIC_ID_DOMAIN, payload)


def prepare_unsigned_stamp(
    *,
    public_key: bytes,
    declaration: bytes,
    media_type: str,
    claimed_at: str,
    nonce: bytes,
    rubric_id: str | None = None,
) -> dict[str, Any]:
    """Construct the exact unsigned v1 body without generating or using a key."""

    if not isinstance(public_key, bytes) or len(public_key) != 32:
        raise FloorError("public_key_must_be_32_bytes")
    if not isinstance(nonce, bytes) or len(nonce) != 32:
        raise FloorError("nonce_must_be_32_bytes")
    body: dict[str, Any] = {
        "schema": STAMP_SCHEMA,
        "floor": FLOOR,
        "issuer": {
            "key_type": "Ed25519",
            "public_key": _b64url_encode(public_key),
            "issuer_id": derive_issuer_id(public_key),
        },
        "declaration": _content_object(declaration, media_type),
        "claimed_at": claimed_at,
        "nonce": _b64url_encode(nonce),
        "rubric_id": rubric_id,
    }
    _validate_unsigned_stamp(body)
    return body


def _validate_unsigned_stamp(value: Any) -> tuple[Mapping[str, Any], bytes]:
    body = _require_exact_fields(value, _UNSIGNED_FIELDS, label="unsigned_stamp")
    # Enforce the full-object resource bound before decoding any attacker-sized
    # Base64 member supplied through the direct Mapping API.
    canonical_bytes(body)
    if body["schema"] != STAMP_SCHEMA:
        raise FloorError("unsupported_stamp_schema")
    if body["floor"] != FLOOR:
        raise FloorError("unsupported_floor")

    issuer = _require_exact_fields(body["issuer"], _ISSUER_FIELDS, label="issuer")
    if issuer["key_type"] != "Ed25519":
        raise FloorError("unsupported_issuer_key_type")
    public_key = _b64url_decode(
        issuer["public_key"], label="issuer_public_key", length=32
    )
    if issuer["issuer_id"] != derive_issuer_id(public_key):
        raise FloorError("issuer_id_mismatch")

    _validate_content(body["declaration"], label="declaration")
    _validate_timestamp(body["claimed_at"], label="claimed_at")
    _b64url_decode(body["nonce"], label="nonce", length=32)
    rubric_id = body["rubric_id"]
    if rubric_id is not None and (
        not isinstance(rubric_id, str) or not _RUBRIC_ID_RE.fullmatch(rubric_id)
    ):
        raise FloorError("rubric_id_must_be_null_or_content_addressed")
    return body, public_key


def issuer_signature_message(unsigned_body: Mapping[str, Any]) -> bytes:
    """Return the domain-separated bytes an issuer may choose to sign."""

    body, _ = _validate_unsigned_stamp(unsigned_body)
    return _STAMP_SIGNATURE_DOMAIN + canonical_bytes(body)


def prepare_floor_stamp(
    unsigned_body: Mapping[str, Any], signature: bytes
) -> dict[str, Any]:
    """Attach an already-created issuer signature to a validated body.

    This function never generates a key or signs on an issuer's behalf.
    """

    body, _ = _validate_unsigned_stamp(unsigned_body)
    if not isinstance(signature, bytes) or len(signature) != 64:
        raise FloorError("signature_must_be_64_bytes")
    # Return a plain, detached JSON tree rather than aliasing caller-owned
    # nested mappings into the prepared immutable stamp.
    stamp = strict_json_loads(canonical_bytes(body))
    stamp["stamp_id"] = derive_stamp_id(body)
    stamp["signature"] = {"suite": "Ed25519", "value": _b64url_encode(signature)}
    _validate_floor_stamp(stamp)
    return stamp


def _coerce_json_object(value: Any, *, label: str) -> Mapping[str, Any]:
    if isinstance(value, (str, bytes, bytearray)):
        value = strict_json_loads(value)
    if not isinstance(value, Mapping):
        raise FloorError(f"{label}_must_be_object")
    return value


def _validate_floor_stamp(value: Any) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    stamp = _require_exact_fields(
        _coerce_json_object(value, label="stamp"), _STAMP_FIELDS, label="stamp"
    )
    canonical_bytes(stamp)
    body = {field: stamp[field] for field in _UNSIGNED_FIELDS}
    body, public_key = _validate_unsigned_stamp(body)
    expected_stamp_id = derive_stamp_id(body)
    if stamp["stamp_id"] != expected_stamp_id:
        raise FloorError("stamp_id_mismatch")

    signature = _require_exact_fields(
        stamp["signature"], _SIGNATURE_FIELDS, label="signature"
    )
    if signature["suite"] != "Ed25519":
        raise FloorError("unsupported_signature_suite")
    signature_bytes = _b64url_decode(
        signature["value"], label="signature_value", length=64
    )
    _validate_ed25519_signature_encoding(public_key, signature_bytes)
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(
            signature_bytes, _STAMP_SIGNATURE_DOMAIN + canonical_bytes(body)
        )
    except (InvalidSignature, ValueError) as exc:
        raise FloorError("issuer_signature_invalid") from exc
    return stamp, body


def derive_observation_id(core: Mapping[str, Any]) -> str:
    """Return the v1 identifier for a validated observation core."""

    core = _validate_observation_core(core)
    return "peaches:observation:v1:" + _sha256_hex(
        _OBSERVATION_ID_DOMAIN, canonical_bytes(core)
    )


def prepare_observation(
    *,
    stamp_id: str,
    observed_no_later_than: str,
    method_id: str,
    evidence: bytes,
    media_type: str,
) -> dict[str, Any]:
    """Construct detached observation evidence without interpreting its method."""

    core: dict[str, Any] = {
        "schema": OBSERVATION_SCHEMA,
        "floor": FLOOR,
        "stamp_id": stamp_id,
        "observed_no_later_than": observed_no_later_than,
        "method_id": method_id,
        "evidence": _content_object(evidence, media_type),
    }
    _validate_observation_core(core)
    observation = dict(core)
    observation["observation_id"] = derive_observation_id(core)
    canonical_bytes(observation)
    return observation


def _validate_observation_core(value: Any) -> Mapping[str, Any]:
    core = _require_exact_fields(
        value, _OBSERVATION_CORE_FIELDS, label="observation_core"
    )
    canonical_bytes(core)
    if core["schema"] != OBSERVATION_SCHEMA:
        raise FloorError("unsupported_observation_schema")
    if core["floor"] != FLOOR:
        raise FloorError("unsupported_floor")
    if not isinstance(core["stamp_id"], str) or not _STAMP_ID_RE.fullmatch(
        core["stamp_id"]
    ):
        raise FloorError("observation_stamp_id_invalid")
    _validate_timestamp(
        core["observed_no_later_than"], label="observed_no_later_than"
    )
    if not isinstance(core["method_id"], str) or not _RUBRIC_ID_RE.fullmatch(
        core["method_id"]
    ):
        raise FloorError("method_id_must_be_content_addressed")
    _validate_content(core["evidence"], label="evidence")
    return core


def verify_observation(
    value: Any,
    *,
    expected_stamp_id: str | None = None,
    claimed_at: str | None = None,
) -> dict[str, Any]:
    """Check detached evidence structure, without validating its method's claim."""

    try:
        observation = _require_exact_fields(
            _coerce_json_object(value, label="observation"),
            _OBSERVATION_FIELDS,
            label="observation",
        )
        canonical_bytes(observation)
        core = {field: observation[field] for field in _OBSERVATION_CORE_FIELDS}
        _validate_observation_core(core)
        if observation["observation_id"] != derive_observation_id(core):
            raise FloorError("observation_id_mismatch")
        if expected_stamp_id is not None and core["stamp_id"] != expected_stamp_id:
            raise FloorError("observation_stamp_id_mismatch")
        issues: list[str] = []
        if claimed_at is not None:
            claimed = _validate_timestamp(claimed_at, label="claimed_at")
            observed = _validate_timestamp(
                core["observed_no_later_than"], label="observed_no_later_than"
            )
            if observed < claimed:
                issues.append("TIME_ORDER_CONFLICT")
        return {
            "status": "ATTACHED_UNVERIFIED",
            "errors": [],
            "issues": issues,
            "observation_id": observation["observation_id"],
            "claim": "structure_digest_and_identifier_only",
            "method_validation": "outside_floor_checker",
            "time_truth": "not_established",
        }
    except (FloorError, TypeError, ValueError) as exc:
        error = str(exc) if isinstance(exc, FloorError) else "observation_validation_failed"
        return {
            "status": "INVALID_OBSERVATION",
            "errors": [error],
            "issues": [],
            "claim": "no_observation_claim",
            "method_validation": "outside_floor_checker",
            "time_truth": "not_established",
        }


def verify_floor_stamp(
    value: Any, *, observations: Sequence[Any] | None = None
) -> dict[str, Any]:
    """Verify one issuer stamp and classify optional detached observations.

    Observation failures and time-order conflicts do not alter the signed
    stamp's validity.  They are reported separately and never upgrade
    ``claimed_at`` or ``observed_no_later_than`` into an established fact.
    """

    try:
        stamp, body = _validate_floor_stamp(value)
    except (FloorError, TypeError, ValueError) as exc:
        error = str(exc) if isinstance(exc, FloorError) else "stamp_validation_failed"
        return {
            "status": "INVALID_FLOOR_STAMP",
            "errors": [error],
            "claim": "no_floor_stamp_claim",
            "claimed_at": {"syntax": "not_established", "truth": "not_established"},
            "observations": [],
        }

    if observations is None:
        observations = ()
    if isinstance(observations, (str, bytes, bytearray, Mapping)) or not isinstance(
        observations, Sequence
    ):
        observations = (observations,)
    reports = [
        verify_observation(
            observation,
            expected_stamp_id=stamp["stamp_id"],
            claimed_at=body["claimed_at"],
        )
        for observation in observations
    ]
    return {
        "status": "VALID_FLOOR_STRUCTURE_AND_SIGNATURE",
        "errors": [],
        "stamp_id": stamp["stamp_id"],
        "stamp_id_scope": "unsigned_body_only_excludes_signature",
        "issuer_id": body["issuer"]["issuer_id"],
        "claim": "structure_digest_and_presented_key_signature_only",
        "claimed_at": {"syntax": "canonical_utc_seconds", "truth": "not_established"},
        "observations": reports,
    }


__all__ = [
    "FLOOR",
    "STAMP_SCHEMA",
    "OBSERVATION_SCHEMA",
    "FloorError",
    "canonical_bytes",
    "strict_json_loads",
    "derive_issuer_id",
    "derive_stamp_id",
    "derive_rubric_id",
    "derive_observation_id",
    "prepare_unsigned_stamp",
    "issuer_signature_message",
    "prepare_floor_stamp",
    "prepare_observation",
    "verify_observation",
    "verify_floor_stamp",
]
