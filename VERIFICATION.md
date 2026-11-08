# Verification for Branchline v0.10

Prepared on Dust, 8 November 2026, by Hearthline under Christopher Daniel Pang's v0.10 publication request. The records below distinguish the earlier baseline from the current feature qualification; final package and installer results are in INSTALLER-VERIFICATION.json.

- The earlier preview.3 baseline passed its 20 backend tests, including provider pagination, refresh, account-change invalidation, stale results, idempotent model registration, session protection, and the shared-desk regression suite.
- The connection browser flow passed at desktop and narrow widths: inline sign-in/model state, automatic registration and chair options, no per-model import buttons, preservation of an unfinished local-model form, connected status after catalog/state-fetch errors, and retention of saved models after sign-out.
- The existing shared-desk browser flow also passed, including concurrent requests, independent cancellation, drawers and Activity layout.
- The rebuilt native application opened successfully and shut its backend down gracefully in an isolated workspace.

The release's separate INSTALLER-VERIFICATION.json records the live account/catalog and reopen checks, final package hashes, and installer qualification after packaging. These source tests use synthetic provider data and do not prove access to every plan model or every request's allowance.

The native host uses the recovered pinned desktop source with its version updated. Runtime/model inputs and corresponding native-library sources retain their hash records. No account credentials or personal workspace are included.

This remains an unsigned Windows x64 preview. Current native qualification is on Windows 11; no fresh Windows 10 or every-GPU pass is claimed. The supplied tests are not the complete historical development suite. See PREVIEW-LIMITS.md and UPGRADE-NOTES.md.

Working-draft crew qualification: the three live ChatGPT models overlapped through one connection, received their own tool results, edited synthetic notes, wrote separate drawers and cross-checked peer logs against actual files. All and recipient-only prompts both passed. A real interrupted Astra turn left Sol and Luna running. See the local desk-crew receipt archive for exact run records.

8 November local touchup: all 28 backend tests and both desk browser flows passed. Clipboard checks used a partial selection across messages through the desk-activity summary, compared actual plain/rich clipboard contents, excluded the draft and collapsed log, and retained the selection through an unrelated state refresh. All hides its automatic recipient preview while explicit mentions retain theirs.

The Windows PC service/native helper edited three synthetic H: notes using a virtualized LocalAppData recovery directory. The original logical recovery path reproduced the reported alias error; resolving only the app-owned recovery directory repaired the edits and preserved exact originals. A stale edit remained rejected. No original hunt note was modified and no model inference was needed for this regression check. The native executable was unchanged.

8 November compact-header/shared-picture qualification: all 33 backend tests passed. New cases cover exact image bytes across chairs (including two on the same model), duplicate sends, delayed recipients after the next picture selection changes, mixed image support, independent Stop, Select/Alternate/subsets and saved-state replay. Browser checks cover the real attachment chooser, All and image-only invitations, one shared picture in history, reuse and recipient labels, conditional scroll arrows, arrangement, keyboard focus, zero/one/many visitors and font changes. Existing desk, clipboard and ChatGPT catalog flows passed.

At matching 714-pixel-high browser viewports, the header changed from 155.34 to 108.38 pixels at width 1010, and from 249.95 to 144.38 at width 800. Width 1365 improved by 1.47 pixels and width 390 by 30.25; these are fixture measurements, not a claim that every window saves the same space.

Three real ChatGPT chairs (Astra, Sol and Luna) each read the same fresh synthetic picture, correctly returned its random label and identified its red circle, blue square and yellow triangle. All three task intervals overlapped for 4.165 seconds. The single saved image and each exchange's matching image reference were checked. No personal workspace conversation or image was used in that qualification.
