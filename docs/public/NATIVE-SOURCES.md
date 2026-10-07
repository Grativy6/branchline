# Sources for the image libraries

Branchline uses Sharp and libvips to prepare selected pictures. The library
code retains its own licences, including LGPL terms. Full notices are available
offline in **Settings → About & licences**, and in `licenses/` beside the app.

The **Branchline-v0.8.0-Native-Sources.zip** companion must be available beside
the Windows download. `native-sources.json` identifies the exact archives,
original URLs, versions, sizes and SHA-256 hashes. It includes:

- Sources for the 28 libraries named by this Windows libvips build.
- The librsvg Cargo.lock dependency sources, including a conservative superset
  of development and alternate-platform packages.
- The pinned libvips Windows build recipes and patches, their MXE base, and
  the Sharp addon source package.

The archives are upstream originals. Checksums match the pinned build recipes
or Cargo.lock. The packaged `libvips-42.dll` matches the official x64 web static
release of libvips 8.18.7. Branchline has not rebuilt libvips or claimed a
reproducible native build.

To rebuild the native library, unpack `vips-build.zip` and `mxe-build.zip` and
follow their README/build instructions. Use the pinned MXE revision from the
manifest rather than a moving branch. The corresponding source archives are
included for the build's download cache, and the crate archives correspond to
librsvg's Cargo.lock. The build recipes retain all upstream patches and
compilation options. Compiler/SDK tooling must be obtained separately.

The DLLs are dynamically loaded and remain replaceable. You may replace
`node_modules/@img/sharp-win32-x64/lib/libvips-42.dll` with a compatible rebuilt
library, keeping its filename and ABI, or rebuild the Sharp binding as needed.
No signature or application hash check prevents that replacement. Keep an
original copy to recover from an incompatible build.

Branchline's Apache licence does not restrict modification or debugging of
these libraries. Their respective licences govern their source and binaries.
