# Updating to Branchline 1.0

Keep a complete backup and the previous app before updating. The app retains its
existing data location, including a custom --data-dir selection. The established
Windows folder and internal executable names stay stable across the display-version
change.

Version 1.0 uses workspace format 4 and backup format 8. Large exact model inputs
are stored as immutable referenced objects. Earlier input records are preserved
with their original receipt hashes, and older journal bytes remain available.
Use the pre-update data copy if returning to an older application.

Backups include history and exact inputs, pictures, personal continuity, postal
parcels, Dream notes, owned Dream candidates/adapters/checkpoints, the selected
training configuration and recovery evidence. Separately added/bundled model files,
external folders and private sign-in credentials remain separate.

Restore a copy creates a new data root containing a workspace subfolder. In the
Windows app, copy the restored-copy launch command, close Branchline, and paste
that command into Windows Run (Win+R). The original shortcut continues opening
the original data root. JSON export is an inspection format; Settings restores
complete backups rather than importing workspace JSON.

An unfinished Dream retains its frozen data and checkpoint. A checkpoint from an
older incompatible masking recipe stays available, but cannot silently restart
as a Resume. Stop that unfinished run and start a new corrected Dream when ready.
Already completed generations keep their recorded provenance and remain available.
The training engine configuration belongs to the selected workspace; model weights
can stay in their existing model directory.

The app automatically registers models reported by the signed-in ChatGPT connection. It preserves existing model IDs, names, chairs, archives, Coats and source-sharing choices. Adding a model does not grant it access to Home sources or start a reply. The model choice belongs at the chair.

Sign-in is checked through Branchline's existing account connection. If it reports signed out, use the ordinary Sign in with ChatGPT control. No account or private history is included in the package.

v0.10 includes All, full-roster Alternate selection records and captured per-chair picture inputs. Preserve a complete pre-update workspace for rollback, including when returning to an earlier 0.9.1 preview. Equivalent Home recipients move to their existing folder-access grant; historical Home records and additional Home-only readers remain.
