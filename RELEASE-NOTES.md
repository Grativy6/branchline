# Branchline 0.9.1-preview.2

6 November 2026 · Windows x64 preview

This release brings the working 0.9 desk features to the public download: chair drawers, simultaneous tasks through independent connections, an Activity list across desks, and `@chair` routing within one prompt.

Each chair keeps its own unfinished work. Published desk work is shared; reading another chair's log remains clearly attributed inspection. A single message can give different sections to different chairs. Activity shows which tasks are working, preparing or waiting for a runtime slot, with independent cancellation.

The release also includes the current Toy Shelf, memory and Plans settings, Home context selection, and context controls in the cloud window. The included Qwen can select an 8K, 16K or 32K window; the UI distinguishes selection from the loaded runtime. Context handoffs are optional.

Release qualification caught and corrected two Activity issues: a panel could extend beyond the viewport after its contents changed, and a chair's reply could briefly appear twice while its started event was still being saved. The checks now include narrow viewports and the latter timing state.

The native host was rebuilt from the recovered pinned desktop source, with the version changed to 0.9.1-preview.2. The stock model and other runtime inputs retain their verified hashes. No personal workspace, Home selection, account connection or private trained model is included.

Read [START-HERE.md](START-HERE.md) before updating and keep a verified backup. Drawers use workspace format 3; rollback to an older app requires the preserved older workspace. The [previous public preview](https://github.com/Grativy6/branchline/releases/tag/v0.8.12-preview.5) remains available.

The full installer, matching data parts, download helper, app-only ZIP, application source and native-library source companion are supplied together with hashes. See [VERIFICATION.md](VERIFICATION.md) and the attached installer qualification record for what was checked.
