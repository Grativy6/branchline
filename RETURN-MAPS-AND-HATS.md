# Return maps, Hats and desk MEMORY

Included in Branchline 1.2. Read [the short how-to guide](public/how-to.md) for the controls.

## The pieces

- **Model:** the chosen local model or connection.
- **Coat:** role, instructions, pockets and card color.
- **Hat:** persona and portable continuity, with an exact short introduction and attributed notes.
- **Desk MEMORY:** an optional account shared by the desk's conversation branches.
- **Drawer:** the particular chair's working records.
- **Handoff and unresolved threads:** the conversation's return point, remaining questions, criteria and evidence.

The same Hat can be selected in different branches or desks, with one wearer of that Hat per branch. Duplicate creates an independent continuation while retaining the copied authors. A Hat is not substituted as the speaker: the chair remains the recorded actor.

## Hats and editing

A selected Hat supplies this fixed opening and its short text:

> You are an AI participant in the system. A hat has been provided to grant a continuity trace. The details of the continuity are forthcoming.

The short text is available with Tools off. Deeper notes have source routes. The chair's Hat-note Yes/No choice governs its own notes. The separate **Allow chairs to update this Hat's intro** setting governs intro edits; humans can edit in either mode. Hat text cannot change those settings or the fixed opening.

New notes append independently. Competing edits use base revisions; conflicts retain the current version and submitted proposal, with the writers attached. A different Hat's chair does not silently gain a write target in another Hat.

## Optional desk MEMORY

The selected author maintains the desk's account. When no specific author is chosen, enabling MEMORY records the current conversation's Desk Model chair as the author. Navigating to another branch does not change it. Other chairs may submit proposals or objections, and their source records remain available even when an account does not incorporate them.

Updates can happen during the author's ordinary work, an explicit **Ask author to update** request, or through the optional **Update desk MEMORY after a handoff** checkbox. The checkbox queues one update after a handoff is used, behind current work. A merely prepared handoff causes no update, and the writer’s own maintenance handoff cannot trigger an endless chain. Enabling MEMORY alone makes no model call. There is no idle model polling or unanimous approval/rewrite loop. Automatic maintenance keeps the chair’s ordinary project return point and is labelled as an app request.

## Return maps and handoffs

The map has seven stable slots: handoff, own work, current task/project, desk MEMORY, Hat, changes and deeper history. Current exact routes and original-source indexes supply the depth. Input receipts retain the exact map and source revisions supplied to a particular chair; one wearer receiving an update does not advance another's marker. Failed replies do not silently count as completed returns.

Original messages, artifacts, notes and receipts remain available through the index. Cross-branch source routes and model-authored Hat text retain captured source scopes, using the same source-sharing machinery as Pony Post. Memory writes affect their scoped destination only; following a route does not create a write path back to its source or permission controls. Model-authored links are bound to source routes available to that operation; imported Hat files retain contributor labels and provenance but cannot manufacture a live source binding merely by claiming one.

Preparing a handoff freezes its structural reference point. It can review unresolved threads against the original conversation sources and watched current artifact revisions. Supported reviews are applied when that handoff is used. A later human edit produces a retained conflict instead of being overwritten. An unsupported optional thread proposal remains recorded for inspection without blocking an otherwise valid handoff account.

Corrections remain attributed. Current routes show recorded direct or dependent disputes; the original source and older input receipts stay intact. This is traceable state and scope, not semantic poison detection or a claim that every influence has been identified.

## Saved files and existing memories

Records use workspace format 8 in the existing saved workspace. Keep a pre-preview backup for rollback to an older app. Exact model inputs continue to use the existing content-addressed input store.

Existing personal-memory profiles and their MEMORY.md synchronization are unchanged. Users choose what to copy. This candidate provides text import, Hat JSON import/export and SOUL.md / desk MEMORY.md exports. Exported files are copies, not additional watched authorities; live external-file synchronization for these new views remains a design placeholder until its folder/edit behavior is chosen.

## Qualification scope

Backend checks cover attribution, independent copies, branch uniqueness, writer choices, conflict retention, original-source reading, correction routes, per-chair supply markers, handoff review/activation and old tool-contract compatibility. Browser checks use a synthetic local provider and inspect the actual controls and persistence. These checks do not claim model-quality improvements or new training results.

The scale fixture compares 6,000 and 60,000 short saved messages over a synthetic 365-day span with fixed current drawer/artifact/thread records. It measures map size, source lookup, save and reopen time. Larger tool payloads and different workloads can behave differently; this is not a universal year-long performance certification.
