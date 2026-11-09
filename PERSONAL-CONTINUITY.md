# Shared personal continuity

This local candidate lets the Personal and Visiting chairs use one reviewed
account without changing either model's weights or recorded identity. A profile
has its own sources and revision history. Its name is a display label, not an
ownership or access rule.

## Use a profile

Open **Coat → Personal continuity**, or **My Coats → Personal continuity**.
Create a profile with a short orientation, a current account and selected text
sources. Files and selected conversation messages become exact snapshots;
Branchline does not scan their folders. Mark stories as fiction when adding them.
Unfinished profile drafts stay in this window until it closes. Saved profiles
and proposals survive app restart.

In a conversation, select the chairs and model destinations allowed to receive
the profile. **Review and use here** binds it to their currently selected Coats.
Editing the same Coat keeps its profile connected. Each new reply reads the
latest kept profile revision. Taking off the Coat or choosing a different one
pauses that association. Attach it again deliberately in
a new conversation. Earlier replies retain their exact context and attribution.

Reviewing, searching, importing and attaching make no model call. The normal
**Send** action sends the selected material to the chosen model. A destination
review applies to future kept revisions of this profile too. Detaching stops
new injection; it does not erase what earlier replies have already carried.
Those replies remain subject to the profile's destination restrictions.

The account is fallible history, not a new grant of permission. Its text and
source passages are separate from the orientation's conversational guidance.
The host supplies the actual chair, model connection and recorded generation.
An exact weight identity is unknown unless separately recorded and checked.

## Sources and corrections

Select source passages to supply directly, which also works with a model that
cannot use tools. An initial passage is at most 4,000 Unicode code points;
its offset and next-page marker make partial reading visible. Open a source
in the profile to read further.

For a tool-capable model, explicitly enable the desired continuity pockets in
its Coat and turn **Tools** on:

- Find personal sources.
- Read personal sources.
- Propose a personal note.

A model can propose a replacement account. It cannot keep its own proposal.
Review the proposed text, edit it if useful, then keep or reject it. The original
writer and any review edits remain recorded. A stale proposal cannot overwrite
a newer kept correction. Editing orientation and sources also creates a new
reviewed revision; this first editor keeps the profile name fixed.

When an old passage is removed from the current profile, a conversation that
still selects it waits for a new selection. Nothing silently substitutes a
different source. Changing context between a paired reply's turns holds the
queued reply for a fresh request.

## Carry it elsewhere

**Export selected history** creates readable JSON containing the current account,
original proposal/review attribution and source snapshots. Repeated source text
is stored once in the bundle. **Import profile** previews the contents and saves
a separate profile; it does not select chairs or admit a model destination.
Imported attribution remains an origin claim, not verified authorship.

Current limits are 8,000 characters across orientation and account, 12 active
sources, and 64 KiB of UTF-8 source text in a portable package, including its
historical sources. Portable history has a 128-event ceiling and shares the
store's 100,000-character serialized-record limit. Very long histories can
exceed that limit sooner. Export then holds rather than trimming history.
Use the workspace backup to retain the complete store. A bounded history
selection editor is future work.

Bundles contain no live disclosure grants or executable configuration. Obvious
private keys and absolute drive paths cause export to stop for review; this is
not a complete secret detector. Read the material before sharing it. Encryption
and recipient-key hats remain separate work.

## Storage and recovery

Canonical records live in `personal-context-store/.hearthline-store.sqlite3`
inside this candidate's selected workspace. The ordinary journal records local
associations, disclosure choices and immutable per-reply snapshots. It is not a
second writable memory master. Workspace backups include a consistent SQLite
copy and its hash; restoration creates a separate recovered workspace.

New continuity journals need this candidate. Keep a pre-update backup for an
older app. Never edit journal records to force a downgrade. If a write reports
an uncertain outcome, reopen the profile and inspect its proposal/history
before retrying; writes also retain operation IDs to recover exact retries.

## Prepare the candidate runtime

Install the owning Hearthline toolkit and its pinned dependencies into a local
Python environment, including MCP 1.28.0. Then run this operator-only preparation
from the Branchline checkout:

```powershell
node scripts/Prepare-Personal-Context.mjs '<absolute Python executable>' '<absolute Hearthline toolkit checkout>'
```

This creates `.local/personal-context-runtime.json`. It pins the Python binary
and the four service source files. Reprepare after an intentional source update.
The manifest, environment and private workspace are not release assets.

Only the fixed `hearthline_mcp.personal_server` entry point can be launched.
Scope is checked before initialization and each call. Requests have a 20-second
deadline; each service process exits after 45 seconds independently. Model mode
has reads and proposals; host mode adds review and export. Neither Coat text nor
imported bundles choose a process, command or storage path. The old unrestricted
MCP dispatcher stays disabled. This trusted helper is not an operating-system
sandbox for arbitrary MCP programs.

This is a separate local candidate. It does not replace the everyday installed
Branchline or include Chris's personal Hearthline as a public default.
