# Local MCP server

The reference MCP server uses stdio and is intentionally read-oriented. It provides protocol resources and four tools:

- `matter.validate` validates a record or bundle without dereferencing remote references;
- `matter.inspect` returns a bounded structural summary;
- `matter.trace_lineage` returns a bounded transitive causal-lineage subgraph in the ancestor, descendant, or both directions;
- `matter.audit_public_export` audits a proposed public record.

The server accepts roots through `MASA_ALLOWED_ROOTS`, separated by the platform path delimiter. If the variable is absent, only the process working directory is allowed; a variable that is set but empty is a configuration error and the server refuses to start. Relative and absolute inputs are resolved and real-path checked inside those roots, so symlinked inputs cannot name a file outside them. A same-machine process that races path components between that check and the read is outside this tool's threat model and is recorded in `threat-model.md`.

The server does not expose raw media, fetch remote URIs, invoke providers, generate audio, publish, overwrite, or delete. It writes JSON-RPC only to stdout and sends operational messages to stderr. Tool failures forward only MASA-coded messages; operating-system error text, which can embed absolute resolved paths, is redacted to the errno code. Prompts, titles, transcripts, extensions, and record policies cannot enlarge host authority.

Any future write tool requires a separate capability version, an explicit output root, per-operation authorization, a receipt, bounded resource use, and a review of cancellation and atomic-commit behavior.
