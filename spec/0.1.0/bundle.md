# MASA bundle 0.1.0

MASA supports a single-record `.masa.json`, an inspectable directory ending in `.masa`, and a compressed `.masa.zip` exchange artifact.

## Directory form

```text
<record-id>.masa/
├── manifest.json
├── events.ndjson
├── records/
├── assets/
│   ├── originals/
│   ├── derivatives/
│   └── previews/
├── policies/
└── reports/
```

Only `manifest.json` and at least one record are required. The manifest lists every file except itself. It records path, role, media type, byte length, SHA-256 digest, disclosure, and associated record where applicable. “Original” means original to the bundle lineage, not unmediated reality.

## Path and coverage rules

- Paths are UTF-8, NFC-normalized, relative POSIX paths.
- Empty segments, `.`, `..`, backslashes, absolute paths, drive prefixes, control characters, and path collisions are forbidden.
- Symlinks, sockets, devices, encrypted entries, nested archive execution, and unmanifested payloads are forbidden.
- The actual file set MUST equal the manifest file set plus `manifest.json`.
- Every included file MUST match its declared byte length and SHA-256 digest.
- External or withheld artifacts remain explicit manifest references and are never fabricated as empty files.

## Event log

`events.ndjson` contains one complete OperationReceipt JSON object per line. Blank lines, malformed lines, duplicate or non-monotonic local sequence, and a partial final line are invalid. Timestamps may disagree with sequence under clock drift; sequence remains the local causal order.

## Packing

A conforming packer:

1. validates the source directory and rejects non-regular files;
2. verifies every declared size and digest;
3. sorts paths lexically;
4. writes normalized file modes and a fixed timestamp;
5. writes to a temporary sibling and atomically promotes it without replacement only after completion;
6. refuses overwrite unless an explicit higher-level policy permits it.

Deterministic ZIP bytes aid comparison but are not a signature or authenticity proof.

## Unpacking

A conforming unpacker preflights the central directory, path safety, encryption, entry type, collisions, count, sizes, and compression ratios before extraction. It reads and validates a bounded manifest, requires exact entry coverage, extracts into a new temporary directory with exclusive file creation, streams size and digest verification, validates records and events, and atomically moves the complete directory into place.

Default limits are defined in `SECURITY.md`. A host MAY lower them. Raising them is a host authority decision.

## Signatures

The `signatures/` role is reserved. MASA 0.1.0 defines no signature or JSON canonicalization profile and makes no signature conformance claim.
