# Pony Post — a home between desks

Open Pony Post from the Toy Shelf or Activity. Select a desk, turn its switch on,
choose its receiving conversation and chair, then save the address. Do this for
both desks you want to connect. New desks start off.

Use **New parcel**, or a message’s gear → **Send with Pony Post**. A notice arrives
without starting a reply. A request joins the receiving chair’s queue and returns
its saved response. The receiving chair keeps its own Coat, context and tools.
The postal service itself makes no model calls.

Mail travels through the workspace’s postal home:

`Sending desk → Pony Post → Receiving desk → Pony Post → Original return address`

When either desk switches off, waiting mail stays at Pony Post. Off does not stop
work already underway. A finished return can wait there too. Stop or Cancel acts
on the chosen request; Stop all includes pending postal work. Saved history stays.
Requests that already began are not automatically repeated after restart. An
explicit new attempt is recorded separately. Receiving a return creates no
automatic acknowledgement.

Changing the visible conversation or renaming a desk does not redirect mail.
Changed receiving addresses hold waiting mail until explicitly corrected. Work
already begun keeps its original address; send another parcel to redirect it.

Each parcel shows delivery and work records separately. Delivered means the mail
was placed in a conversation. Included means a recorded model turn used it. A
reply retains its task outcome, including partial, failed or stopped work.

Pictures and selected text can be attached from a saved message. Pictures retain
their existing object references and do not replace the receiver’s composer
selection. A missing picture capability holds the work with a specific reason;
the text and original pictures remain available in Pony Post.

Models with Tools enabled can list desks, send a parcel and read their own desk’s
sent or delivered mail. A goal can explicitly wait for a parcel’s return. Other
desks’ mail is not included in their context. Carried material keeps its source
sharing restrictions through relays, later model changes and Dream-note edits.

The first version operates within one Branchline workspace while the app is open.
It has no separate courier model or background Windows service. Earlier Pony
helper-task records remain under **Earlier Pony task records** with their original
meaning; they are not converted into deliveries to another desk.

## Storage and implementation

- `ponyMail` stores versioned compact settings, parcel references and append-only
  delivery records in the existing workspace journal.
- `pony-mail/objects/<sha256>.json` stores each immutable parcel payload once.
  Returns reference the already saved response instead of copying it again.
- The ordinary chair task queue owns model work. Postal admission is explicit;
  it does not weaken the same-desk checks on chair messages or inherit a goal.
- Backup format 7 includes the required postal objects. JSON export format 4
  carries those objects too. Restore a full workspace backup to resume an app.
- Existing source readers, permissions and chair records remain in use. Old
  active Pony task controls are retired; historical validators remain.

Read [VERIFICATION](VERIFICATION.md) for checks and [README](README.md) for the app.
