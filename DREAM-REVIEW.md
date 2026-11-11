# Your personal model, with a Dream history

Open **My Models → Review Dreams**, or select a personal model in Home's Dreams
card and choose **Review Dreams**. Both open the same resizable journal. Multiple
personal models remain separate, including models using the same base weights.

The journal keeps an account, an outcome, selected conversation sources and your
own editable note. Sources reopen through their recorded cutoff without replacing
your unsent message. Archived sources remain readable. Long messages are bounded
in this reader; their full text remains in the original conversation and export.

Use **Record a Dream** to enter an earlier account yourself. A saved local model
connection is optional. This is labeled as a user-declared account, not an
observed training run. Recording an account does not change the active model.
App-run Dreams appear separately as observed training records. Their candidate,
source notes, prepared examples and resource measurements are available to review.

## Earlier models already in your list

From the personal model you want to continue using, choose **Organize earlier
entries**. Select the entries and explain their relationship, then review the
affected branches. The current connection stays selected. Earlier entries become
history under this model only after confirmation. Original identities, replies,
source attribution and effective branch Coats remain recorded.

Entries with different Agent profiles or their own Dream journals are held for
review instead of combined automatically. Keep them separate until their choices
are resolved. Technical details lets you keep an earlier entry separate again;
this appends a correction and preserves the original association record. Later
chair changes are not undone.

## Notes, origins and exports

**Save note** records a new note revision. Closing the window or app keeps an
unfinished note locally without presenting it as saved history. Resume or discard
that note before editing another one. A concurrent save is reported as a conflict;
your draft remains available for copying and review.

**Starting point** distinguishes unknown adapter information from a declaration
that no adapter was used. You can add a base revision, adapter identifier, supplied
digest, source description and an earlier start date. Supplied digests are not
independently checked by recording them. Corrections append new records.

**Export history** saves a readable JSON view of this model's journal and source
handles. The complete workspace export also preserves all origin/note revisions,
original identities and chair assignments for inspection. Settings provides complete-backup restoration; it does not import this workspace JSON.
The per-model view is for inspection, not a separate automatic import format.
No account, purchase, stamp or issuer receipt is needed for these features.

## Recovery and its present limit

Open **Technical details & recovery → Check recovery** on a record with a saved
connection. That older recovery control supports the app-managed stock Qwen route.
New local Dream generations use **Try the new generation**, **Use this generation**
and **Use the previous generation** in their Dream work record. Branchline checks
the saved artifact before changing its binding. For stock recovery it checks the included bytes and prepares the route before
appending a selection event. Cancellation before that write, a failed check or a
changed selection leaves the current binding unchanged. Stop all also cancels a
pending recovery. A committed selection remains recorded if cancellation arrives
after the save.

Selecting stock Qwen does not reconstruct a trained adapter. For externally
managed models, including private Dream states served by another app, Branchline
cannot yet load and verify an exact saved checkpoint. It reports that limitation
instead of changing a label and calling it recovery. The journal remains useful.

Past conversations, newer Dreams, notes, Coats and grants survive recovery. An
actual next reply uses the selected binding while earlier replies retain their
exact authorship. Existing sharing and context-capacity checks still apply.

Keep a backup before upgrading a workspace. For rollback, use the older app with
its pre-upgrade workspace copy; preserve newer history separately. Do not feed a
newer journal to an older release without a verified compatibility route.

## Make and collect Dream notes

Choose **Use in Dreams** on a response or from the desk controls. You can mark a
highlighted passage, selected messages, a conversation, or the desk. Choose
**Conversation flow** or **Workflow**. A mark keeps the selected passage and its
original context at that time; it does not collect future messages automatically.

Home also has **Make noted conversation** and **Make noted workflow**. Give the
note a name and paste text, or use **Browse…** to load a text or Markdown file
into the editable box. Conversation notes have a warm tint; workflows have a cool
tint. Both may contain mistakes, correction, repair and unresolved questions.
No pass/fail labels or model approval are needed to save a note.

Select the personal model that should learn, then include or exclude notes in
its list. Each model tracks its own use. Read reopens the retained source; editing
saves a new revision. A user-chosen picture belongs to this personal model and is
not included in training.

## Start, suspend and stop

In **Settings → Dreams**, choose the model that prepares the notes. The default is
the selected local personal model. A cloud preparation choice sends the selected
material to that connection using existing sharing choices. It never silently
falls back to another provider.

The first supported local training profile is the included **Qwen3.5-4B** and its
compatible Dream generations. **Set up local training** installs a separate
Python environment and downloads the corresponding trainable checkpoint once.
This profile needs Ubuntu 24.04 / WSL 2 and an NVIDIA GPU. A serving GGUF alone is
not a training checkpoint. Other model families need their own supported recipes.

**Start Dreaming** freezes the selected notes and settings for this run. Its
button becomes **Cancel/suspend Dream**, disabled for about two seconds to avoid
a double click. The popup offers:

- **Stop Dream:** end this run, keep the prior model, and leave the notes available.
- **Suspend Dream:** save progress, release the worker GPU, and show **Resume Dream**.
- **Cancel:** close the popup and continue the same run.

Opening the popup requests a temporary hold at a safe boundary. Activity shows
preparation, training, export and actual waiting reasons. The local GPU slot is
shared with local replies; independent cloud work can continue. Closing the app
during a Dream offers to save progress before closing. After interruption, Resume
uses saved progress explicitly; it does not restart work in the background.

**Schedule Dreams** can use once, daily, selected weekdays or interval times while
Branchline is open. It uses pending material for the selected personal model.
With no new notes it stays quiet. Stopping a run does not restart that occurrence.

## Training and the resulting generation

The fixed recipe uses BF16 LoRA, rank 8, one epoch, batch size 1 with four-step
accumulation, a 0.00002 learning rate and 1,024-token training windows. Earlier
mistakes can stay as context for later repair rather than separate imitation
targets. Long episodes use overlapping windows; their originals and prepared
examples remain inspectable. A later Dream continues a compatible saved adapter
with a small selection of earlier examples; excluding a note excludes it from
that rehearsal too.

The worker saves checkpoints and exports a Q4_K_M model. Branchline loads the
export before advertising it as ready. It retains the previous generation until
you choose to adopt the candidate. **Try this generation** sends the same short
message to the current and new models. An observed change or completed training
pass is not, by itself, evidence of improved quality.

Durable notes, pictures, checkpoints and candidates live under the workspace's
`dreams` folder. A **complete workspace backup** includes the trained artifacts;
suspend active Dreams before making that backup. JSON export includes source
notes and model pictures, but not large model weights. Retain the complete backup
when moving or recovering a trained generation. The downloaded base and Python
runtime are machine resources set up separately.
