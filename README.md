# Branchline 1.1

A local home for conversations, ideas and shared work with AI. Keep your desks, branches and history while choosing the models you work with.

[Download Branchline 1.1 for Windows](https://github.com/Grativy6/branchline/releases/tag/v1.1.0) or start with [START-HERE.md](START-HERE.md). The normal installer includes stock Qwen3.5-4B. It needs no Branchline account or purchased stamp. This is an unsigned Windows x64 application.

## New in 1.1

Long code and tool output fold into Copy / Expand panels. **Continue from this handoff** starts a fresh working input and keeps old tool output retrievable instead of replaying it. Failed requests that never started can return to the draft. Coats can tint their authors’ cards and optionally retain generated thinking notes in their own drawers. Starter Coats have fixed colors; your own Coats can be customized. Shared work cards stay off the chat by default, and old unsent requests can be discarded. Ordinary chair replies have no Branchline elapsed-time cutoff; Stop stays available.

A compact return map now keeps current shared artifacts and the chair’s last work visible without slicing the middle of the context record. All broadcasts appear once in working history with their recipients; original messages remain saved.

## Foundations from 1.0

The 1.0 repair pass adds interrupted-save recovery, process-owned writer locking,
compact exact-input storage, corrected Dream training masks and stable Resume data.
It also repairs Plan rescheduling, late hearth clarifications, downloads and image
intake contention. [Upgrade and recovery](UPGRADE-NOTES.md) explains the retained
workspace location and how to open a restored copy. The conversation fills the
available window width, message options live behind their gears, and desk activity
records open from Activity instead of taking space beneath the last reply.

[Pony Post](PONY-POST.md) now carries mail between different desks through its own saved home. Each desk has one On/Off switch and a receiving conversation/chair. Notices make no model call; requests join the receiving chair’s queue. Returns wait at Pony Post when a desk is off. Open it from the Toy Shelf or Activity, or send a message using its gear. Earlier helper-task trip records remain readable.

The Desk Model menu button uses concentric rings, or the selected personal model’s saved picture when available. The button stays beside the name, inset within the card border, with the same size and menu behavior.

[Dreams](DREAM-REVIEW.md) can now prepare chosen conversation or workflow notes, train the included Qwen locally, and export a new generation to try or adopt. The original stays available. The first supported training backend is Ubuntu 24.04 / WSL 2 on an NVIDIA GPU. Home contains the note list and job controls; Settings → Dreams chooses the preparation model. Usual Coats is now one collapsible section.

Find compatible GGUF files on your computer, preview their descriptions, and add them through the [local-model library](LOCAL-MODEL.md). They load when used. Subscription meters show the allowance left, and recorded usage is grouped by chair. [Conversation goals and queue/steer](CREW-GOALS.md) keep shared work organized. Optional [reasoning notes](REASONING-NOTES.md) use 10/30/60-second choices and wait behind current work. Coats have one current choice, with Select all and Clear all for their tool pockets.

[How to use the new features](public/how-to.md) is also included at the desk’s **… → How-to guide** and Settings → About & licences. Keep this guide current when adding user-facing controls.

## ChatGPT connection

Settings -> Models shows the account status and returned model list directly. Models from the signed-in connection are registered automatically, so you choose a model at the chair instead of saving each one first. Refresh retains existing model IDs, custom names, chairs, archives and source-sharing choices.

Message options live behind the gear beside each timestamp: Dream notes, sketches, memory, images and Details. The menu floats over the chat and retains the chosen message while other chairs reply.

## Work at the same desk

Each chair has a drawer for its unfinished work. Chairs can inspect another chair's recorded log without treating that record as their own experience. Work brought onto the desk becomes shared context.

Select the highlighted chair, Alternate through occupied chairs, or choose All to send the prompt to everyone. The small Desk Model icon opens its menu; clicking the chair information selects it. Address chairs in one message with `@chair` sections. For example, `@qwen Draft a greeting. @astra Check the greeting.` sends each section to its named chair. Independent requests can work at the same time. A trailing address needs no extra instruction: that chair uses the shared opening and its Coat. Explicit addresses override the default recipient mode. Activity shows tasks across desks, their waiting reasons, individual Stop controls and recent results.

The included local runner has one active request slot. ChatGPT chairs can run concurrently through one app-server connection, with each thread retaining its own tools, stream and cancellation. Provider limits still apply. Local file operations wait briefly for the file adapter without blocking other model work.

Home reuses existing access to its selected folders. Normal Coats inherit granted file tools; deliberate custom tool selections remain respected. Additional Home-only readers are optional for connections without general folder access.

All keeps the composer clear; explicit @chair sections show a routing preview. Copying a highlighted conversation supplies only that selected fragment, with its formatting. Background updates leave unchanged conversation text in place.

The compact header puts visiting chairs side by side. Scroll arrows appear only toward chairs that are out of view; the arrangement menu moves the selected chair earlier or later without confusing order with scrolling.

Attached pictures follow Select, Alternate, All and explicit chair groups. One saved picture is shared with the addressed requests, including queued chairs. A chair without a usable image route gets a named result while capable chairs can continue. Partial failure or cancellation keeps the picture available; a fully successful group clears unpinned pictures from the next prompt. Keep in view and Look again remain available.

## Also included

- Desks, branches, streaming replies, Coats, selected sources and saved original history.
- Sketch Book, Blackboard, Easel and Plans on the Toy Shelf.
- Memory controls and a selected Home directory for continuing personal context.
- Context controls directly from the desk's cloud indicator, including the desk ceiling and the included Qwen's 8K, 16K or 32K window. A selected size is distinguished from one actually loaded.
- Optional context handoffs, local backups and export/restore.
- Local Qwen and separately chosen provider connections, including the existing ChatGPT sign-in route.

Read [PREVIEW-LIMITS.md](PREVIEW-LIMITS.md) and [VERIFICATION.md](VERIFICATION.md) for practical boundaries and the checks actually performed. Back up an existing workspace before updating. Chair work, including an ordinary model reply, creates workspace format 4; an older app needs the preserved older workspace copy for rollback.

## Development and packaging

Use Node.js 24.19.0 or later. `npm ci`, `npm test`, `npm run test:browser`, and `npm run test:connections` run the supplied source checks with synthetic data. Browser tests use Edge on Windows and the pinned Playwright Chromium headless shell on Linux. Install the latter with `node node_modules/playwright-core/cli.js install chromium --only-shell` after installing its normal system dependencies.

The native host targets .NET 8.0.29 and WebView2 SDK 1.0.3296.44. The release was built with .NET SDK 10.0.302. Its recovered desktop source is identified in `provenance/desktop-source.json`; the version change is recorded there. This source is an allowlisted public snapshot, not the private development repository or its full history.

The Windows binary payload keeps hash-pinned Node, Python, Codex, dependency and optional model inputs in `provenance/runtime-files.json`. An extracted Windows package supplies those input bytes; the native host and first-party application are rebuilt from this source. Keep Windows runtime inputs separate from Linux `node_modules`.

```powershell
pwsh -File scripts/Build-Preview.ps1 -RuntimeFolder C:\BuildInputs\Branchline -WithModel
pwsh -File scripts/Build-Installer.ps1 -PackageFolder releases/Branchline-v1.1.0-Windows-x64 -InputFolder C:\BuildInputs\Prerequisites -Compiler C:\BuildTools\Inno\ISCC.exe -OutputFolder releases/Installer
```

The installer inputs and their hashes are in `provenance/installer-inputs.json`. Existing outputs are never merged by the build scripts. The native-library source companion accompanies the binary downloads. No personal workspace, account credential, Home selection, private memory or trained adapter is part of this release.

## Licence and support

Copyright 2026 Christopher Daniel Pang. The first-party application is [Apache-2.0](LICENSE); retain [NOTICE](NOTICE) and [LICENSE-SCOPE.md](LICENSE-SCOPE.md). Included components keep their own terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the offline licence viewer.

[Report a problem](BUG-REPORT.md). Branchline does not automatically upload your conversations or diagnostics. [Earlier public release](https://github.com/Grativy6/branchline/releases/tag/v0.8.12-preview.5).
