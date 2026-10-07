# Agent PC access

Version 0.8.10 Preview 1 offers guarded text-file tools for a foreground chair.
Programs, screen viewing and mouse/keyboard control are unavailable. This is a
partial workshop preview, not a complete computer-use agent.

## Start with a practice folder

1. Open **Settings → Agents → Agent PC access**.
2. Enable Read and add an existing local folder. Choose the exact model
   connections that may receive its contents. A ChatGPT visitor sends those
   contents to OpenAI through your separately connected subscription.
3. Add sensitive files or folders to **Do not access**. Exclusions override
   allowed folders and remain in force for read-only use.
4. To permit edits, enable Write and the folder's own text-change checkbox.
5. Save, enable the desired file pockets in the chair's Coat, and turn on the
   conversation's Tools switch. Start a new reply with a specific request.

All PC permissions and file pockets start off. Turning Read off clears the
chosen recipients; turning it back on requires selecting them again. Saving
new permissions stops affected work. A changed model connection needs a fresh
review. Moving or restoring a workspace at another location does not reuse
its old PC grant.

The apron describes the tools and folder handles available to this reply.
It supplements the selected Coat without changing it. A model's request,
source document, Sketch, receipt or user answer inside chat cannot grant access.
Peer agents and handoff recorders do not inherit PC file tools.

## Supported files

The chair can list one folder, read a UTF-8 text file, search it for literal
text, create a new file, or replace one exact passage. Existing files are never
overwritten by creation. Editing requires the identity and SHA-256 from a
previous read and rejects a changed base. There is no delete, move, recursive
search, terminal, package installation or program launch tool.

Files are limited to 1 MiB. Reading delivers at most 4,000 characters per page;
replacement/new text is limited to 8 KiB. Listings examine at most 4,096 entries
and return 48 per page. Paths must be ordinary local Windows paths. Network
shares, device paths, alternate streams, junctions, symbolic links, multiply
linked files and cloud placeholders are refused. Busy files may need their
editor closed before a reply can use them. Only one file action runs at a time.

Branchline protects its current workspace, account connection, runtime and
common credential directories automatically. This is not a scanner that knows
where every secret on a PC is stored. Choose small project folders and explicit
exclusions. Windows file handles keep checked paths and targets from being
replaced during an operation. A replaced allowed root or exclusion needs review.

## Carrying file material

File-source restrictions follow later replies, model changes and handoff
recorders. A receiving model needs current permission for the carried sources.
Revoking permission holds those later calls; it cannot recall bytes already
sent to a provider or remove them from recorded conversation history.

This preview is conservative about Sketches: once a Sketch revision exists
after file exposure, file-source restrictions can affect other desks in the
workspace. Known files written by the tools also retain their recorded source
requirements when read by another chair. This does not detect arbitrary manual
copies or determine the meaning or ownership of text.

## Stop, recovery and rollback

Stop prevents pending operations and cancels before commit. Once a short file
commit begins, it may finish so its actual outcome can be recorded. Edits save
original bytes and a preparation record under the workspace's `pc-recovery`
folder before writing. The settings section displays that location.

Edits write through an exclusive handle and verify the resulting bytes; they
are **not atomic**. A crash, timeout or disk failure during a commit can leave
a partial edit. A preparation record alone does not prove the edit completed.
Inspect the operation receipt, current file hash and recovery original before
retrying or restoring. Preserve any later human changes. Recovery is manual;
Branchline does not silently roll back files.

Keep this candidate's workspace separate from an older app version. To roll
back a trial, stop and close the candidate, retain its workspace and recovery
folder, and return to the unchanged earlier launcher. Do not open the new
journal in an older release.

## Verification limits

Real Windows handle tests and synthetic provider/UI tests cover the guarded
file route. A real Astra subscription test read, edited and verified a practice
file, then received an exclusion refusal. Stock Qwen used a folder label where
the tool required its id and did not complete the edit within six requests.
The schema now supplies the exact allowed ids; this improvement has fixture
coverage but has not been retested on Qwen within that exhausted allowance.

Synthetic image bytes crossed the pinned Codex dynamic-tool connection in a
fixture. No agent screen capture, native app interaction or visual reasoning
was verified. Windows program confinement remains unresolved under this
candidate's no-host-setup constraints; unavailable controls do not fall back
to an unrestricted shell. Installer compilation does not prove installation,
upgrade or uninstall on another PC.
