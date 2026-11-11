# Branchline release notes

## 1.0.0 — 10 November 2026

The first 1.0 release brings the continuing shared workspace and local Dreams into
one Windows package, including stock Qwen3.5-4B.

- Save whole conversation or workflow notes, choose a preparation model, and run
  local Dreams for the included Qwen. Suspend/Resume keeps the prepared batch and
  checkpoint; a new generation can be tried, adopted or replaced by the original.
- Pony Post has its own saved home between desks, with per-desk On/Off choices,
  queued requests and returns that wait when a receiving desk is closed.
- Interrupted saves have a recovery path. Exact model inputs use compact saved
  pieces while original history and receipt hashes remain retrievable.
- Message actions sit behind a gear. The conversation and composer stretch with
  the window, and recent desk records live in Activity instead of below replies.
- Repairs cover Dream training targets and worker/Stop handling, Plan edits,
  late hearth messages, downloads, image intake and continuity reads.

The initial local training backend is Ubuntu 24.04 / WSL 2 on an NVIDIA GPU.
Model-quality improvement is not promised by a completed training run. Features
listed as Coming later remain future work. See VERIFICATION.md, PREVIEW-LIMITS.md
and UPGRADE-NOTES.md; version 1.0 uses workspace format 4 and backup format 8.

Feedback and reproducible bug reports are welcome through the repository's Issues.

## 0.99.0 — 10 November 2026 · review candidate

Concentric rings replace the Desk Model squiggle. A saved personal-model picture appears in the same button when available, and unreadable pictures fall back to the rings. Message gears and local Dreams are retained. Visible version labels now agree with the candidate version.

Prepared for separate technical reviews before a 1.0 release and website update. No public publication is included in this candidate step.

## 0.11.0-preview.1 — 10 November 2026 · local working preview

Local cleanup: message actions now open from a gear beside the timestamp. Group prompts save their original text into Dream notes, and Make image opens an editable Easel request while retaining prior Easel work. Repeated action rows and the routine Chair assignments label are removed.

- Mark conversation passages, ranges, branches or desks for Dreams; add editable
  conversation/workflow notes manually or from a text file. Warm and cool tints
  distinguish the two purposes.
- Choose the preparation model in Settings → Dreams, train included Qwen locally,
  and try, adopt or return from a saved generation. The first backend is WSL 2 /
  Ubuntu 24.04 with an NVIDIA GPU. Stock models and original notes stay available.
- Start, Stop, Suspend/Resume, temporary pause/Cancel, in-app schedules, model
  pictures, observed Dream history and complete artifact backups are connected.
- Usual Coats now collapses as one section.

Qualified with synthetic material on an RTX 4070; see VERIFICATION.md and
PREVIEW-LIMITS.md. This preview has not been published as a public release.

## 0.10.3-preview.1 — 9 November 2026

This release brings the current local-model and crew improvements into the Windows package.

- Search your model folders, select a GGUF to read its description, then explicitly Add it. Files stay where they are; Remove only removes the saved connection. Search Online opens Hugging Face.
- Added local files use Branchline's owned runner and share its single local slot with included Qwen. Loading, waiting, Stop and cleanup use the existing reply pipeline. Base models use text completion.
- A shared goal belongs to the current conversation and chairs. Busy-chair messages can queue first, steer supported work, or wait in Queue only mode. Idle chairs do not generate empty progress reports.
- Optional reasoning notes offer 10/30/60-second cadence. Pings wait behind current work and coalesce instead of interrupting it.
- Coats present one current choice; editing affects future replies while earlier evidence remains. Select all and Clear all make pocket selection easier.
- Subscription meters show percent left. Recorded input, output, cache and reasoning usage is grouped by chair, with individual exchanges available underneath.

The normal installer still includes stock Qwen. Personal model files, accounts and workspaces are not distributed. Existing v0.10 shared-desk, picture and provider behavior remains. Dreams and built-in training are still under development. See VERIFICATION.md, PREVIEW-LIMITS.md and UPGRADE-NOTES.md; the separate installer record describes package checks.

## 0.10.2-preview.1 - local working draft

- Conversation-scoped goals, explicit next steps and named waits; no idle status model calls.
- User-configured chairs and Coats, full Unicode mentions, shared goal work on Blackboard.
- Queue first, Steer directly and Queue only; editable queued input and targeted ChatGPT steering with recorded acknowledgements.
- Saved unsent messages wait for explicit resume after closing. Other chairs retain independent work and Stop controls.
- Account allowance windows, reported chair tokens and passive local resource measurements. NVIDIA GPU readings are device-wide; unsupported sensors remain unavailable.

See [the usage guide](CREW-GOALS.md) for scope, limits and qualification. Public v0.10.0 is unchanged.

## 0.10.1-preview.1 - local working draft

- Optional Reasoning notes, saved per conversation, with 10/30/60 second choices.
- Pings wait for current work; one pending ping per chair task, cleared by off, Stop or completion.
- Source-labelled provider summaries and authored checkpoint notes, with live display, Details, recorded-work history and preserved corrections.
- Notes remain outside automatic shared desk context. Ordinary replies, progress and independent Stop retain their existing behavior.

This candidate is local; the public v0.10.0 release is unchanged. See [Reasoning notes](REASONING-NOTES.md).

8 November 2026 · Version 0.10.0 · Windows x64 · Pre-1.0 release

This release brings the current shared-desk working build into the public package, including stock Qwen3.5-4B for local use.

- ChatGPT chairs can work concurrently through one connection, with separate tools, streams, Stop controls and persistent drawers. The required code-mode host is included and hash-checked.
- Select calls the highlighted chair, Alternate takes turns, and All sends a prompt to every occupied chair. @chair groups can add individual directions without requiring them for every participant.
- The compact header shows visitors side by side. Scroll arrows appear only toward hidden chairs; the arrangement menu changes chair order separately.
- Attached pictures follow the addressed chairs. Each admitted request retains the same selected image, including queued recipients. A chair without image support receives a named result while capable peers continue. One shared picture stays with the human message.
- Home reuses equivalent folder access while retaining additional Home-only readers. Default Coats offer already-granted file tools; explicit custom choices remain respected.
- Drive-root file access, virtualized recovery paths, resolved error notices and selected-text copying are repaired. Original file bytes and conversation records remain recoverable.

The ChatGPT account status and returned models remain visible in Settings. Model availability and usage limits depend on the signed-in connection. The included local runner has one active request slot; Activity shows why queued work is waiting.

Dreams and built-in local training remain under development. v0.10 does not represent their completion or a 1.0 release. Public Book of PEACHES stamps and other held features remain identified in PREVIEW-LIMITS.md.

Back up the actual workspace before upgrading, and keep that copy for an older app. Read UPGRADE-NOTES.md. Earlier releases remain available.

The feature build passed 33 backend tests, five browser flows, a real concurrent Astra/Sol/Luna image test and native history/image close-reopen checks. This release's INSTALLER-VERIFICATION.json records the final rebuilt-package, local-model and installation/repair/uninstall checks.
