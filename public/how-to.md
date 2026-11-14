# Using the new desk features

Open this guide from the desk’s **… → How-to guide**, or **Settings → About & licences → How-to guide**.

## Choose a Hat

1. Open **Settings → Memories & Hats → New Hat**. Give it a name and a short introduction.
2. Edit a visiting chair, or open the Desk Model’s editor. Choose the Hat **below Coat**.
3. Choose **Yes** or **No** for that chair’s Hat-note writing, then save the chair.

The Hat adds its fixed opening and your short text even with Tools off. Turn Tools on for the chair to read deeper routes or write allowed notes. **Allow chairs to update this Hat’s intro**, in the Hat editor, is a separate choice. You can always edit the introduction yourself.

A Hat can be worn once within a branch. Use **Duplicate** for a separate continuation, or select the same Hat in a different branch to share its continuity. **Notes & history** shows contributors, revisions and saved conflicts. Coats continue to decide the colors.

## Use desk MEMORY

In **Memories & Hats**, enable **Use desk MEMORY** and choose its author. Leaving the author unspecified selects the current conversation’s Desk Model and records that choice. Other branches of this desk can use the shared account.

Use **Edit desk MEMORY** for your own text, **Review proposals** for attributed suggestions/objections, or **Ask author to update** to queue one explicit request. **Update desk MEMORY after a handoff** is optional. It queues one author update when a handoff is used, behind current work; preparing an unused handoff does not trigger it. Automatic maintenance is labelled as a Branchline request and does not replace the chair’s project return point. Enabling memory alone makes no model call. The author may also update it during ordinary work. Turning MEMORY off preserves saved revisions and cancels queued automatic updates.

Existing personal memories remain under **Manage memories**. Choose the material you want to copy; this preview does not automatically move those files into Hats or desk MEMORY. Hats support selected text-file imports and Hat JSON import/export. **Export SOUL.md** and **Export MEMORY.md** are copies; they are not watched files that silently write back into the app.

## Inspect return paths and unresolved threads

Open the desk’s **… → Return map & sources**, or use **Inspect return map** in Memories & Hats. Choose a chair, search its saved records and open a source. Original revisions and any recorded corrections remain inspectable.

**… → Unresolved threads** lets you record a question, what would count as resolved, where to look and its current status. Chairs can maintain these records with Tools enabled. Handoff preparation reviews supported changes from the supplied sources; using the handoff applies those reviews. Unreviewed items remain as recorded. A newer conflicting human edit is preserved instead of overwritten.

## Continue from a handoff

1. Click the **cloud / context counter** above the message box.
2. Choose **Continue from this handoff** at the top. The estimate shows how much input will remain.
3. Send your next message, resume your goal, or send a queued request when ready.

The button uses the prepared handoff, or the selected handoff if there is no new preparation. It starts a fresh working input without deleting the conversation or making a model call. Replies already running keep their captured input.

Your Coat, current goal, selected desk material and own-drawer context remain. Old transcript and tool-output bodies stop being sent automatically. A short map points to work recorded after the handoff; that work is still available to retrieve. The counter therefore drops but does not become zero.

The full conversation stays visible. In the cloud window, **Reopen another original message** opens its exact saved text and tool evidence. With Tools and the **Reopen chat sources** pocket enabled, models can retrieve the same sources. **Use full history again**, under earlier handoffs, reverses the working-input reset.

## Give a Coat a color

1. Open **Settings → Coats & Pockets**.
2. Expand the individual Coat under **Your coats**.
3. Click **Select Color**, choose a color, then **Save choices**.

Starter Coats have fixed colors and stay locked. Use **Duplicate** to make your own version.

The tint identifies the whole message card, including task requests sent by that chair. Earlier cards associated with that Coat change color too. **Use default color** restores the normal appearance. Your own messages keep their separate appearance.

## Keep thinking notes in a drawer

Open your custom Coat’s **Thinking Coat · Off** control (the same choices window as Select Color), enable **Thinking Coat**, and save.

This adds a brainstorming request to the existing Coat. Turn **Tools** on to let the model save a requested note. Exposed native thinking or provider summaries can also be saved, with their source labelled. A model that returns no note leaves no invented substitute.

Open **Drawers → the chair** to inspect its notes. Use **Include in this chair’s thinking context** to select or deselect them. The newest selected notes fit first within the **Saved-note context** allowance, initially 4,000 characters. Set it to 0 to keep notes stored without automatically including them. Full notes remain available for retrieval.

## Inspect shared work when you want it

Shared work cards stay out of the chat by default. Open **Drawers → Shared work** to read them, or choose a chair to inspect its own notes and work log. Models still receive and retrieve shared work normally.

To put these cards back in the chat, turn on **Activity → Show shared work in chat**. The choice is saved.

## Read long code and tool output

Long output starts folded. **Expand** opens a scrollable panel; **Collapse** folds it away. **Copy** copies the complete output. Folding changes its display, not the model’s input size—use the handoff control to make room in that input.

## Stop a running reply

Ordinary chair replies have no Branchline elapsed-time cutoff. Use **Stop** on the chair or in **Activity** when you want to end its work.

## Recover an unsent task

If a request failed before a model exchange started, its original prompt offers **Copy unsent request to draft**. That addresses only the chairs whose requests never started. Review the draft and send it when ready. To let an old failed request go, choose **Discard unsent request** instead. It disappears from the chat and clears a matching composer draft; other text you are writing stays. The old attempt remains in its work log.

Existing goals use their **Resume** control. A saved queued message uses **Send queued**. **Stop** belongs to work that is actually running or being prepared.

## Local engine

In Settings → Models, open Included Qwen → Status and recovery, or select an added local model. The engine line shows llama.cpp 1.0.0 / b12359 and its actual CPU/Vulkan state. Unloaded means the engine is installed and will load on the next local reply. Stop and Unload work as before.
