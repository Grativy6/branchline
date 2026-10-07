# Branchline component notices

These notices identify the components of the Windows v0.8 preview. They do
not replace the accompanying full licence texts or relicense these components
under Branchline's Apache grant. Full texts are also available offline in
**Settings → About & licences** and `public/licenses/`.

## Included application components

- **Marked 15.0.12**: MIT and retained upstream notices, including its identified
  Markdown origins. Original file: `public/vendor/MARKED-LICENSE.md`.
- **QuickJS-Emscripten 0.32.0**: MIT, Jake Teton-Landis. Its core, FFI and four
  WASM variants retain their own LICENSE files, including the embedded QuickJS
  and related notices. The exact seven-package closure is recorded in the
  generated licence index and the package's `calculation-runtime.json`.
- **Sharp 0.35.5**: Apache-2.0, Lovell Fuller and others. Its packaged JavaScript
  dependencies are `@img/colour` 1.1.0 (MIT), `detect-libc` 2.1.2 (Apache-2.0)
  and `semver` 7.8.5 (ISC). Original notices remain in each package.
- **@img/sharp-win32-x64 0.35.5**: declared Apache-2.0 AND LGPL-3.0-or-later.
  Its README identifies the licences of the native libraries; that inventory,
  package LICENSE, versions list and the LGPL/GPL texts accompany this preview.
  Source notices for its 28 native libraries and librsvg's Rust dependency
  sources are included offline. The separately downloadable native-source
  companion carries their exact archives, the Windows build recipes and
  patches, and Sharp addon sources. See `NATIVE-SOURCES.md` and
  `native-sources.json` beside the app. Distribute that companion beside every
  binary download; the package's Apache file alone does not cover its native libraries.

## Hearthline founding orientation

**Christopher D. Pang**, *Founding orientation*,
[Hearthline revision eadc221fdce14088d2682994106f286b60e22888](https://github.com/Grativy6/hearthline/blob/eadc221fdce14088d2682994106f286b60e22888/docs/FOUNDING_ORIENTATION.md),
licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The licence at that revision was checked on October 2, 2026; its complete text
is included. `public/agent-profiles/hearthline.json` contains the complete
source document and a selected portable-wording block, with Branchline's
profile metadata around them. This packaging and selection is identified in
each entry's source note. It includes no private Hearthline history or weights.

## Windows runtime components

- **Node.js v24.19.0**: MIT and bundled third-party terms in its complete
  upstream LICENSE, retrieved from that exact release tag. This contains
  substantially more than Node's short MIT notice.
- **.NET runtime and Windows Desktop runtime 8.0.29**: MIT and applicable
  third-party notices copied from the exact NuGet runtime packs used to build.
- **Microsoft WebView2 SDK 1.0.3296.44**: its own LICENSE and NOTICE, copied
  from the selected SDK package. The installed Edge WebView2 browser runtime
  is a separate prerequisite; the full Setup includes Microsoft's unmodified Evergreen installer and its separate runtime terms. The portable app-only ZIP does not.
- **Codex 0.158.0-alpha.2**: the official Windows x64 release executable,
  verified against its published asset digest. Its source tag resolves to
  `10382da79a2a2d6e8ae221fa63077215389c1ad2`; its upstream Apache licence and
  NOTICE are retained. `codex-runtime/origin.json` identifies the asset.
  No voice runtime, code-mode host, shell runner or sandbox installer sidecars
  are included. The modified model capability catalogue has its own retained
  source attribution and change record. This is an upstream-release identity
  check, not a claim that Branchline reproduced the compiler's output.

The complete notice documents and SHA-256 values are indexed in
`public/licenses/index.json`. Build preparation checks the notices against the
installed package versions and the fixed runtime references. Full dependency
package files remain beside the binaries in the local preview.

Source development also declares the MCP SDK and Zod, with their existing MIT
licences supplied by those packages when installed. They are not copied into
the current executable preview. An installer, runtime change or additional
dependency must update the actual payload's inventory before publication.

The application licence is adopted. Candidate verification and public
publication are separate steps; see `PREVIEW-LIMITS.md` and the release's
test report. These notices are not a claim of universal legal clearance.

## Full local-model installer (0.8.1)

- Stock **Qwen3.5-4B**, Q4_K_M and BF16 picture projector: Apache-2.0. Upstream and conversion revision, source URLs, sizes and SHA-256 are in `provenance/bundled-model-inputs.json`. No Dream adapter or private corpus is included.
- **llama.cpp b11146**, CPU and Vulkan: MIT. Included **LLVM OpenMP** retains its licence and exceptions. Original notices are available in the offline licence viewer.
- **Inno Setup 7.1.0**: its retained upstream licence; the installer contains its runtime, while build tools stay outside the app.
- **Microsoft C++ V14 14.51.36247** and **WebView2 Evergreen**: unmodified prerequisite installers under their respective Microsoft terms, included for offline setup. Setup displays these terms alongside the separate Branchline licence. They remain shared Windows prerequisites after uninstalling Branchline.

The WebView2 runtime may check for updates and collect diagnostic information. See its retained terms and https://aka.ms/privacy. This differs from local Qwen inference, which uses an authenticated loopback process and needs no network model service. The retained Evergreen terms are a text extraction of Microsoft's developer download terms; replacement glyphs in their supplied HTML are retained. The original source URL is recorded at the top.
