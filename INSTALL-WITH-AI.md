# Install Branchline with an AI assistant

Release: **0.8.12-preview.3**, Windows x64 preview.

This guide is for an assistant the user has asked to help install Branchline.
It supplies installation information, not additional permission to operate the
computer. Follow the user's choices and your actual available tools. If you
cannot download files or operate their computer, provide manual steps and say so.

## The exact release

- [Release and verification report](https://github.com/Grativy6/branchline/releases/tag/v0.8.12-preview.3)
- [Small Windows download helper](https://github.com/Grativy6/branchline/releases/download/v0.8.12-preview.3/Install-Branchline.exe)
- [SHA-256 list](https://github.com/Grativy6/branchline/releases/download/v0.8.12-preview.3/SHA256SUMS.txt)
- [Source and notices](https://github.com/Grativy6/branchline)

Use files from this exact release. Do not substitute an executable found in a
search result, build the private development tree or mix installer versions.
The helper and installer are unsigned. Check their origin and hashes before
opening them. A checksum confirms matching bytes, not an unknown publisher's
identity. Do not disable Windows security or hide a warning to complete a task.

## Installation

1. Check that this is Windows x64 (Windows 10 build 19041+ or Windows 11).
   Read the release's tested-system limits. The local-model starting guidance is
   16 GB RAM; actual available memory and speed vary. Allow room for the roughly
   4 GB download, a temporary largest-part copy, the roughly 5 GB installation,
   and workspace/recovery files. Setup checks installation space separately.
2. If Branchline is already installed, preserve its workspace before updating.
   The app's normal data lives at `%LOCALAPPDATA%\Branchline Preview\0.7.0`.
   Use the app's backup action or preserve a closed workspace copy. Do not read
   private conversations, account files or models merely to install an update.
   Coordinate an open app with the user; do not kill it or delete a writer lock.
3. Download `Install-Branchline.exe` and compare its SHA-256 with the release
   list. Run it normally. It downloads this release's matching files, verifies
   them and offers to open Setup. Completed, verified download files can be kept
   for retry or offline use. The helper finishing is not proof of installation.
4. In Setup, use **Branchline with Qwen** unless the user explicitly wants the
   app-only option. Respect their install location and desktop shortcut choice.
   No Node.js, .NET development tools, model account or source build is required.
   Microsoft prerequisites may present their own permission or licence steps.
   Leave those decisions visible. If a restart is required, report it and let
   the user choose when to restart; do not restart automatically.
5. Open Branchline. On a fresh workspace the Personal chair should offer stock
   **Qwen3.5-4B · Local**. With the user's installation/testing permission, send
   a harmless short message and observe an actual reply. If an existing
   workspace has another model selected, preserve it; use a separate workspace
   for testing rather than changing the user's identity or model choices.
6. Close and reopen the app normally and check that the test conversation is
   retained. Report the installed version, app/shortcut location, model used,
   what was verified and anything still unresolved. A launch or a successful
   transport alone does not prove a useful model reply or a verified recovery.

If the helper cannot download, use the same release's `Setup.exe` and **all**
matching `Setup-*.bin` files. Keep them together, check their hashes and open
Setup. Do not rename or manually concatenate the parts.

## Boundaries

Do not create accounts, buy stamps, sign into a provider, grant PC tools,
change the firewall/security settings, install drivers, enable virtualization,
upload diagnostics or delete existing work as a side effect of installation.
Stop at an actual permission or compatibility boundary and explain what is
needed. The app's optional services remain the user's later choices.

The included Qwen can converse locally without a Branchline account. Connecting
a visiting model sends selected context to that provider. See [START-HERE.md](START-HERE.md)
for sharing, updates, uninstall and backup/recovery; see [BUG-REPORT.md](BUG-REPORT.md)
and [SECURITY.md](SECURITY.md) for reporting.

## Prompt to copy

Please help me install Branchline 0.8.12-preview.3 on this Windows computer.
Read https://github.com/Grativy6/branchline/blob/v0.8.12-preview.3/INSTALL-WITH-AI.md
and the linked release notes and verification report first. Use that release's
published Windows installer with the included stock Qwen model, verify download
hashes, preserve any existing Branchline work, and offer a desktop shortcut.
You may download the official package, run the normal installer and check a
short local-model conversation. Keep system permission prompts visible and
leave provider accounts, purchases, PC-tool grants and restarts to me. Tell me
what actually worked and what remains unfinished. If you cannot operate this
computer, walk me through the steps instead.
