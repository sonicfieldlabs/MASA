# MASA versioning 0.1.0

MASA versions normative schemas and behavior with semantic versions.

- Patch releases repair unambiguous defects without invalidating conforming records.
- Minor releases add backward-compatible optional structure or new profiles. Before 1.0, a documented breaking change MAY occur in a minor release only when no safe alternative exists.
- Major releases may redefine required behavior and require explicit migration.

Every record pins an exact `masaVersion`. Every application publishes a supported version range and exact profile/class evidence. `/latest` MAY exist as a documentation redirect but MUST NOT appear as a stored schema or protocol version.

Deprecated terms and fields remain documented through at least one compatible migration window. IDs are never reused. A migration creates an attributable operation and does not silently rewrite the only copy of an earlier record.

