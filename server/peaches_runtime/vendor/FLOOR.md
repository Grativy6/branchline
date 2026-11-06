# PEACHES Floor v1

**Protocol ID:** `peaches.floor/1`

**Status:** `FROZEN_PRE_GENESIS`

**Scope:** a minimal, voluntary format for issuer-created provenance stamps and detached observation evidence

This document freezes the PEACHES Floor v1 wire meaning. It does not create
Genesis, `PEACHES:H1`, a live stamp, a key, a registry, an operator, or an
official checker. Those non-events are recorded in `PREGENESIS-FREEZE.md`.

## 1. Floor statement

A conforming PEACHES Floor stamp preserves only this bounded statement:

> The signature in this stamp validates under the included public key over the
> protocol-defined encoding of its exact unsigned body, including these exact
> declaration bytes and this issuer-claimed time.

The cryptographic statement does not establish who produced the signature or
whether control was legitimate, exclusive, uncompromised, or current. It does
not by itself identify a human or institution. Any binding between a key and a
named party is a separate claim requiring separate evidence.

PEACHES is voluntary. A stamp has no legal effect merely because it conforms
to this floor. It does not create or confer truth, ethics, authority, consent,
standing, jurisdiction, ownership, permission, approval, endorsement,
certification, contractual force, freshness, inclusion, priority, or
obligation. An external institution may give a stamp consequences under its
own law, contract, policy, or rubric; that consequence comes from the external
basis, not from PEACHES.

There is no official PEACHES stamper, signing key, issuance service, approval
queue, append boundary, registry, clock, or privileged checker. Any issuer may
construct and sign a conforming stamp. Any implementation may check one
without contacting or obtaining permission from this repository.

## 2. Stamp object

A Floor v1 stamp is one JSON object with exactly these members:

```json
{
  "schema": "peaches.floor.stamp/1",
  "floor": "peaches.floor/1",
  "issuer": {
    "key_type": "Ed25519",
    "public_key": "<unpadded base64url of exactly 32 bytes>",
    "issuer_id": "peaches:issuer:v1:<64 lowercase hexadecimal digits>"
  },
  "declaration": {
    "media_type": "text/plain;charset=utf-8",
    "bytes": "<unpadded base64url of the exact declaration bytes>",
    "sha256": "sha256:<64 lowercase hexadecimal digits>"
  },
  "claimed_at": "YYYY-MM-DDTHH:MM:SSZ",
  "nonce": "<unpadded base64url of exactly 32 bytes>",
  "rubric_id": null,
  "stamp_id": "peaches:stamp:v1:<64 lowercase hexadecimal digits>",
  "signature": {
    "suite": "Ed25519",
    "value": "<unpadded base64url of exactly 64 bytes>"
  }
}
```

No additional member is permitted at any level. Member order in received JSON
is irrelevant; canonical member order is determined by section 5.

### 2.1 Unsigned body

The unsigned body is a new object containing exactly these seven members from
the stamp, without alteration:

1. `schema`
2. `floor`
3. `issuer`
4. `declaration`
5. `claimed_at`
6. `nonce`
7. `rubric_id`

`stamp_id` and `signature` are never members of the unsigned body.

### 2.2 Issuer

`public_key` is the unpadded RFC 4648 URL-safe Base64 encoding of the exact
32-byte Ed25519 public key. A checker MUST decode it strictly, reject padding
or non-alphabet characters, require 32 bytes, and require that re-encoding
produces the identical string.

`issuer_id` is derived, not assigned:

```text
issuer_hash = SHA-256(
  ASCII("PEACHES-ISSUER-ID-V1") || 0x00 || raw_public_key
)

issuer_id = "peaches:issuer:v1:" || lowercase_hex(issuer_hash)
```

An issuer ID identifies key bytes only. It is not proof of a name, person,
institution, role, capacity, or authority.

### 2.3 Declaration

`declaration.bytes` carries the exact declaration as unpadded URL-safe Base64.
Subject to the PEACHES-CJSON-1 resource bounds, it may encode UTF-8 text,
canonical JSON, or any other finite byte string. PEACHES does not reinterpret,
normalize, translate, or execute it.

`media_type` is a signed, case-sensitive description of those bytes. In v1 it
MUST contain 1 through 255 printable ASCII characters, U+0020 through U+007E.
Its presence does not prove that the bytes conform to the named media type.

`declaration.sha256` is:

```text
"sha256:" || lowercase_hex(SHA-256(exact_declaration_bytes))
```

This ordinary content digest is not an identity. All identifiers defined by
this floor use separate domain strings.

### 2.4 Claimed time

`claimed_at` is the issuer's signed assertion about time. It is not a trusted
clock reading and is not evidence that the declaration existed at that time.

The only accepted spelling is a semantically valid proleptic-Gregorian UTC
date and time in the form `YYYY-MM-DDTHH:MM:SSZ`, with year `0001` through
`9999`. Fractions, offsets, lowercase letters, leap seconds, `24:00:00`, and
invalid calendar dates are rejected.

### 2.5 Nonce

`nonce` is the unpadded URL-safe Base64 encoding of exactly 32 issuer-selected
bytes. When selected differently, it distinguishes signing bodies that would
otherwise be identical. The floor makes no randomness claim: a predictable or
repeated nonce remains visible and MUST NOT be silently repaired by a checker.

### 2.6 Optional rubric

`rubric_id` is either JSON `null` or a content-addressed identifier:

```text
rubric_hash = SHA-256(
  ASCII("PEACHES-RUBRIC-ID-V1") || 0x00 ||
  ASCII(media_type) || 0x00 || exact_rubric_bytes
)

rubric_id = "peaches:rubric:v1:" || lowercase_hex(rubric_hash)
```

The rubric bytes and their media type travel separately. A checker that is
given them MUST recompute the identifier before applying them. A missing
rubric, unresolved rubric, or unsupported rubric remains explicit; it MUST
NOT be replaced with inferred requirements.

Rubrics may impose narrower requirements for a particular integration. For
example, a bilateral institutional integration rubric may require reports
from two independently sourced checker implementations. Under such a rubric,
checker disagreement prevents that rubric's integration result from being
issued, and both reports remain available for review. This is not a universal
Floor v1 requirement. A rubric cannot turn a checker into an authority or
change the bounded meaning of the underlying stamp.

### 2.7 Unsigned-body identity and signature

Let `canonical_unsigned_body` be the PEACHES-CJSON-1 bytes defined in section
5. Then:

```text
stamp_hash = SHA-256(
  ASCII("PEACHES-STAMP-ID-V1") || 0x00 || canonical_unsigned_body
)

stamp_id = "peaches:stamp:v1:" || lowercase_hex(stamp_hash)
```

`stamp_id` identifies the exact unsigned body: all seven issuer-selected and
signed fields. It deliberately excludes the proof bytes. It therefore does
not, by itself, establish that a signature existed or that a completed signed
envelope was observable. More than one proof representation may refer to the
same `stamp_id`; a checker evaluates the supplied proof separately.

The Ed25519 signature input is:

```text
ASCII("PEACHES-STAMP-SIGNATURE-V1") || 0x00 || canonical_unsigned_body
```

`Ed25519` means pure Ed25519 as specified by RFC 8032, not Ed25519ctx or
Ed25519ph. Floor v1 additionally fixes strict verification so library-specific
acceptance rules cannot widen the suite. Let `L` be
`2^252 + 27742317777372353535851937790883648493`, let `B` be the RFC 8032
Edwards25519 base point, let `A_bytes` be `raw_public_key`, and split the
64-byte signature into `R_bytes || S_bytes`. A checker MUST:

1. decode `A_bytes` and `R_bytes` as canonical compressed Edwards25519 points
   over `p = 2^255 - 19`, rejecting an encoding that does not re-encode to the
   identical 32 bytes;
2. reject the identity public key `A`, require `[L]A` to equal the identity,
   and require `[L]R` to equal the identity;
3. interpret `S_bytes` as a little-endian integer and require `0 <= S < L`;
4. compute `k` as the little-endian integer represented by
   `SHA-512(R_bytes || A_bytes || signature_input)`, reduced modulo `L`; and
5. accept only if the uncofactored equation `[S]B = R + [k]A` holds.

In particular, a cofactored or ZIP-215-style relaxed verification result is
not a Floor v1 verification result. These checks exclude the identity-key
universal-forgery case accepted by some general-purpose Ed25519 providers.

`signature.value` is the unpadded URL-safe Base64 encoding of the resulting
64-byte Ed25519 signature. The signature does not cover a serialization that
contains `stamp_id` or `signature`; both are derived or checked against the
same unsigned body.

Human-readable labels and aliases are outside Floor v1. In particular, no
label such as `PEACHES:H1` replaces or changes a `stamp_id`.

## 3. Detached observation evidence

External evidence about when stamp material was observable is a separate
object. It is never inserted into, or used to recompute, the stamp it refers
to.

```json
{
  "schema": "peaches.floor.observation/1",
  "floor": "peaches.floor/1",
  "stamp_id": "peaches:stamp:v1:<64 lowercase hexadecimal digits>",
  "observed_no_later_than": "YYYY-MM-DDTHH:MM:SSZ",
  "method_id": "peaches:rubric:v1:<64 lowercase hexadecimal digits>",
  "evidence": {
    "media_type": "application/octet-stream",
    "bytes": "<unpadded base64url of the exact evidence bytes>",
    "sha256": "sha256:<64 lowercase hexadecimal digits>"
  },
  "observation_id": "peaches:observation:v1:<64 lowercase hexadecimal digits>"
}
```

The observation core contains exactly the first six members above, excluding
`observation_id`. `evidence` follows the same byte, digest, and media-type rules
as `declaration`. `observed_no_later_than` follows the same timestamp grammar
as `claimed_at`.

`method_id` identifies the separate, content-addressed method document used
to authenticate and interpret the evidence. It MUST be derived from that
method's declared media type and exact bytes using the rubric-ID algorithm in
section 2.6. That method may describe, for example, a timestamp authority
token, transparency-log proof, signed release, or independently archived
publication. The Floor does not choose a preferred method or witness.

```text
observation_hash = SHA-256(
  ASCII("PEACHES-OBSERVATION-ID-V1") || 0x00 ||
  PEACHES-CJSON-1(observation_core)
)

observation_id =
  "peaches:observation:v1:" || lowercase_hex(observation_hash)
```

A base checker can establish that this object is well formed and internally
content-consistent. Without the identified method and successful
method-specific verification, it MUST report the evidence as attached but
unverified. A method-specific verifier MUST establish that the evidence binds
the named `stamp_id` and supports the stated no-later-than bound; it MUST NOT
infer either connection from this wrapper alone.

Because `stamp_id` identifies the unsigned body, method evidence that binds
only `stamp_id` establishes at most that those body bytes were observable. To
report that a completed signed stamp was observable, the method and its
evidence MUST additionally bind either the exact canonical completed envelope
or the exact signature bytes together with `stamp_id`. That additional binding
is method-specific and MUST remain visible in its report.

Even successfully verified evidence establishes at most the method's bounded
`observed_no_later_than` result and the exact material it names. It does not
prove creation time, authorship, originality, priority, truth, or legal effect,
and it does not upgrade `claimed_at`.

If `observed_no_later_than` is earlier than `claimed_at`, a checker MUST expose
a time-order conflict without invalidating or rewriting the signed stamp.

## 4. Stateless checking

A conforming Floor v1 checker accepts supplied bytes and returns a report. It
MUST NOT require a registry, mutate a book, append a record, assign a sequence,
contact an operator, consult a privileged clock, or silently fetch a rubric.

For a stamp, it checks at least:

1. strict JSON parsing and the exact schema shape;
2. PEACHES-CJSON-1 admissibility;
3. strict Base64 decoding and canonical re-encoding;
4. declaration content digest;
5. derived issuer ID;
6. calendar-valid `claimed_at` syntax;
7. derived stamp ID; and
8. Ed25519 signature validity over the domain-separated input.

For detached observation evidence, it checks the corresponding shape, byte
digest, calendar-valid time, and derived observation ID. Authentication of
the evidence is a separate method-specific result.

A positive base result is `VALID_FLOOR_STRUCTURE_AND_SIGNATURE`. A negative
result SHOULD identify all safely discoverable failures rather than collapsing
them into approval or rejection language. No checker result is a stamp,
permission, consent, legal judgment, or authority grant.

## 5. PEACHES-CJSON-1

Every hash or signature over a JSON object in Floor v1 uses the following
deterministic UTF-8 representation. It is a restricted JSON Canonicalization
Scheme (JCS) profile, fully restated here for cross-language implementation.

1. Parse the original input strictly. Reject a byte-order mark, invalid UTF-8,
   trailing non-whitespace data, invalid escapes, a lone UTF-16 surrogate, and
   any duplicate object member name at any depth. Duplicate detection occurs
   before a parser collapses members into a map.
2. The admissible value types are object, array, string, integer, `true`,
   `false`, and `null`. Floating-point, decimal, and exponent-form numbers are
   rejected. Integers are limited to
   `-9007199254740991` through `9007199254740991`, inclusive. The number `-0`
   is rejected.
3. The received JSON representation and the resulting canonical representation
   MUST each be no more than 1,000,000 bytes. Nesting depth MUST be no more
   than 32, with the root at depth 0. The combined count of object members and
   array items MUST be no more than 10,000.
4. Every object key and string value MUST be a sequence of Unicode scalar
   values. Preserve that sequence exactly and NEVER normalize it. No Unicode
   normalization form or Unicode-table version is part of PEACHES-CJSON-1.
   Every schema-admissible Floor v1 envelope string is ASCII; declaration,
   rubric, and evidence content remains opaque bytes carried as Base64url.
5. Emit no byte-order mark and no insignificant whitespace. Emit `true`,
   `false`, and `null` literally. Emit integers in shortest base-10 form, with
   a leading minus only for a negative value and no leading zeroes.
6. Sort object member names lexicographically by their UTF-16 code units, as in
   JCS. Arrays retain their given order.
7. Escape U+0008, U+0009, U+000A, U+000C, and U+000D as `\b`, `\t`, `\n`,
   `\f`, and `\r`. Escape other U+0000 through U+001F code points as lowercase
   `\u00xx`. Escape quotation mark and reverse solidus as `\"` and `\\`.
   Emit every other Unicode scalar directly as UTF-8; do not escape solidus.

The JSON Schema in `schemas/peaches-floor-v1.schema.json` checks the structural
surface. It cannot by itself establish strict parsing, canonical Base64,
Unicode scalar validity and exact preservation, calendar validity, digests,
identifiers, or signatures. Those checks remain mandatory.

## 6. Corrections and extension

A stamp is immutable. Correction means issuing a new stamp whose declaration
explicitly identifies what it corrects; Floor v1 does not infer that relation
or erase the earlier bytes.

New signature suites, fields, identifier algorithms, or meanings require a
new schema and floor identifier. They MUST NOT be silently accepted as Floor
v1 extensions. Older stamps retain their original bytes and bounded meaning.

The SQLite test book and checker-registration chain elsewhere in this
repository are an optional historical engineering profile. They are not this
floor, are not required to issue or verify a Floor v1 stamp, and hold no
canonical PEACHES role.
