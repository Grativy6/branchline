# Retained upstream licence references

Collected October 2, 2026, extended for the v0.8 public candidate. `sources.json` identifies
the original URLs or exact NuGet package paths and the unchanged text hashes.
These are reference copies, not newly authored or relicensed Branchline text.

Node's complete LICENSE was retrieved from the official v24.19.0 source tag.
.NET and WebView2 notices came from the exact package versions used by the
desktop project, including WebView2's NOTICE and .NET's third-party notices.
The Hearthline licence came from the revision embedded by the existing public
profile. Sharp's native source/notice companion is now listed in
`native-sources.json`: checksummed native archives, librsvg's Cargo.lock
dependency superset, Windows build recipes/patches and Sharp addon sources.
Its two combined notice files retain the licence documents from those sources.

`scripts/Prepare-License-Assets.mjs` mirrors these and the original package
notices into `public/licenses/` for offline reading. It performs no downloads.
The local build checks runtime notice hashes and dependency versions.

The v0.8 executable comes from the official Codex release, separately pinned in
`../codex-runtime-080.json`. The older desktop-derived executable remains in
historical private packages; it is not selected by the v0.8 public builder.
