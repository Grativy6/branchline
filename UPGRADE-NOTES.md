# Before updating to 0.9.1-preview.3

Close Branchline and keep a verified backup of its app and actual workspace. Existing installations can have different workspace paths; check the shortcut's --data-dir option and Settings -> Workspace.

Chair work, including an ordinary model reply, writes workspace format 3. An older app needs the preserved older workspace copy. Keep newer conversations separately when choosing a rollback.

This patch automatically registers models reported by the signed-in ChatGPT connection. It preserves existing model IDs, names, chairs, archives, Coats and source-sharing choices. Adding a model does not grant it access to Home sources or start a reply. The model choice belongs at the chair.

Sign-in is checked through Branchline's existing account connection. If it reports signed out, use the ordinary Sign in with ChatGPT control. No account or private history is included in the package.
