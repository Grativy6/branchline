# Verification for Branchline 1.1

## 1.1 release checks

The backend suite passed 137 tests. Focused browser checks cover handoff selection, input reduction, recorded input, retained code selection and scroll position, complete Copy, hidden shared work, discard/reload behavior, and the in-app guide. The native-backdrop color checks cover 15 color/theme combinations with body-text contrast above 7.49:1.

The final touchups check that busy desk events cannot cut off the artifact index, updated own notes become the return point, broadcasts retain recipients without repeating the prompt, distinct later prompts remain distinct, starter colors stay locked, and custom colors remain editable and portable.

Reply-lifetime tests exercise work beyond the former deadline through a tool continuation, explicit Stop, and provider-error reporting. These checks use synthetic responses and do not claim a model-quality improvement. Local Dreams training behavior is unchanged from the qualified 1.0 backend.

Packaged startup, installer and download-helper results accompany the release in INSTALLER-VERIFICATION.json. Older dated checks below describe their original scope and are retained as history.

## 1.0 release checks

The integrated backend suite passed **118 tests**. Focused checks cover interrupted
plain/packed journal endings, recovery interrupted at either publish boundary,
active and reused writer identities, exact input reconstruction, legacy receipt
hashes, relocated backups, frozen Dream batches, worker failures, local-slot races,
Stop priority, Plan edits, late hearth messages, downloads and queued image intake.
The source includes the reproductions; these checks use synthetic data.

In comparable runs of the same immediate-model workload, overhead at 50 exchanges
fell from **1,146 ms to 247 ms**, and a setting change from **194 ms to 17 ms**.
The repaired run completed 200 exchanges with **518 ms** overhead at that point;
250 exchanges across short conversations reached **896 ms**. These are observed
fixture timings, not latency guarantees. Exact history remains retrievable.

A real local Dream used nine controlled synthetic episodes and three optimizer
updates. It suspended after update one, resumed the actual checkpoint with the same
batch, exported and loaded its candidate, and adopted/returned within the isolated
workspace. Peak whole-device readings were **56°C** and **11,805 MiB VRAM**.
Validated export scratch cleanup removed 13 temporary files (17,523,081,639 bytes).
Preparation was injected to control the examples; training and inference were real.

A matching untrained export control was compared with stock Qwen and the candidate
using identical messages, temperature zero and a fixed seed. The two 160-token
prefix comparisons differed between stock/control and control/trained; 248 adapter
B tensors were nonzero. This small, output-limited check establishes neither
better conversation quality nor information preservation.

Browser checks cover Dreams controls, Pony Post, message gears, download bytes and
the recovery notice. A copied working workspace retained its saved structures and
receipt hashes through migration. Python checks cover consistent read snapshots,
owner/profile isolation, proposal replay, host/model separation and relocation.

With four selected continuity sources, ordinary fixture replies took **6.7–6.9 s**
with six real helper launches. The larger helper-process/caching optimization is
explicitly deferred; changed context was still observed on the next reply.

The native/installer results accompany the release artifacts. The subsequent UI
review checked four window widths and side-panel changes, then moved desk records
into Activity. Desk/crew browser checks retained task controls, clipboard selection
and log access. Chris confirmed the installed desktop workspace, chairs and ChatGPT
connection after restart and accepted the final Activity placement.
Earlier dated checks below retain their original scope and counts.

## 0.99.1 Pony Post home — 10 November 2026

The backend suite passed 98/98 tests, including nine postal checks with synthetic
state and injected responses. They cover distinct desks, no-inference notices,
queued requests, held returns, duplicate Send, cancellation, changed addresses,
restart without replaying started work, backup/restore, source sharing, referenced
Dream notes, failed saves, and picture delivery preserving composer selections.
The browser check configured both desks, sent through the message gear, observed
one recipient call and its return, and checked the narrow layout. The existing
message-actions browser check also passed. These checks made no paid model calls.

The legacy active helper-task UI/runner was retired. Its immutable history readers
remain. The general independent-review findings for 1.0 are still tracked separately.
This change also closes a reply-preparation sink on failure and preserves Dream-note
origins on edit, because postal queue/context integration uses those paths.


## 0.11.0-preview.1 Dreams — 10 November 2026

The full backend suite passed 86 tests. The Dream browser flow covered manual
notes, file import, multi-message highlights, category tints, preparation-model
selection, whole Usual Coats collapse, picture persistence, the two-second guard,
Cancel, Suspend/reload/Resume, Stop, adoption/return and a narrow window.
A further focused check confirms that a failed checkpoint save is reported as
interrupted with its actual error, rather than falsely claiming suspension.

A real Qwen3.5-4B BF16 LoRA run on an RTX 4070 trained 24 overlapping windows at
the 1,024-token ceiling, suspended after update 1 and resumed through update 6.
Peak whole-device VRAM was 11,829 MiB and GPU temperature 70°C. An extra CPU model
copy caused export memory pressure under a 16 GB WSL ceiling; removing it allowed
export to resume from the trained adapter. No distro-wide shutdown was needed.

The app-mediated synthetic run used local Qwen for preparation, trained one
update, exported Q4_K_M, loaded it in Branchline, produced a reply, adopted it and
returned to stock Qwen. Both models answered the short greeting/arithmetic check
correctly. The new generation also identified a synthetic green image using the
retained projector. Export initially exposed inconsistent MTP metadata; the
converter now excludes the absent MTP head, and native loading gates readiness.

These checks establish the training/export/application path for this profile.
They do not establish model-quality improvement, universal hardware support or
training support for other model families. All training data was synthetic.

## 0.10.3-preview.1 preparation — 9 November 2026

The unchanged application baseline at 9143bb0 passed 78 backend tests, the local-model finder browser flow and the existing subscription/steering browser flow. The finder checks cover search, description before Add, duplicate identity, removal retaining the file, restoration, retry errors, page order and saved-state replay. The meter flow checks 75% left for 25% used.

Two existing Apertus-family files were checked against their recorded SHA-256 identities, loaded through the owned Vulkan runtime with 8,192-token windows, and answered a short greeting. Both stopped naturally after the final minimal local instruction and plain user message were applied. Earlier scaffolding-echo attempts were retained as failures, not successful greetings. This establishes these two file routes, not universal GGUF compatibility.

The local 0.10.3 native host passed an isolated history/reopen check. The user tested the installed finder, reported success and supplied a screenshot of a saved Gemma4 entry; that is not a claim of a Gemma4 inference test. Final release-package installation/upgrade and artifact identities are recorded separately in INSTALLER-VERIFICATION.json after packaging. No production account or private workspace is included.

The sections below retain earlier qualification and its dates.

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
