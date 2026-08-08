# Security policy

MASA is local-first, but local media, archives, metadata, and records are untrusted input.

## Supported version

Security fixes target the current `0.1.x` line while it is the only release line.

## Reference-tool boundaries

- Validation is offline and never dereferences record URLs.
- ZIP extraction rejects absolute paths, backslashes, traversal, control characters, symlinks, encrypted entries, duplicate normalized paths, unmanifested entries, and configured expansion limits.
- The MCP server uses stdio only, reads only configured roots, writes protocol messages only to stdout, and sends redacted logs to stderr.
- Public projection uses an allowlist and rejects unknown publication authority, protected disclosure states, absolute paths, credentials, precise protected locations, and unapproved extensions.
- Packaged CLI and MCP protocol resources are embedded at build time; installed tools do not escape their package to read an assumed repository checkout.
- Secret scanning is defense in depth. A clean scan does not prove consent, license, jurisdiction, or ethical legitimacy.

## Default limits

- 10,000 archive entries
- 2 GiB total uncompressed bytes
- 512 MiB per entry
- 1 MiB manifest
- 16 MiB JSON record
- 2 MiB NDJSON line
- 100:1 maximum compression ratio
- 1,024 UTF-8 bytes per archive path
- 512 levels of JSON nesting

Callers may lower these limits. Raising them requires an explicit host decision.

## Reporting

Do not include private media, credentials, personal paths, or protected metadata in a report. Record the affected MASA version, diagnostic code, and a minimal synthetic reproducer.
