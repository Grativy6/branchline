# Start with Branchline 0.10.3-preview.1

Branchline is a Windows x64 preview for conversations and shared work with AI. The full installer includes stock Qwen3.5-4B for local replies and supported pictures. No Branchline account is required.

## Install

Download **Install-Branchline.exe** from [this release](https://github.com/Grativy6/branchline/releases/tag/v0.10.3-preview.1). It downloads the matching Setup executable and data parts, checks their hashes, and opens the ordinary installer. Choose the full installation to include Qwen. The default location is your Windows user's Local AppData Programs folder.

For an offline installation, download `Branchline-v0.10.3-preview.1-Setup.exe` and every matching `Setup-*.bin` file. Keep them together. Compare their hashes with `SHA256SUMS.txt`, then run Setup. Do not mix parts from different releases.

Windows 10 build 19041 or later, x64, is the supported OS floor. The included model needs at least 4 GiB of available memory to start; larger context windows need more. Performance depends on your CPU, available memory and compatible GPU. The app is unsigned, so Windows may display a warning. If Windows blocks it, stop and inspect the publisher, source and checksums; do not disable security protections.

Setup offers a desktop shortcut. The app-only portable ZIP is for people supplying their own model or reusing a separately verified model bundle; it omits the Qwen weights and prerequisite installers.

## Keep existing work

Close Branchline and make a verified copy of your existing app and workspace before updating. Existing installations may use a custom workspace path; check the shortcut's `--data-dir` option and Settings -> Workspace. The installer does not copy your conversations into the new package.

Starting chair work, including an ordinary model reply, writes workspace format 3. Preserve the pre-update workspace for an older app. Do not point an older version at an upgraded workspace. Restoring old data and returning to an old application are separate choices; keep newer conversations when deciding what to recover.

## Try a desk

1. Open Branchline and choose the included Qwen for the first local check.
2. Send a short greeting. Close and reopen the app to check that it remains.
3. For ChatGPT, sign in under Settings -> Models. Its returned models appear automatically; there is no per-model import step. Add another chair when you want a second participant. Name chairs clearly; names are used by `@chair` shortcuts.
4. Select a highlighted chair, use Alternate for turn-taking, or choose All. A shared question followed by `@qwen @astra` calls just those chairs. Optional text after each address gives that chair extra direction; the opening text is shared. Attached pictures follow the same recipients.
5. Open **Activity** to see running, waiting and finished tasks. Open **Drawers** to inspect recorded chair work. Each drawer remains tied to its chair.

Use `@{A Chair With Spaces}` for a longer name. A message with an unknown or ambiguous recipient is held before any of its sections are sent. Quoted text, code, escaped mentions and email addresses do not intentionally route tasks.

The cloud icon opens context controls. The desk ceiling is an estimate; the selected model and its loaded window can impose a smaller limit. Qwen offers 8K, 16K and 32K choices, subject to available resources. A context handoff is optional, and saved original history remains available.

Choose Home folders, memory modes, tools and provider connections yourself. A connected provider receives the context selected for its request. Drawers are separate working records within your workspace, not a promise of cryptographic secrecy from the workspace owner.

[Preview limits](PREVIEW-LIMITS.md) · [Verification](VERIFICATION.md) · [AI-assisted installation](INSTALL-WITH-AI.md)
