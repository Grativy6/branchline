# Coats and pockets

A **Coat** holds the instructions and tool preferences you want a model to wear
for a conversation. Each saved model identity can have a usual Coat, with optional branch-specific changes.

Open **My Coats** from Home or **Settings → Coats & pockets** for the same library and editor. Choose **Coat** between the model chairs to change this branch.
Create a new Coat, duplicate a starter, or edit your own saved Coat.
You can share one Coat between both chairs or give each chair its own.

## Play, Create and Work

The small bar above the message box chooses a Branchline **base Coat** for this
branch's future replies, from either chair. Play leans into imagination and
conversation; Create lets the exchange find its shape; Work focuses on carrying
your task through, with room for warmth. New branches start in Create.
Your models' saved Coats and pocket choices remain separate.

You can change the bar while a reply is running. That reply keeps its captured
instructions; the next reply uses your new selection. A queued paired reply
may need a fresh request, and an existing hearth keeps its original orientation.

After a manual change, a small message says **Changing a Coat can lead to
disorientation.** Select **Do not show me again** to remember your preference
on this device. Restore it in **Settings → Coats & pockets → Show Coat-change
warning**. Changing the bar or acknowledging the message makes no model call.

Older Chat and Build choices become Create and Work for future replies. Older
reply details retain their original labels. Details distinguish the recorded
base Coat from the additional saved Coat. Saved Coats from retired desk types retain their exact instructions; those
starters are no longer offered for new selections.

## Fill the pockets

New Coats show these tools checked before saving:

- Read the clock.
- Calculate.
- Ask a question.
- Read attached text.
- Reopen chat sources.
- Read a public page.

Use **Select all** or **Clear all** at either end of the list, or change individual
checkboxes. Saving remembers these choices for the Coat. Empty pockets are allowed, even with no extra instruction text.
The conversation's **Tools** switch must also be on; it does not change when
you switch Coats. A selected tool needs a compatible connection and any relevant
source material. Reading a public page still asks you to approve its exact URL.
Agent and hearth request controls remain separate.

Existing Coats keep their previous behavior. Their editor says they use the
current built-in tools. Changing a pocket saves an explicit list; changing only the instructions
preserves their previous tool behavior.
Duplicating a starter begins a new Coat with today's tools visibly checked.

Image generation, voices and external plugin tools are not connected by this
release. The current pockets use Branchline's built-in implementations. If an
import names an unavailable implementation, it stays inactive. For a known tool,
**Choose the built-in tool** explicitly changes the preference. There is no
silent replacement and no pretend provider chooser.

## Save, change or take off a Coat

**Save to library** saves your edits to the same Coat. Every picker shows one
entry per Coat, with its current name. Chairs wearing it use the updated
instructions and pockets for their next reply, including queued work that has
not started yet. **Save and use here** also selects it for the chosen chairs.

A model can have a usual Coat, and a chair or branch can choose a different one.
These choices follow the Coat itself. **Follow usual Coat** removes the branch
override. Editing a Coat does not change which chairs wear it.

Replies already underway keep their captured instructions and tool choices.
Earlier replies retain their exact instructions in Details. The app keeps those
records for conversation history; old saves do not become extra picker entries.

Delete removes a Coat from the
library, while existing branch selections and reply evidence remain intact.

Wait for a reply to finish, or use **Stop this episode**, before changing its additional saved Coat selection. You can edit the library and the base Coat bar while a reply runs. **Take off
coat** selects Conversation. Press **Save coats** to apply it. The chair keeps
its model, chat, agent profile and ordinary Tools behavior.

**Both** uses each chair's own Coat, as chosen for that paired request. Changing
those choices between replies holds the queued second reply for a new request.
A model-requested extra approach can only use tools allowed by both the originating
reply and the peer's Coat. Continuing hearth peers may use their selected Coat’s bounded conversation pockets when you explicitly enable tools for the task. Legacy hearth records retain their original no-tools profile.

Open a reply's **Details** to see its Coat version, instructions, pocket choices,
and tools offered for that reply. Recorded providers identify implementations.
They do not certify the model's answer or grant permission to act.

## Import and export

Import accepts UTF-8 JSON, Markdown or plain text up to 64 KiB. You review a draft
before saving it. JSON exports with pockets use `branchline.coat/1`; old
`branchline.harness/1` instruction files remain supported. Older instruction-only files keep their
format until they gain pocket metadata. **Export instructions only**
creates Markdown without pockets. These files contain preferences, not connections,
credentials or executable grants. Review the instruction text before sharing it.

## Update and return safely

Back up your workspace before using this preview. Keep the prior installer.
Opening an old workspace preserves its saved versions and old reply snapshots;
new work uses the newer record formats. New Coat policies and continuing-hearth records require this release. An older app may reject a workspace written by it. Restore the pre-update backup into a separate folder for the older app. Never
edit or delete journal records to force a downgrade.

The full installer retains stock Qwen3.5-4B. Private trained models and chats
are not included. The short welcome tour includes Coats and Settings; replay it from Settings → Conversation.

## Color and Thinking Coat

Starter Coats have fixed colors and stay locked. Duplicate a starter to make your own editable Coat. Conversation is gold, Brainstorm purple, Tutor green, Assistant blue, Roleplay pink, Rival orange and Red team red.

Select Color opens a color picker and optional Thinking Coat setting. A color tints that Coat’s authored cards, including earlier replies and model task requests; it does not change their recorded instructions. Default color restores the normal appearance.

Thinking Coat adds a brainstorming request to the existing role when its note tool is available. Generated working notes are saved in the authoring chair’s drawer. Exposed native thinking and provider summaries are labelled separately. No timer starts a model call, and no hidden provider reasoning is reconstructed. Tools must be on to request an authored note. If no note is returned, the log says so.

New notes are selected for later context. In Drawers, uncheck notes you do not want included. The newest selected notes fit first within the saved-note allowance (4,000 characters by default); full notes remain available for retrieval. A zero allowance keeps storage without automatic inclusion. Changes affect later requests; a running request keeps its captured choice.

JSON exports with these choices use branchline.coat/2. Earlier Coat files remain readable. Instructions-only export contains only the written role instructions. Color and thinking options do not create extra selectable instruction versions.
