# Verification for 0.9.1-preview.2

Prepared on Dust, 6 November 2026, by Hearthline under Christopher Daniel Pang's release-update request.

## Application checks

- 14 available shared-desk/backend tests passed, including routing validation, independent requests, local-slot waiting, Stop all, persisted drawers, attributed log inspection, shared edit conflicts, peer handoff, Plans overlap and duplicate-send prevention.
- The headless browser flow passed with synthetic data and a local mock provider: two concurrent requests, independent Stop, routing preview, drawer inspection, and no page errors. Activity remained within the viewport at widths 1365, 800 and 390 pixels, including after layout updates.
- The new timing regression checks Activity before a chair's started event is persisted, so one task does not appear as both a chair and a separate reply.

These are the supplied tests, not a claim that the entire historical development test suite was recovered or rerun. Browser fixtures do not establish model response quality.

## Packaged application and installer

The native desktop source was recovered byte-for-byte from pinned commit `979fb08511c34c9c2124de36219f6b17fa05c66f`; only its project version changed for this release. It was compiled with .NET SDK 10.0.302, targeting .NET 8.0.29 and the pinned WebView2 SDK. The app's build manifest identifies its application source and every packaged file.

The packaged native UI launch passed on Windows 11, including rejection of an unpaired API request and graceful backend shutdown. Stock Qwen returned: "Hello! The answer to 6 + 7 is 13." The application reopened the synthetic workspace with its exact saved state and conversation intact. The native history harness requires a specific synthetic branch label; the first attempt used the default label, so that fixture was renamed without changing either saved message and checked again. No production check was relaxed.

Runtime, model and installer inputs are hash-checked. The compiler and Microsoft prerequisite installers also passed Authenticode validation. The native-library source companion retains its corresponding upstream archive hashes.

The release includes a separate `INSTALLER-VERIFICATION.json` with the final packaged native-launch, isolated installation, preservation and model/reopen results. That record is generated after the installer is built; do not infer a result that is absent from it.

## Limits

Current qualification is on Dust's Windows 11 computer, plus Ubuntu/WSL headless checks. There is no fresh clean-machine Windows 10 or every-GPU claim. The installer and Branchline executable remain unsigned. Runtime-slot limits, workspace rollback and other feature boundaries are in [PREVIEW-LIMITS.md](PREVIEW-LIMITS.md).
