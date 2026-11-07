# Branchline 0.9.1-preview.3 Preview

A local home for conversations, ideas and shared work with AI. Keep your desks, branches and history while choosing the models you work with.

[Download the Windows preview](https://github.com/Grativy6/branchline/releases/tag/v0.9.1-preview.3) or start with [START-HERE.md](START-HERE.md). The normal installer includes stock Qwen3.5-4B. It needs no Branchline account or purchased stamp. This is an unsigned Windows x64 preview.

## ChatGPT connection

Settings -> Models shows the account status and returned model list directly. Models from the signed-in connection are registered automatically, so you choose a model at the chair instead of saving each one first. Refresh retains existing model IDs, custom names, chairs, archives and source-sharing choices.

## Work at the same desk

Each chair has a drawer for its unfinished work. Chairs can inspect another chair's recorded log without treating that record as their own experience. Work brought onto the desk becomes shared context.

Address chairs in one message with `@chair` sections. For example, `@qwen Draft a greeting. @astra Check the greeting.` sends each section to its named chair. Independent connections can work at the same time. Activity shows tasks across desks, their waiting reasons, individual Stop controls and recent results.

The included local runner has one active request slot. The current ChatGPT bridge also has one active tool-handler slot. Work using the same slot queues; a local chair and an independent connected chair can overlap. Multiple chairs do not create extra hardware or provider capacity.

## Also included

- Desks, branches, streaming replies, Coats, selected sources and saved original history.
- Sketch Book, Blackboard, Easel and Plans on the Toy Shelf.
- Memory controls and a selected Home directory for continuing personal context.
- Context controls directly from the desk's cloud indicator, including the desk ceiling and the included Qwen's 8K, 16K or 32K window. A selected size is distinguished from one actually loaded.
- Optional context handoffs, local backups and export/restore.
- Local Qwen and separately chosen provider connections, including the existing ChatGPT sign-in route.

Read [PREVIEW-LIMITS.md](PREVIEW-LIMITS.md) and [VERIFICATION.md](VERIFICATION.md) for practical boundaries and the checks actually performed. Back up an existing workspace before updating. Chair work, including an ordinary model reply, creates workspace format 3; an older app needs the preserved older workspace copy for rollback.

## Development and packaging

Use Node.js 22 or later. `npm ci`, `npm test`, `npm run test:browser`, and `npm run test:connections` run the supplied source checks with synthetic data. Browser tests use Edge on Windows and the pinned Playwright Chromium headless shell on Linux. Install the latter with `node node_modules/playwright-core/cli.js install chromium --only-shell` after installing its normal system dependencies.

The native host targets .NET 8.0.29 and WebView2 SDK 1.0.3296.44. The release was built with .NET SDK 10.0.302. Its recovered desktop source is identified in `provenance/desktop-source.json`; the version change is recorded there. This source is an allowlisted public snapshot, not the private development repository or its full history.

The Windows binary payload keeps hash-pinned Node, Python, Codex, dependency and optional model inputs in `provenance/runtime-files.json`. An extracted Windows package supplies those input bytes; the native host and first-party application are rebuilt from this source. Keep Windows runtime inputs separate from Linux `node_modules`.

```powershell
pwsh -File scripts/Build-Preview.ps1 -RuntimeFolder C:\BuildInputs\Branchline -WithModel
pwsh -File scripts/Build-Installer.ps1 -PackageFolder releases/Branchline-v0.9.1-preview.3-Windows-x64 -InputFolder C:\BuildInputs\Prerequisites -Compiler C:\BuildTools\Inno\ISCC.exe -OutputFolder releases/Installer
```

The installer inputs and their hashes are in `provenance/installer-inputs.json`. Existing outputs are never merged by the build scripts. The native-library source companion accompanies the binary downloads. No personal workspace, account credential, Home selection, private memory or trained adapter is part of this release.

## Licence and support

Copyright 2026 Christopher Daniel Pang. The first-party application is [Apache-2.0](LICENSE); retain [NOTICE](NOTICE) and [LICENSE-SCOPE.md](LICENSE-SCOPE.md). Included components keep their own terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the offline licence viewer.

[Report a problem](BUG-REPORT.md). Branchline does not automatically upload your conversations or diagnostics. [Earlier public release](https://github.com/Grativy6/branchline/releases/tag/v0.8.12-preview.5).
