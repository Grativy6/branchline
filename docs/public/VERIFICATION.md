# 0.8.12-preview.3 verification and release status

October 7, 2026. **Source submitted for review; installer downloads and website
publication are pending.** This is an unsigned Windows x64 preview.

## Source and candidate

The application and installer source come from an explicitly selected snapshot
of implementation commit `0256acb9d2a336690afaf0bbee999c74e82d83ce`. The public
repository starts from its own existing history. Private development history,
conversations, credentials, Dream weights, adapters and raw machine logs are not
included. The optional public Hearthline orientation has its separate attribution
and licence; it is not a private model or conversation export.

`source-manifest.json` records the exact published files, their origin in the
reviewed snapshot, and the publication-only documentation and Git-attribute
changes. No application, test, dependency, native-window or installer code was
changed during source publication. Earlier prepared installer and ZIP files
retain their original bytes and manifests; their README and release notes
predate these publication updates. This file carries the current release status.

## Completed checks on the Windows 10 development computer

- All 430 Node regression checks passed, with no failures or skips.
- Native x86 and x64 runtime probes detected the actual installed Microsoft
  libraries. Version boundaries and installer return-code handling also passed
  compiled tests; the child-installer results in those cases were simulated.
- A separate qualification installer installed and hash-checked 1,040 files,
  opened the real native app with synthetic data, repaired an intentionally
  damaged app file, and uninstalled. A user-created file and every synthetic
  workspace byte survived. The qualification installer used a different app
  identity and existing prerequisites, preserving the everyday installation.
- App-only installation checked 992 files, omitted the model, skipped its C++
  prerequisite check, and uninstalled successfully. Actual component-page size
  labels were 3.86 GB for the full selection and 603.2 MB for app-only.
- Four actual stock Qwen3.5-4B requests through the packaged Vulkan route checked
  a streamed reply, correct red-circle/blue-square image description, Stop, and
  a follow-up remembering a fictional garden after restarting the runner and
  workspace. Prior synthetic messages and the unsent draft were retained.
- Native immediate-close testing recovered the exact unsent draft and observed
  graceful backend shutdown.
- A packaged synthetic-provider journey from preview 2 checked retained state,
  streaming, Stop, image handling, backup/separate recovery and missing-model
  handling. Fixture replies are distinct from the actual Qwen checks above.
- The reviewed source and each entry of the source, app-only and native-source
  ZIPs matched their recorded manifests. The earlier native download-helper
  tests covered 11 loopback cases, including cancellation, retry and corruption.
  Those earlier helper tests are historical coverage; the preview 3 helper's
  new installer hashes were checked, but its public GitHub route is still pending.

## Checks repeated from the separate public checkout

The locked JavaScript dependencies installed from the existing local cache with
package scripts disabled. All 430 regression checks passed again. The native
Windows project restored and built with zero warnings and zero errors, and all
40 offline licence notices passed their check. These builds and tests used
synthetic data; they did not open the everyday app or call a provider account.

The publication file check compares the complete file set with the reviewed
snapshot and the explicitly listed documentation additions. It also checks
private-data patterns, root-guide links and the prepared website's versioned
links, copyable prompt and checksums. A synthetic private-key-header rejection
test is the one existing byte-pinned scan exception; it contains no key body.

## Separate Windows 11 laptop

The maintainer reports that the repaired candidate installed, opened, looked
right and retained the existing chats. This is a user-reported result, not an
independently reviewed new log or a full functional pass. A local reply, image,
Stop and close/reopen with a draft still need to be tried on that machine.

The preceding candidate failed its prerequisite check after the Microsoft
installer reported success. The exact original failing condition was not
reproduced on the development computer. The repaired Setup uses native x64
checks and records each library and installer result separately; successful
laptop installation does not by itself prove which old condition caused it.

## Limits and the remaining release work

This was not a clean-Windows or absent-prerequisite installation test. ARM64,
other operating systems and broader hardware coverage remain unqualified.
No new provider-account, private-model or Dream-training checks were run for
this candidate. A generic full-state comparison with 0.8.0 failed on expected
new Coat fields; a complete 0.8.0 migration/downgrade pass is not claimed.
Preserve a verified workspace backup and the matching old app before updating.

The installer release, signed-out public download/helper checks and website
deployment remain pending. Hashes establish file identity; they do not replace
publisher signing, complete security review or qualification on every computer.
The first-party licence and component notices describe their respective scope.

Report ordinary problems through [BUG-REPORT.md](BUG-REPORT.md). Private
vulnerability reporting is enabled for this repository; see [SECURITY.md](SECURITY.md).
