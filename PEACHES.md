# The local Book of PEACHES

Save a version, open a copy, and continue with any model. The Book is free and optional, with no Book account or purchased stamp. It stays last on the Toy Shelf. Local saving, reading, checking, exporting, importing and continuing work offline; signing is a separate option. No model call is needed for those actions.

The first private connection is H1 → Chris's existing Dream017 Personal participant → its reviewed account and future generations. Other users can select a different signed origin or start without one. A label is not an identity key. Origin association does not modify old replies, select a model, or authorize tools.

## Everyday flow

1. **Save a version** selects reviewed context and an optional continuity thread. An empty Book opens the existing profile editor and brings you back after creating a profile. Existing thread origins and earlier attribution remain intact when the Desk Model changes.
2. **Preview this version** freezes the exact export and generation reference. Sources, original attribution and technical references remain inspectable. Canceling does not publish a completed entry; unfinished previews are resumable.
3. **Save version** keeps an unsigned copy. The collapsed **Add an optional signature** choice can sign that exact version now or later; it uses the local key window and checks the result before recording completion.
4. **Export copy** produces a readable `.peach.zip`. **Open a copy** checks it before changing your Book. **Keep a copy** stores it; **Continue here** lets you review the continuation or branch and then keeps/imports it as a separate profile. Choose a Desk Model or visitor in the existing context screen; copying history does not copy permission to send it.
5. Save a correction as another version. Viewing, importing or stamping an older version does not roll the current account back.

The Book stores immutable, digest-addressed ZIP bytes and append-only metadata in Branchline's existing durable journal. Editable accounts continue to live in the existing personal-context store. Workspace backups include both. Signing keys have a separate recovery export and are deliberately excluded from workspace backup/export.

## Exact bytes and scope

`continuity.json` is the existing export serialized exactly as the local JSON export route does. `manifest.json` names its byte count and SHA-256, source profile/revision, participant/generation, origin, parent and continuing-thread ID. The optional Floor stamp signs the exact manifest bytes. H1's original envelope is carried unchanged. Snapshot digest, Floor stamp ID and full signature-envelope digest remain separate.

The unchanged reference Floor checker is pinned to `Grativy6/book-of-peaches` commit `6b12e184ad90e8cc210e90511e39ea3838fe7459`, under its included notices. Strict parsing precedes checking; signature validity alone cannot hide missing or changed payloads. ZIP intake is limited to 1 MiB compressed and expanded, fixed text members, no links, duplicate paths, alternate casing, executable extras or extraction. Existing continuity limits still apply.

A valid signature establishes the presented-key/bytes relationship. It does not authenticate a person, grant permissions, establish truth or make a copied h1 label Chris's active thread. A new key is shown as a different signer unless the original issuer key matches. No key-transition protocol or independent verifier implementation is claimed here.

## Local signing

The native Tk window creates a dedicated encrypted Ed25519 OpenSSH key by default, or imports an explicitly selected encrypted key. The old Genesis key is never discovered or opened automatically. A 100-round bcrypt KDF protects the encrypted key; the local key directory is restricted to its Windows user. Passwords remain in the native process. The browser receives only public identity/status and signed output.

Unlock applies to the local session, with 15 idle-minute expiry, explicit Lock and cleanup on parent/app closure. Each signature still follows the displayed **Stamp and save** action. Save intents retain nonce/time so an interrupted save can retry the same signing input. Encrypted recovery copies restore the same public key; a wrong password leaves the selected identity unchanged. Private-key loss never blocks ordinary Book reading or continuing an account.

The 0.8.19 candidate bundles CPython 3.12.14, Tcl/Tk, pinned checker/signing dependencies and the selected continuity/Home service modules in `book-runtime/`. Its manifests use paths relative to the app. It does not need the development machine's Python installation or private MCP checkout. Existing development manifests in `.local/` remain a fallback for source work only. Packaged manifests take precedence; invalid packaged configuration does not silently fall back to a host installation.

The existing public 0.8.12 download is unchanged. Candidate relocation and isolated-profile checks are recorded with the current build; another physical Windows machine is a separate release check. Full component licence texts travel with the runtime. Production keys and user Book contents never belong in an app package.

## Verification and replay

Test Book contents belong in a disposable local cache, outside the repository and
the main Book. Use invented records and test-only signing identities. The test
wrapper routes both workspace data and the native signer's per-user folder into
that cache; a Fresh room alone does not isolate the signing identity. It keeps raw
logs, exported stamps and demo files there too. Repository results should contain
test counts, source/runtime versions and reproduction steps, without stamp bodies,
private keys, main-Book records or raw failure dumps. A borrowed real record, if
ever specifically needed, remains a local read-only test input and is not merged
back. Existing deliberately published provenance sources are unchanged.

From this checkout, after preparing the isolated runtime (`cryptography==50.0.1`, `bcrypt==5.0.0`, `cffi==2.1.1`, `pycparser==3.11`):

```powershell
node tools/configure-peaches.mjs
.\scripts\Test-Peaches-Local.ps1 -Run
.\.local\peaches-venv\Scripts\python.exe -I -B tests/test_peaches_runtime.py
# Upstream tests additionally need pytest (development only).
.\.local\peaches-venv\Scripts\python.exe -I -B tests/peaches-upstream.py
.\.local\peaches-venv\Scripts\python.exe -I -B server/peaches_runtime/check_copy.py path-to-copy.peach.zip
```

The outside-app checker uses the same unchanged Floor implementation. Tests use invented accounts and disposable keys. No production signature is needed. Browser tests cover desktop/small-screen save, export, reopen and separate-profile import; other tests cover corrections, actual app generation transitions using a mock runner, restart, backup restoration, no inherited grants, source mutation during preview and interrupted writes.

Public discovery, hosting, physical keys, recipient encryption and a separately authored verifier remain separate work. The paid-stamp feature gate has been retired from this product direction. Optional support and third-party inference costs are separate from using your Book. No periodic agent or model-facing signing tool is installed.
