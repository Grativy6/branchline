# Conversation goals, queued input and resource meters

Create and name your chairs, choose their models and select their Coats using the usual Branchline controls. A goal works with that roster; it does not install a predefined crew.

## Start a shared goal

Open **Goal** beside Drawers, or type `/goal` in the composer. `/goal Your objective` opens a populated draft. Saving makes no model call. Optional completion criteria and limits can be added later.

The goal belongs to this conversation and its chairs. Choose Select or All before using **Start**, or save the goal and send a prompt addressed to your chosen `@chairs`. A new conversation can copy another conversation's goal as an independent draft; it does not inherit its running work or queue.

Chairs can record a concrete next step, report a result or wait for a named dependency. Useful steps continue through the existing queue. Waiting for a chair wakes for a published artifact, an addressed message or a completed/partial finding; waiting/idle notices and clock ticks do not start model calls. A dependency event already delivered is not delivered again merely because a later wait repeats an old cursor.

The Goal view and **Toy Shelf → Blackboard** show assignments, return points, findings and evidence. Earlier hearth boards remain available. A chair's completion report is labelled as a report; it does not certify that its result is correct. Recorded tools and independently checked artifacts remain separate evidence.

Goal coordination can operate with general **Tools** off. This provides only desk-reading and goal-status tools; it does not grant file access or command execution. Actual software work uses the folders and commands already configured for the chosen connections and Coats.

## Queue or steer

Settings → Conversation offers **Queue first** (default), **Steer directly**, and **Queue only**. The choice applies to future Sends. The visible queue lets you edit an unsent message, remove its pending delivery, or choose **Steer now** when available. A queued human message gets a turn before that chair's automatic continuation.

Ready ChatGPT turns support live steering. It retains the original assignment and adds the accepted human input as a recorded amendment. Other chairs continue independently. Preparing turns, unsupported connections, text attachments or changed tool choices use the next-turn queue. Pictures can join a supported ChatGPT turn with their captured recipient and exact saved bytes. No connection is interrupted and restarted just to imitate steering.

The app distinguishes queued input, requested steering and acceptance by the connection. If an acknowledgement is lost, delivery is visibly uncertain and the input is not automatically resent. The source record remains inspectable. Ordinary progress text and optional reasoning notes keep their separate roles.

Full Unicode/emoji chair names work at either end of the label, including role-first names. The picker inserts an unambiguous address; braced forms such as `@{🛠️ Builder}` remain supported. Duplicate models still have separate chair IDs, drawers and assignments.

## Pause and return

Pause prevents automatic next steps while current work finishes. Explicit human conversation remains possible. Stop can target a chair, a goal or all running work. Closing the app pauses goals, records interrupted work and retains unsent human messages. Reopening makes no automatic model call: use **Resume goal** or **Send queued**. Uncertain deliveries are retained for inspection rather than replayed.

Optional limits cover chair turns, unpaused goal time and reported chair tokens. They accumulate across continuation and Resume. Time includes waits while the goal is running. These limits pause automatic work; an already running turn may finish, and an explicitly sent human message remains possible. Reported-token limits are not exact monetary caps and cannot account for missing measurements or unrelated account activity.

## Resource measurements

The small indicator beside Activity opens account allowance windows, reset information and recorded chair token counts. Recorded usage is grouped by chair across the whole conversation; expand a row to inspect its individual exchanges. Chairs keep separate totals even when they use the same model. A + marks incomplete or still-running counts; missing fields stay unavailable. Account-wide usage can include activity outside Branchline. Duplicate/cumulative provider updates are reconciled; missing counts remain unavailable. Token counts, including cached input, are not converted into an invented subscription price.

For local work, the panel shows runtime status, waiting slots and passive CPU/RAM readings. The first GPU adapter uses an installed NVIDIA driver's `nvidia-smi` utility. It was checked on Windows with an RTX 4070 and the included Qwen running through Vulkan. GPU load and VRAM cover the whole device, including other applications. Unsupported GPU measurements are shown as unavailable; other vendors are not claimed qualified. Sampling does not load a model or call one to produce a report.

## Verification and limits

The development checks cover separate goal scopes, human queue priority, duplicate-model chairs, Unicode names, quiet waits, dependency deduplication, queued editing, targeted steering, uncertain delivery, preserved input after restart, usage accounting and missing hardware data. Browser checks include creating chairs and choosing Coats in the app, a seven-chair goal, the shared board, all three input modes, the meters and an independent goal copy.

A real three-chair software fixture preserved five failing baseline tests, fixed the implementation, passed those same five tests against an immutable candidate and returned an evidence review in seven chair turns. A separate real Astra check accepted a mid-turn instruction without creating a second Branchline exchange. The included Qwen completed a goal and its Vulkan residency was measured. These qualify those concrete routes; they do not establish universal model reliability or run the user's own project.

Before substantial project work, configure its actual folder access and saved build/test commands. Use an identified build or commit for a test while another chair edits elsewhere. Drawers separate working records; they do not create isolated filesystem checkouts.
