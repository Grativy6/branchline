# Branchline v0.10

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
