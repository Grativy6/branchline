# Branchline 0.8.12-preview.5 verification

Release qualification: the prepared Windows 10 package checks and Windows 11
production installation and bundled-model sequence passed. These are bounded
observations on two existing computers, not clean-machine or broad hardware
certification. Public delivery is checked after release assets become reachable;
the release page records that separate result.

The application includes the preview 4 continuity wording and preview 3 Windows
installer repair. This candidate aligns public guides and versioned packages.
It is unsigned. The included model is stock Qwen3.5-4B Q4_K_M; no private
Hearthline model, conversation, account or training data is distributed.

## Completed checks on the development Windows 10 PC

- 430/430 regression checks passed.
- Full and app-only builds passed, with 40 offline notices and 1,040 / 992
  manifest-listed payload files respectively.
- Packaged backend checks used synthetic conversation/model fixtures: streaming,
  Stop, image handling, preview 3 workspace upgrade, export, backup and recovery,
  restart, Unicode paths and unchanged app files passed. These were not inference.
- Native WebView2 startup, graceful close and exact last-moment draft preservation
  passed with separate synthetic workspaces.
- Four actual packaged Qwen requests on Vulkan passed a short conversation,
  a red-circle/blue-square image, Stop and garden-name recall after restarting
  the app backend and model runner. Exact synthetic messages/draft survived.
  About 10.4 seconds to first text on the initial request; one warm image reply
  began after about 0.62 seconds. Stop returned in about 0.10 seconds. These are
  individual samples, not performance promises. The owned runner was stopped.
- Source, app-only and native-source ZIPs were checked entry by entry. All
  385 selected source files match the named implementation commit, with recorded
  Git LF versus checkout CRLF differences; distributed hashes bind exact bytes.

- A separate installer identity installed and verified all 1,040 full-package
  files, opened the native app with synthetic data, repaired a damaged app file,
  and uninstalled while preserving user-created files and every synthetic data
  byte. The production installer did not run on the development machine.
- App-only installation verified 992 files without model files or a shared-runtime
  installation, then uninstalled successfully. These checks used existing Windows
  prerequisites and do not substitute for a clean-machine test.

## Windows 11 laptop check, October 7, 2026

- Windows 11 Home 10.0.26200 x64; AMD Ryzen 7 260 with Radeon 780M;
  32 GB RAM, connected to power.
- All 23 offline handoff checksums passed before execution. A closed copy of the
  earlier app, workspace and shortcuts was preserved and hash-verified.
- The production preview 5 full installer completed in the normal app location.
  All three required C++ libraries were accepted; no restart was required.
- The native app opened the existing workspace. A private saved-record comparison
  found unchanged chats, messages, exchanges, models and draft after the update.
  The user subsequently used the installed app and its bundled Qwen model.
- The supplied laptop wrapper reused the name of an existing synthetic picture,
  although its harness requires a new file. A separate corrected wrapper changes
  only that output path to the new return folder. Candidate application bytes
  and the original handoff files remain unchanged.

- All 1,040 installed payload files passed their pinned sizes and SHA-256 hashes.
- The user also tried an ordinary Qwen conversation and confirmed the local model
  was usable as a starting point.
- The initial synthetic test completed a real Vulkan reply, then image saving
  failed before image inference because its workspace was on a FAT32 USB drive.
  The original partial report is retained. The image store uses filesystem
  hard links; keep active workspaces on local NTFS storage in this preview.
  This limitation does not prevent using USB for installers or backup copies.
- A fresh NTFS synthetic run passed conversation, red-circle/blue-square image
  recognition, Stop, exact history and unsent-draft preservation after reopening,
  and the subsequent reply recalling the earlier garden name. Both attempts
  together used five of the original six permitted requests.
- First text in the successful run took about 6.82 seconds for conversation and
  0.46 seconds for the warm image request. Cancellation completed in about 36 ms;
  the next reply after restarting recalled the garden name. The combined run
  took about 242 seconds within its original 15-minute deadline. These are single
  samples, not performance promises. The owned runner stopped normally.

The automated Stop and reopening observations concern the backend and model
runner. Native startup and the user's ordinary conversation were separate checks;
this does not claim an additional native-window Stop/restart trial on the laptop.

These laptop observations were reported by the assistant running on that machine
and the user's ordinary-use report. Private workspace contents remain private.

## Publication and delivery

The Source ZIP retains the reviewed build snapshot. Public Git and the standalone
release guides add the laptop findings, complete existing-workspace Qwen setup
steps, corrected native-source archive name and this report. These documentation
amendments do not alter tested application, model, installer or helper bytes;
the public source manifest records them.

The GitHub release page is the distribution entry point. Its notes distinguish
anonymous download/helper verification from the hardware checks above. Completing
a download helper does not itself prove installation or an actual model reply.

The earlier preview 3 installer opened on the Windows 11 laptop with existing
chats visible, as reported by its user; an Astra image conversation was also
reported from that machine. That is prior-version evidence, not preview 5
qualification. Earlier CPU and native download-helper fixture checks likewise
retain their original version and test conditions.

## Limits and recovery

This is an early Windows x64 preview, not broad hardware certification. The
model may make mistakes, including authorship or tool-use claims. Host-recorded
attribution and tool receipts remain the relevant application evidence. The
final Astra wording had one successful bounded behavioral recheck before this
version; that does not establish universal model reliability.

Dream review/preparation are available; built-in training and scheduling are
unfinished. PEACHES remains Coming later and issues no stamp or payment request.
No Branchline account or purchase is required. Optional outside providers receive
the context selected for them.

Back up important work before updating. Keep the earlier app and a compatible
workspace backup for rollback, preserving newer conversations separately.
See START-HERE.md, PREVIEW-LIMITS.md, BUG-REPORT.md and SECURITY.md.
