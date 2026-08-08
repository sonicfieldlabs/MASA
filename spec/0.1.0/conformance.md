# MASA conformance 0.1.0

Conformance is capability-specific evidence, not a brand label.

## Classes

| Class | Required behavior |
| --- | --- |
| `reader` | Parses and validates the declared version, reports unsupported extensions, and preserves unknown extensions. |
| `writer` | Produces valid identities, profile declarations, policy references, and receipts. |
| `transformer` | Preserves parents, creates distinct descendants, records operations and parameters, and reports reversibility. |
| `agent-host` | Declares capability and authority, validates tool boundaries, records actions and non-actions, and honors refusal. |
| `publisher` | Produces a new public projection, applies policy and disclosure checks, and supplies correction and revocation routes. |

## Evidence states

`conformant | partial | not_run | failed | unknown`

MASA 0.1.0 has no preceding stable release. Migration status is `not_applicable`.

## Diagnostics

Diagnostics contain stable code, severity, JSON instance path, schema path when relevant, message, and remediation. They MUST NOT echo secret values.

Core codes include:

- `MASA_SCHEMA_INVALID`
- `MASA_UNSUPPORTED_VERSION`
- `MASA_PROFILE_MISMATCH`
- `MASA_DUPLICATE_ID`
- `MASA_UNRESOLVED_REF`
- `MASA_REF_TYPE`
- `MASA_DERIVATION_CYCLE`
- `MASA_DESCENDANT_RECEIPT`
- `MASA_DESCENDANT_REUSES_INPUT`
- `MASA_TEMPORAL_ORDER`
- `MASA_WINDOW_ORDER`
- `MASA_STATE_REASON_MISSING`
- `MASA_EVENT_SEQUENCE`
- `MASA_INTEGRITY_MISMATCH`
- `MASA_EXTENSION_DROPPED`
- `MASA_POLICY_DENIED`
- `MASA_PATH_ESCAPE`
- `MASA_ARCHIVE_LIMIT`
- `MASA_PUBLIC_DISCLOSURE`
- `MASA_PUBLIC_PATH`
- `MASA_PUBLIC_SECRET`
- `MASA_PUBLIC_PRECISE_LOCATION`
- `MASA_PUBLIC_PRIVATE_ENDPOINT`
- `MASA_PUBLIC_EXTENSION`
- `MASA_JSON_DUPLICATE_KEY`
- `MASA_JSON_DEPTH`

Strict-JSON, bundle, and lineage tooling emit further `MASA_`-prefixed codes in their own families (`MASA_JSON_*`, `MASA_BUNDLE_*`, `MASA_LINEAGE_*`). A code, once released, keeps its meaning for the life of the minor line.

## Required evidence artifact

Every suite result declares suite and implementation versions, subject, platform, exact MASA version, profile, class, run time, individual tests, and fixture-manifest digest. Repeated runs over the same inputs SHOULD produce identical ordered diagnostics; volatile evidence fields such as `runAt` remain outside diagnostic comparison.

## Reference release gate

The local reference implementation is ready for application integration only when schemas meta-validate offline, generated types compile, packages build, required fixtures pass, three protocol round trips pass, bundle and public-safety limits pass, MCP stdio tests pass, documentation agrees with implemented behavior, and packaged artifacts contain no secrets, personal paths, private media, provider settings, or untested capability claims.
