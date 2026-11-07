# Verification for 0.9.1-preview.3

Prepared on Dust, 7 November 2026, by Hearthline under Christopher Daniel Pang's repair and publication requests.

- All 20 supplied backend tests passed, including provider pagination, refresh, account-change invalidation, stale results, idempotent model registration, session protection, and the shared-desk regression suite.
- The connection browser flow passed at desktop and narrow widths: inline sign-in/model state, automatic registration and chair options, no per-model import buttons, preservation of an unfinished local-model form, connected status after catalog/state-fetch errors, and retention of saved models after sign-out.
- The existing shared-desk browser flow also passed, including concurrent requests, independent cancellation, drawers and Activity layout.
- The rebuilt native application opened successfully and shut its backend down gracefully in an isolated workspace.

The release's separate INSTALLER-VERIFICATION.json records the live account/catalog and reopen checks, final package hashes, and installer qualification after packaging. These source tests use synthetic provider data and do not prove access to every plan model or every request's allowance.

The native host uses the recovered pinned desktop source with its version updated. Runtime/model inputs and corresponding native-library sources retain their hash records. No account credentials or personal workspace are included.

This remains an unsigned Windows x64 preview. Current native qualification is on Windows 11; no fresh Windows 10 or every-GPU pass is claimed. The supplied tests are not the complete historical development suite. See PREVIEW-LIMITS.md and UPGRADE-NOTES.md.
