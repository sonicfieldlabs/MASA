# RFC 0002: Observation profile

Status: accepted for MASA 0.2.0

## Decision

Add an optional Observation profile and promote `epistemicStatus`, `temporalCharacter`, and `signalKind` into the `masa:` vocabulary. The base Observation structure keeps the fields optional for compatible non-profile records; declaring the Observation profile makes all three required.

## Evidence and scope

Cosmoaudition System and GERM independently need these axes to preserve reported, measured, derived, interpreted, speculative, stale, unavailable, event, stream, forecast, aggregate, and authored-generator states across observation-to-control handoffs. This satisfies the two-implementation threshold for shared vocabulary without importing either application's module names, source catalog, or routing model into MASA.

## Consequences

- Missing values continue to use qualified states; the new fields never encode absence.
- Health, freshness, confidence, disclosure, and actor remain separate.
- Normalization and mapping remain attributable derivations rather than properties of a source.
- Existing implementation namespaces remain valid historical provenance.
- MASA 0.1.0 records are preserved as immutable versioned records. Adoption of 0.2.0 creates a revision or migration receipt; it never edits the only 0.1.0 copy in place.
