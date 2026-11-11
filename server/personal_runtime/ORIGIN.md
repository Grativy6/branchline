# Personal continuity runtime

Adapted from Christopher Daniel Pang's Hearthline MCP toolkit, under the
included CC BY 4.0 licence. Original modules were copied on 2026-10-22.
The existing continuity database and bounded source format are retained.

Branchline changes: explicit automatic-policy and external-file attribution;
neither is labelled human review. Automatic policy can only accept a proposal;
an external file can only replace the account text. The host enforces the
selected policy and recipients before invoking these fixed operations.

The four module hashes in the prepared runtime manifest identify the code
actually loaded. The launcher imports this pinned directory explicitly.

1.0 repair: reads verify and return one SQLite snapshot, keeping the records and
revision head consistent during concurrent updates. The packaged manifest now
points to these maintained files; the duplicate runtime copy is retired.
