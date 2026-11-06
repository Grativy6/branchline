import copy
import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import peaches_book.floor as floor_module

from peaches_book.floor import (
    FloorError,
    canonical_bytes,
    derive_issuer_id,
    derive_observation_id,
    derive_rubric_id,
    derive_stamp_id,
    issuer_signature_message,
    prepare_floor_stamp,
    prepare_observation,
    prepare_unsigned_stamp,
    strict_json_loads,
    verify_floor_stamp,
    verify_observation,
)


def _keypair():
    private = Ed25519PrivateKey.from_private_bytes(b"\x19" * 32)
    public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return private, public


def _valid_stamp(*, declaration=b"the exact declaration", claimed_at="2026-09-19T17:00:00Z"):
    private, public = _keypair()
    body = prepare_unsigned_stamp(
        public_key=public,
        declaration=declaration,
        media_type="text/plain;charset=utf-8",
        claimed_at=claimed_at,
        nonce=b"\x07" * 32,
        rubric_id=None,
    )
    signature = private.sign(issuer_signature_message(body))
    return prepare_floor_stamp(body, signature)


def test_prepare_and_verify_floor_stamp_is_deterministic_and_stateless():
    first = _valid_stamp()
    second = _valid_stamp()
    assert first == second

    result = verify_floor_stamp(first)
    assert result["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"
    assert result["stamp_id"] == first["stamp_id"]
    assert result["claim"] == "structure_digest_and_presented_key_signature_only"
    assert result["claimed_at"]["truth"] == "not_established"


def test_exact_declaration_bytes_are_bound_without_unicode_normalization():
    composed = _valid_stamp(declaration="é".encode())
    decomposed = _valid_stamp(declaration="e\N{COMBINING ACUTE ACCENT}".encode())
    assert composed["declaration"]["sha256"] != decomposed["declaration"]["sha256"]
    assert composed["stamp_id"] != decomposed["stamp_id"]
    assert verify_floor_stamp(composed)["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"
    assert verify_floor_stamp(decomposed)["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda stamp: stamp["declaration"].update({"bytes": "dGFtcGVyZWQ"}),
        lambda stamp: stamp.update({"claimed_at": "2026-09-19T13:00:00-04:00"}),
        lambda stamp: stamp.update({"nonce": "AA"}),
        lambda stamp: stamp.update({"rubric_id": "rubric-by-name"}),
        lambda stamp: stamp.update({"stamp_id": "peaches:stamp:v1:" + "0" * 64}),
        lambda stamp: stamp["signature"].update({"value": "A" * 86}),
        lambda stamp: stamp.update({"sequence": 1}),
    ],
)
def test_tampering_and_authority_shaped_extra_fields_are_rejected(mutation):
    stamp = _valid_stamp()
    mutation(stamp)
    assert verify_floor_stamp(stamp)["status"] == "INVALID_FLOOR_STAMP"


@pytest.mark.parametrize(
    "claimed_at",
    [
        "2026-09-19T17:00:00.000Z",
        "2026-09-19T17:00:00+00:00",
        "2026-9-19T17:00:00Z",
        "0000-01-01T00:00:00Z",
        "2026-02-29T00:00:00Z",
        "2026-09-19T17:00:60Z",
    ],
)
def test_claimed_at_checks_canonical_syntax_not_truth(claimed_at):
    private, public = _keypair()
    with pytest.raises(FloorError):
        body = prepare_unsigned_stamp(
            public_key=public,
            declaration=b"x",
            media_type="text/plain",
            claimed_at=claimed_at,
            nonce=b"\x00" * 32,
        )
        prepare_floor_stamp(body, private.sign(issuer_signature_message(body)))


def test_strict_text_ingress_rejects_duplicate_keys_at_any_depth():
    duplicate_root = '{"schema":"peaches.floor.stamp/1","schema":"other"}'
    duplicate_nested = '{"outer":{"same":1,"same":2}}'
    for text in (duplicate_root, duplicate_nested):
        with pytest.raises(FloorError, match="duplicate_json_key"):
            strict_json_loads(text)
        result = verify_floor_stamp(text)
        assert result["status"] == "INVALID_FLOOR_STAMP"
        assert "duplicate_json_key" in result["errors"][0]


def test_direct_mapping_with_nonstring_key_returns_bounded_floor_error():
    stamp = _valid_stamp()
    stamp[1] = "not-a-json-object-key"
    result = verify_floor_stamp(stamp)
    assert result["status"] == "INVALID_FLOOR_STAMP"
    assert result["errors"] == ["stamp_keys_must_be_strings"]


def test_canonical_json_rejects_floats_and_unsafe_integers_without_mistaking_bool():
    for value in ({"n": 1.25}, {"n": 2**53}, {"n": -(2**53)}):
        with pytest.raises(FloorError):
            canonical_bytes(value)
    for text in ('{"n":1.0}', '{"n":9007199254740992}', '{"n":NaN}'):
        with pytest.raises(FloorError):
            strict_json_loads(text)
    with pytest.raises(FloorError, match="negative_zero"):
        strict_json_loads('{"n":-0}')
    assert canonical_bytes({"n": True}) == b'{"n":true}'


def test_canonical_json_uses_utf16_key_order_and_preserves_unicode_sequences():
    # U+10000 sorts before U+E000 by UTF-16 code units, unlike code-point order.
    assert canonical_bytes({"\ue000": 1, "\U00010000": 2}) == (
        '{"\U00010000":2,"\ue000":1}'.encode()
    )
    composed = canonical_bytes({"text": "é"})
    decomposed = canonical_bytes({"text": "e\N{COMBINING ACUTE ACCENT}"})
    assert composed != decomposed
    assert b"e\xcc\x81" in decomposed


def test_serialized_stamp_verifies_and_padded_or_noncanonical_base64_does_not():
    stamp = _valid_stamp()
    text = json.dumps(stamp, ensure_ascii=False, separators=(",", ":"))
    assert verify_floor_stamp(text)["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"

    padded = copy.deepcopy(stamp)
    padded["nonce"] += "="
    assert verify_floor_stamp(padded)["status"] == "INVALID_FLOOR_STAMP"


def test_detached_observation_is_classified_without_time_or_method_truth():
    stamp = _valid_stamp(claimed_at="2026-09-19T17:00:00Z")
    method_id = "peaches:rubric:v1:" + "a" * 64
    observation = prepare_observation(
        stamp_id=stamp["stamp_id"],
        observed_no_later_than="2026-09-19T18:00:00Z",
        method_id=method_id,
        evidence=b"detached witness token",
        media_type="application/octet-stream",
    )
    direct = verify_observation(
        observation,
        expected_stamp_id=stamp["stamp_id"],
        claimed_at=stamp["claimed_at"],
    )
    assert direct["status"] == "ATTACHED_UNVERIFIED"
    assert direct["method_validation"] == "outside_floor_checker"
    assert direct["time_truth"] == "not_established"

    combined = verify_floor_stamp(stamp, observations=[observation])
    assert combined["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"
    assert combined["observations"][0]["status"] == "ATTACHED_UNVERIFIED"


def test_time_order_conflict_and_bad_observation_do_not_invalidate_stamp():
    stamp = _valid_stamp(claimed_at="2026-09-19T17:00:00Z")
    observation = prepare_observation(
        stamp_id=stamp["stamp_id"],
        observed_no_later_than="2026-09-19T16:59:59Z",
        method_id="peaches:rubric:v1:" + "b" * 64,
        evidence=b"evidence",
        media_type="application/octet-stream",
    )
    bad = copy.deepcopy(observation)
    bad["evidence"]["sha256"] = "sha256:" + "0" * 64

    result = verify_floor_stamp(stamp, observations=[observation, bad])
    assert result["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"
    assert result["observations"][0]["issues"] == ["TIME_ORDER_CONFLICT"]
    assert result["observations"][1]["status"] == "INVALID_OBSERVATION"


def test_observation_is_detached_and_must_name_the_checked_stamp():
    stamp = _valid_stamp()
    other = _valid_stamp(declaration=b"other")
    observation = prepare_observation(
        stamp_id=other["stamp_id"],
        observed_no_later_than="2026-09-19T18:00:00Z",
        method_id="peaches:rubric:v1:" + "c" * 64,
        evidence=b"evidence",
        media_type="application/octet-stream",
    )
    result = verify_floor_stamp(stamp, observations=[observation])
    assert result["status"] == "VALID_FLOOR_STRUCTURE_AND_SIGNATURE"
    assert result["observations"][0]["status"] == "INVALID_OBSERVATION"
    assert result["observations"][0]["errors"] == ["observation_stamp_id_mismatch"]


def test_no_checker_or_book_state_fields_exist_in_prepared_stamp():
    stamp = _valid_stamp()
    forbidden = {
        "checker_id",
        "checker_signature",
        "sequence",
        "previous_head",
        "book_id",
        "registered_at",
        "admitted",
    }
    assert forbidden.isdisjoint(stamp)


def test_stamp_id_scope_excludes_proof_bytes_but_verification_checks_them():
    stamp = _valid_stamp()
    result = verify_floor_stamp(stamp)
    assert result["stamp_id_scope"] == "unsigned_body_only_excludes_signature"
    tampered = copy.deepcopy(stamp)
    tampered["signature"]["value"] = "A" * 86
    assert tampered["stamp_id"] == stamp["stamp_id"]
    assert verify_floor_stamp(tampered)["status"] == "INVALID_FLOOR_STAMP"


@pytest.mark.parametrize(
    "public_key",
    [
        b"\x01" + b"\x00" * 31,
        b"\x01" + b"\x00" * 30 + b"\x80",
        b"\x00" * 32,
    ],
)
def test_identity_noncanonical_and_small_order_public_keys_cannot_forge(public_key):
    body = prepare_unsigned_stamp(
        public_key=public_key,
        declaration=b"identity-key forgery regression",
        media_type="text/plain;charset=utf-8",
        claimed_at="2026-09-19T17:00:00Z",
        nonce=b"\x03" * 32,
    )
    universal_signature = b"\x01" + b"\x00" * 63
    stamp = {
        **body,
        "stamp_id": derive_stamp_id(body),
        "signature": {
            "suite": "Ed25519",
            "value": base64.urlsafe_b64encode(universal_signature)
            .decode()
            .rstrip("="),
        },
    }
    result = verify_floor_stamp(stamp)
    assert result["status"] == "INVALID_FLOOR_STAMP"
    assert result["errors"][0] in {
        "issuer_public_key_identity_not_permitted",
        "issuer_public_key_noncanonical_x_sign",
        "issuer_public_key_not_prime_subgroup",
    }


def test_noncanonical_signature_scalar_is_rejected_before_backend_verification():
    stamp = _valid_stamp()
    signature = base64.urlsafe_b64decode(
        stamp["signature"]["value"]
        + "=" * (-len(stamp["signature"]["value"]) % 4)
    )
    noncanonical = signature[:32] + floor_module._ED25519_L.to_bytes(32, "little")
    stamp["signature"]["value"] = (
        base64.urlsafe_b64encode(noncanonical).decode().rstrip("=")
    )
    result = verify_floor_stamp(stamp)
    assert result["status"] == "INVALID_FLOOR_STAMP"
    assert result["errors"] == ["signature_S_noncanonical"]


def test_observation_full_object_must_fit_even_when_core_fits(monkeypatch):
    stamp = _valid_stamp()
    observation = prepare_observation(
        stamp_id=stamp["stamp_id"],
        observed_no_later_than="2026-09-19T18:00:00Z",
        method_id="peaches:rubric:v1:" + "d" * 64,
        evidence=b"size-bound",
        media_type="application/octet-stream",
    )
    core = {key: value for key, value in observation.items() if key != "observation_id"}
    core_size = len(canonical_bytes(core))
    full_size = len(canonical_bytes(observation))
    assert core_size < full_size
    monkeypatch.setattr(floor_module, "MAX_JSON_BYTES", (core_size + full_size) // 2)

    result = verify_observation(observation)
    assert result["status"] == "INVALID_OBSERVATION"
    assert result["errors"] == ["maximum_json_bytes_exceeded"]


def test_frozen_calculation_vectors_match_checker_derivations():
    vector_dir = Path(__file__).parents[1] / "vectors" / "floor-v1"
    expected = strict_json_loads(
        (vector_dir / "calculation-expectations.json").read_bytes()
    )
    unsigned = strict_json_loads((vector_dir / "unsigned-stamp-body.json").read_bytes())
    observation_core = strict_json_loads(
        (vector_dir / "observation-core.json").read_bytes()
    )

    canonical_b64 = base64.urlsafe_b64encode(canonical_bytes(unsigned)).decode().rstrip("=")
    assert canonical_b64 == expected["unsigned_stamp_body_canonical_base64url"]
    assert issuer_signature_message(unsigned) == (
        b"PEACHES-STAMP-SIGNATURE-V1\x00" + canonical_bytes(unsigned)
    )
    public_bytes = bytes.fromhex(expected["issuer_public_bytes_hex"])
    assert (
        base64.urlsafe_b64encode(public_bytes).decode().rstrip("=")
        == unsigned["issuer"]["public_key"]
    )
    assert derive_issuer_id(public_bytes) == expected["issuer_id"]
    assert (
        unsigned["declaration"]["bytes"]
        == expected["declaration_exact_bytes_base64url"]
    )
    assert derive_stamp_id(unsigned) == expected["stamp_id"]

    rubric_bytes = base64.urlsafe_b64decode(
        expected["rubric_exact_bytes_base64url"]
        + "=" * (-len(expected["rubric_exact_bytes_base64url"]) % 4)
    )
    assert (
        derive_rubric_id(expected["rubric_media_type"], rubric_bytes)
        == expected["rubric_id"]
    )
    observation_canonical_b64 = (
        base64.urlsafe_b64encode(canonical_bytes(observation_core))
        .decode()
        .rstrip("=")
    )
    assert (
        observation_canonical_b64
        == expected["observation_core_canonical_base64url"]
    )
    assert derive_observation_id(observation_core) == expected["observation_id"]

    with pytest.raises(FloorError, match="duplicate_json_key"):
        strict_json_loads((vector_dir / "invalid-duplicate-key.json").read_bytes())
