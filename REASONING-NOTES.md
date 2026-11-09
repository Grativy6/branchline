# Reasoning notes

Settings → Conversation has an optional **Reasoning notes** toggle and **10s / 30s / 60s** choices. The default is off, with 30 seconds selected. The choice belongs to the current conversation and all its chairs.

A due ping waits behind the chair's current work. Repeated ticks keep one pending ping; they never interrupt an inference, restart a task, create another model call or start Pony Post. For a supported tool workflow, a pending request is offered in the result of a completed work step. A chair can record a short consideration or decline. Work does not depend on receiving a note.

ChatGPT models with advertised summary support supply **Provider summary** records. Their timing and level of detail belong to the provider; a summary may be only a short heading, and a reply may contain none. The interval groups already-received material. Compatible local models with Tools enabled can use **Agent note**, an explicit short account of an interpretation, choice, uncertainty or correction. This does not change the model's thinking setting. OpenAI API summary events are supported on the existing configured route; this feature needs no new account or key.

Live notes appear in a small expandable area under the working chair. Completed notes are in the reply's **Details** and the chair's **Drawers → Work log** inspector. The source, chair, model, task, actual received time and source IDs remain recorded. Notes stay in the originating chair's log by default; they do not automatically fill shared desk context. Explicit log inspection preserves their original attribution. A note is an expressed account; file and tool receipts remain the evidence for actions.

Turning off stops new note capture and requests without stopping the task. Existing saved notes remain inspectable. Turning on affects the next supported reply. Cadence changes affect the next checkpoint or passive update; an inference is never restarted to apply them. Stop and completion clear unserved pings, retaining already-received material with its completion status. Interrupted work is not resumed just to produce a missing note.

Saved versions are append-only. Final provider text and corrections link to earlier versions. Each task retains at most 64 note versions and 64 KiB of note text, with at most 4,000 characters per passage and 32 provider parts. A visible omission record marks limits; ordinary work continues. Agent notes use the existing tool and token allowance. Notes are not a separate Activity job or a second memory store.

## Verification

Synthetic-clock and provider tests cover all three intervals, held work, one pending ping, three interleaved Codex chairs, independent Stop, off/on, delta/final reconciliation, corrections, limits, private context, historical contracts and journal replay. Browser checks cover fixed controls, persistence, live display and Details while off. Live checks on Dust captured an exposed Astra summary and a Qwen-authored checkpoint note after a queued ping, then completed both answers and backed up their saved records. The paid API route was tested with synthetic events, not a paid live call.
