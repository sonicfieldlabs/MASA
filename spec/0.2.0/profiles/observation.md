# Observation profile 0.2.0

The Observation profile provides a common boundary for source-derived fields that may later inform analysis, mapping, synthesis, performance, or publication. It does not assert that an observed field is sound or that a mapped result is the source's voice.

A conforming Observation-profile record declares `core` and `observation`, contains at least one Source and one Observation, and supplies these independent fields on every Observation:

- `epistemicStatus`: `measured`, `reported`, `derived`, `inferred`, `interpreted`, `speculative`, or `undetermined`;
- `temporalCharacter`: `event`, `stream`, `forecast`, `aggregate`, `context`, or `local`;
- `signalKind`: `observation`, `derived`, or `generator`.

These fields do not replace the qualified `value`, Source `health`, `freshness`, confidence on related claims, method, or disclosure. Missing or unavailable values remain qualified absences. Staleness remains freshness. A forecast remains a forecast even after it becomes stale. A generator remains authored local state and MUST NOT be presented as external observation.

Normalization is a derivation. When a normalized value is retained, a record SHOULD preserve the source Observation, the derived Observation, the normalization method and bounds, and an attributable operation receipt. A Mapping that consumes that value remains a separate authored relation with explicit missing-data behavior.

This profile promotes metadata used independently by Cosmoaudition System and GERM. Their implementation namespaces remain valid and non-equivalent; promotion does not erase earlier extension provenance.
