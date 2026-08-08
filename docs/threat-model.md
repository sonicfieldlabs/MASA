# MASA local threat model

## Protected assets

MASA protects source media, voices, location, community and territorial information, prompts, lineage, policies, private identifiers, credentials, provider configuration, and the integrity of records and descendants.

## Trust boundaries

- imported JSON, NDJSON, ZIP files, media, metadata, and filenames are untrusted;
- a record may contain prompt injection and cannot grant tool authority;
- remote URLs are data and are never dereferenced by validation;
- an extension can contain protected content even when its namespace is valid;
- a schema-valid policy may still lack legitimate authority;
- the local MCP client and server share a transport but not automatic filesystem authority.

## Principal threats

- path traversal, symlink escape, archive bombs, duplicate normalized paths, and unmanifested payloads;
- secret or personal-path leakage through records, errors, logs, archives, embedded metadata, or public projections;
- lineage forgery, reused output identity, modified parent bytes, and digest mismatch;
- collapsed epistemic fields that convert stale data, actor origin, or inference into false confidence;
- prompt-derived authority, confused-deputy tool calls, and cross-request authority reuse;
- public correlation through private identifiers or original-content hashes;
- treating technical access or a machine-readable policy as consent.

## Reference mitigations

The reference packages validate offline, use strict schemas plus semantic checks, bound bundle extraction and JSON nesting depth, verify manifests and SHA-256 digests, refuse overwrite, constrain MCP reads to configured roots, quarantine extensions during publication, redact diagnostics and tool-error messages, and require explicit policy evaluation for consequential operations.

## Accepted residual risks

- The MCP root check canonicalizes a path and then opens it; a local process that swaps a path component for a symlink between those two steps can direct the read outside the configured roots. The server is a local, read-only, same-user tool, so this time-of-check race is accepted rather than mitigated with descriptor-relative walks.
- Bundle packing re-verifies file identity before adding each entry, but the archive library reopens files afterward; a concurrent local writer is caught by the packed artifact's own manifest verification rather than prevented.

Audio codec isolation, metadata stripping, hosted authentication, remote egress, model execution, signing, and deletion from third-party caches remain host or future-profile responsibilities. No absent mitigation is claimed as implemented.

