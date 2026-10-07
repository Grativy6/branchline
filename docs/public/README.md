# Branchline

A local home for conversations, ideas and shared work with AI. Keep personal
and visiting model chairs, organize branches into desks, and return to your
saved context when you change models.

**0.8.12-preview.3 source review — Windows downloads are not published yet.**
This branch contains the reviewed Windows x64 release-candidate source. The
installer and its download helper are prepared separately; this source PR does
not publish or install them. See [VERIFICATION.md](VERIFICATION.md) for completed
checks and the remaining laptop and public-download checks.

When published, the full installer will include the application runtimes and
stock Qwen3.5-4B for local conversation and pictures. Downloads will appear on
the [Releases page](https://github.com/Grativy6/branchline/releases). The
[getting-started guide](START-HERE.md) and [AI installation guide](INSTALL-WITH-AI.md)
describe that packaged route; their versioned download links are pending until
the release exists. The app and installer are unsigned previews.

## What works

- Personal model Dream journals, explicit earlier-entry organization, notes and local origin records. See [DREAM-REVIEW.md](DREAM-REVIEW.md).
- Streaming conversations, desks, branches, personal and visiting chairs.
- Included Qwen with CPU / Vulkan acceleration, plus local LM Studio connections and a separately signed-in ChatGPT visitor.
- Versioned Coats with selectable tool pockets and per-chair choices.
- Sketch Book: saved project memories, archives, source links and optional model tools. See [SKETCH-BOOK.md](SKETCH-BOOK.md).
- Selected text agent profiles, with sharing review.
- Selected text and still-image attachments for compatible model connections.
- Shared context accounts, original-message references and saved history.
- Bounded conversation tools and optional sequential approaches at the hearth.
- Guarded PC text-file tools with explicit folders, recipients and exclusions.
  See [PC-ACCESS.md](PC-ACCESS.md) before enabling them.
- Local backups, workspace export/restore, themes and optional reply statistics.

Dream training and scheduling, executable external agents and screen control
remain future work. Tend and Finis Solutus are retired from the active app;
existing conversations keep their saved history and instructions. Hearth approaches use recorded conversation and run sequentially; they
are not parallel inference or snapshots of a model's internal state.

See [COATS.md](COATS.md) for pocket choices and upgrade/rollback guidance.

## Build from this source

Use Windows x64, Node.js **24.19.0**, the .NET SDK (tested with **10.0.302**, targeting .NET 8), and PowerShell 7.
This source snapshot is a deliberate public export, not the private development
repository or its Git history. `source-manifest.json` identifies the files and
their hashes. Its publication amendments identify documentation changes made
after the tested snapshot; application and installer code remain byte-identical.
No conversations, account credentials or model weights are included.

```powershell
npm ci --ignore-scripts
dotnet restore desktop/Branchline.Preview.csproj --configfile desktop/NuGet.Config
dotnet build desktop/Branchline.Preview.csproj --no-restore --configuration Release
npm test
node scripts/Fetch-Release-Inputs.mjs
node scripts/verify-codex-runtime.mjs
node scripts/verify-conversation-tools-runtime.mjs
npm run licenses:check
pwsh -File scripts/Build-Preview.ps1
```

The input fetch downloads only named, hash-pinned public components. The build
does not sign in, run a model, replace an existing package, or publish anything.
The exact .NET and WebView2 SDK versions are pinned in the desktop project.
Source archives for native libraries are a separate release companion; the
build verifies the copies identified in `provenance/licensing/native-sources.json`.

For development, `npm start` opens a loopback server with its own `.local`
workspace. Follow the local address it prints. Never point a development run
or test at your everyday workspace. The test suite uses synthetic conversations
and preserves its `.test-data` files for inspection.

## Licence and support

Copyright 2026 Christopher Daniel Pang. The first-party application is
[Apache-2.0](LICENSE); see [NOTICE](NOTICE) and [LICENSE-SCOPE.md](LICENSE-SCOPE.md).
Included components retain their own terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Use [BUG-REPORT.md](BUG-REPORT.md) for a small, inspectable report. The app does
not automatically upload conversations or diagnostics. See
[PREVIEW-LIMITS.md](PREVIEW-LIMITS.md) before relying on this preview for important work.
See [SECURITY.md](SECURITY.md) for private reporting and [ORIGIN.md](ORIGIN.md)
for the publisher and the scope of the future optional stamp service.

## Build the full installer

Run the app-only build steps above first if you only need a portable build. For the full package, use a new output folder name:

```powershell
node scripts/Fetch-Bundled-Inputs.mjs .local/bundled-inputs
pwsh -File scripts/Build-Preview.ps1 -OutputName Branchline-v0.8.12-preview.3-Full -BundledInputFolder .local/bundled-inputs
```

Obtain the exact Inno Setup, WebView2 and VC runtime inputs in `provenance/installer-inputs.json` from their recorded public URLs. Verify their SHA-256 and publisher signatures. Install the selected Inno Setup locally, then pass its `ISCC.exe` to:

```powershell
pwsh -File scripts/Build-Installer.ps1 -PackageFolder releases/Branchline-v0.8.12-preview.3-Full -InputFolder .local/installer-inputs -Compiler 'PATH-TO-INNO/ISCC.exe' -OutputFolder releases/Branchline-v0.8.12-preview.3-Installer
```

The builder rejects altered payloads and prerequisite inputs. It embeds data-part checksums and checks the final part bytes against them, with a bounded rebind if the Setup header shifts a part boundary. All parts are below 2 GB. Keep the generated `build-inputs` directory private: it contains local build paths. Distribute only Setup, its `.bin` parts, reviewed instructions, checksums and the public verification report. The builder does not sign or publish the result.

The complete source for Branchline is in the Source companion; corresponding native-library archives remain in Native-Sources. Model weights and pinned upstream runtime binaries are separate inputs, recorded by URL, revision and hash in `provenance/bundled-model-inputs.json`.

## Conversation and resources

See [CONTINUATION.md](CONTINUATION.md) for the thought cloud, handoff preparation, sharing across intentional model changes, Resources, bounded text reading, Stop and the welcome tour. This candidate uses newer tool receipts; keep a backup and a separate workspace when comparing it with an older release.
