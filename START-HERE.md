# Welcome to Branchline v0.8.12-preview.3

## Install and talk

**Easiest download:** open `Install-Branchline.exe` from this release. It downloads
and checks the matching Setup files, then offers to open Setup. Completed files
are retained for retry or offline use. You can choose their download location.
See [INSTALL-WITH-AI.md](INSTALL-WITH-AI.md) if an assistant is helping you.

**Offline installer:**

1. Keep `Branchline-v0.8.12-preview.3-Setup.exe` and every matching `Setup-*.bin` part in the same folder. Open Setup.
2. Choose **Branchline with Qwen** (the default), or **App only** to bring your own model. Choose the install location; no separate Node.js or .NET installation is needed.
3. On a fresh workspace the Personal chair contains **Qwen3.5-4B · Local**. Send a message. The first reply checks the included files and loads the model; later replies reuse it. The Visiting chair stays free.

Setup includes the model, picture adapter, CPU and Vulkan runtimes, and Microsoft's offline prerequisites. It may ask for Windows permission to install the C++ runtime. If a prerequisite needs a restart, Setup stops with an explanation; restart Windows yourself when convenient and rerun Setup. No model account or first-use model download is required.

The included model and picture adapter account for about 3.15 GiB, in addition to
the app and runtimes. Setup's component estimate includes these files. Upgrades
need extra free space to preserve recovery options.

If Setup reports a C++ problem, keep its log from your Windows temporary folder
(`Setup Log ...txt`), or start Setup with `/LOG="path-to-a-log.txt"` to choose a
location. The log distinguishes a Microsoft installer error from a successful
installation whose required 64-bit libraries could not be verified. No app files
are replaced at that prerequisite step. Avoid repeatedly reinstalling without
checking this distinction; see [BUG-REPORT.md](BUG-REPORT.md).

Existing conversations, model choices and intentionally empty chairs stay as you left them. To add Qwen to an existing workspace, open **Settings → Models → Included Qwen**, add it to your models, then select it for a chair. This is the public stock Qwen model; no private Hearthline training or chats are included.

**App-only portable ZIP:** extract the whole ZIP, then open **Branchline.Preview.exe**. That ZIP has no Qwen weights or prerequisite installers. WebView2 must already be installed. The full installer is the easiest first download.

This preview is unsigned. Verify the source and SHA-256 before deciding to open it. A matching checksum confirms bytes, not the identity of an unknown sender.

The publisher and optional future stamp service are described in [ORIGIN.md](ORIGIN.md).
No Branchline account, purchase or stamp is required to use this app.

Target: Windows 10 build 19041 or later / Windows 11, x64. Keep Windows supported and updated. ARM64, Linux, macOS and phones are not qualified. See [LOCAL-MODEL.md](LOCAL-MODEL.md) for memory, performance and recovery guidance.

## Other model connections

For a local model, install [LM Studio](https://lmstudio.ai/), choose a model
that fits your computer, and start its local server. In **Settings → Models**,
use **Check available models** beside LM Studio. The normal server address
is `http://127.0.0.1:1234/v1`. For another port or identifier, open
**Advanced · add a model manually** and enter the connection yourself.
Choose it for a chair at your desk. Adjust model loading and GPU memory in
LM Studio; two resident models can compete for memory even though Branchline
requests replies one at a time.

For a ChatGPT visitor, use **Settings → Models → Connect ChatGPT / choose models**.
Finish sign-in on OpenAI's page, return to Branchline, and choose an available
model for the Visiting chair. This uses your eligible ChatGPT account and its
shared usage limits. It has separate account storage from the Codex desktop app.
Availability can depend on your plan and the provider. A listed model is not a
guarantee that a request will succeed.

Home's **Toy Shelf** holds these starting places. **Manage Shelves** opens its
arrangement settings; the lower grip adjusts its remembered height. **Sketch
Book** stays a separate shared collection. See TOY-SHELF.md for controls.

**New desk** starts a conversation space. Personal and visiting chairs remain
swappable. Play, Create and Work set the conversation’s base orientation.
One decorative empty shelf slot leaves room for future additions.

## What gets shared

The included Qwen keeps conversation inference on this device. Microsoft WebView2 and C++ prerequisites retain their own terms; WebView2 may update and collect diagnostic data under Microsoft settings and [privacy terms](https://aka.ms/privacy). Optional network tools and external model connections have separate destinations.

Local LM Studio connections send the selected conversation to the local server.
ChatGPT connections send selected context to OpenAI. Check the chair's connection
before sending; a selected agent profile needs sharing clearance for that destination.

You can attach UTF-8 text and still PNG, JPEG or WebP pictures. Image input needs
a compatible model. Preview and remove pictures before sending. Originals stay
local; the transmitted viewing copies are oriented and stripped of metadata.
Images and imported documents are evidence, not permissions. PDF, Word, video
and audio ingestion are not included in this preview.

Tools are optional. Public-page retrieval asks for the exact destination before
connecting. PC text tools need folder and recipient grants in Settings → Agents,
enabled Coat pockets and the chat's Tools switch. Programs and screen control
are unavailable. See [PC-ACCESS.md](PC-ACCESS.md) for setup, exclusions and recovery.
No native provider shell is exposed. Branchline's file broker is an application
boundary, not an operating-system sandbox. A model can still
make a wrong claim or falsely say it used a tool; inspect recorded receipts when
the source of a claim matters.

## Keep and recover your work

Normal app data lives at:

```text
%LOCALAPPDATA%\Branchline Preview\0.7.0
```

That folder name is deliberately stable across updates, including v0.8.
It holds the workspace, backups, WebView2 data and separate account state.
The app folder and the data folder are separate. Moving the app folder does
not move or erase your conversations. Only one app may write that workspace.

In **Settings → Workspace**, create a backup before importing or restoring
work, and before trying an update. Use the app's workspace export for a portable
copy. Treat exports and backups as private: they can contain conversations,
instructions, selected text, and images. Keep a copy on another drive if losing
the computer must not lose your work. Account credentials are not a portable
sign-in transfer; reconnect your own account on another computer.

To update an installed copy, back up your workspace, close Branchline, and run
the new Setup in the same install location. For a portable copy, extract the
new ZIP into a new folder. Keep the previous app and pre-update backup until
you have checked your conversations. Both routes use the same stable data
folder; only one app may open it at a time.

**Going back to an older version:** use its preserved workspace or a verified
pre-upgrade backup. New reply records, Coats, handoffs and model connections may
be unreadable to an older app. In particular, v0.8.0 can refuse a newer reply
record even when Qwen was never added. Keeping the old executable alone is not a
rollback of the data. Preserve the current workspace too; never delete it to
resolve a compatibility issue.

A writer-lock warning means another process may own the workspace. Close its
Branchline window normally and try again. A live process ID can also have been
reused after a crash; this preview conservatively leaves that lock in place.
Preserve the workspace and inspect the owner before attempting manual recovery.
Do not delete a lock just because another window is not visible.

**Restore a copy** verifies a backup and writes a separate recovered folder;
it does not replace the open workspace. To recover the normal app, close it,
rename its existing `workspace` folder to keep it safe, then copy the recovered
folder into the stable data folder above and name that copy `workspace`.
Reopen Branchline and check your conversations. Keep both the original and the
backup until you have verified the recovered work. The workspace export is an
additional readable copy; this preview does not have a general export-import wizard.

To remove an installed copy, close Branchline and use its entry in Windows
Settings → Apps. Uninstall removes the installed app and model while preserving
conversations, user-created files and shared Microsoft prerequisites. For a
portable copy, delete only its extracted app folder and shortcuts. Leave the
separate data folder; deleting it removes saved work and is a separate decision.

## Coats and pockets in 0.8.2

Use **My Coats** on Home or the **Coat** button between the chairs.
See [COATS.md](COATS.md) before trying saved pocket choices.
Back up before updating: new Coat versions and tool receipts need 0.8.2.
Use a pre-update backup with an older app; do not edit the journal to downgrade.

## Conversation and resources

See [CONTINUATION.md](CONTINUATION.md) for the thought cloud, handoff preparation, sharing across intentional model changes, Resources, bounded text reading, Stop and the welcome tour. This candidate uses newer tool receipts; keep a backup and a separate workspace when comparing it with an older release.
