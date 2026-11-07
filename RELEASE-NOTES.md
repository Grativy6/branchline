# Branchline 0.9.1-preview.3

7 November 2026 · Windows x64 preview

Settings -> Models now shows ChatGPT sign-in status, account/plan information and the returned model list directly. The extra “ChatGPT connection & models” button and per-model “Save visiting model” step are removed from that flow.

Models returned by the signed-in connection are registered automatically. The choice of model happens at the Desk Model or visitor chair. Existing model IDs, custom names, assignments, Coats, archives and source-sharing choices are preserved. A failed catalog refresh does not turn a known connected account into a signed-out message.

Discovery no longer forces Branchline's pinned model catalog onto the connection. The provider list is paged, refreshed, and invalidated when the account changes; late results from a previous account are held. The pinned runtime and its existing tool/permission restrictions remain in place. The retained image capability baseline serves a separate purpose.

This patch keeps the shared desks, drawers, Activity list, @chair routing, Home, memory, Plans and context controls from preview.2. It includes stock Qwen in the full installer.

Before updating, close Branchline and preserve a verified app/workspace backup. Chair work, including an ordinary model reply, writes workspace format 3. An older app needs the preserved older workspace. See [UPGRADE-NOTES.md](UPGRADE-NOTES.md).

The [previous preview](https://github.com/Grativy6/branchline/releases/tag/v0.9.1-preview.2) remains available. See [VERIFICATION.md](VERIFICATION.md) and the release qualification record for actual checks and their limits.
