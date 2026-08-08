# Project-agnostic MASA integration

MASA 0.1.0 defines a protocol boundary, not an application object model. An implementation may use any language, storage system, audio engine, interface, or deployment model when its emitted artifacts satisfy the exact versioned schemas and semantic invariants.

## What an implementation adopts

An implementation adopts only the profiles it can evidence. Every record adopts Core; audio, listening, analysis, transformation, generation, mapping, agent, and publication remain independent capability declarations. A conventional non-agentic script can therefore be a conforming Reader or Writer without implementing an agent host, audio engine, or public service.

Core identifiers, qualified states, claims, receipts, policies, and lineage relations carry interoperable meaning. Namespaced register and scale values let another field or community add classifications without changing the Core vocabulary. Unknown extension payloads survive local Reader and Writer round trips, while public projection excludes them unless the exact namespace and shape have been reviewed.

## What an implementation owns

The adopting project owns:

- its extension namespace and extension schemas;
- application state, database layout, interface concepts, and DSP implementation;
- codec, model, provider, and hardware isolation;
- runtime authorization and user confirmation;
- legitimate consent, jurisdiction, license, and community governance;
- a compatibility manifest and exact conformance evidence.

An adapter document may explain one repository's mapping to MASA, but an adapter never changes the protocol and is not proof that the application conforms.

## Minimal integration sequence

1. Select the exact MASA version and the smallest implemented profile set.
2. Preserve imported bytes and identities before consequential processing.
3. Create qualified values for unknown, withheld, unavailable, deleted, and not-applicable states; never encode these as known null.
4. Validate structure and semantics offline before accepting a record.
5. Create a new identifier, parent relation, and operation receipt for each consequential descendant.
6. Keep runtime authority outside records and prompts.
7. Build publication as a new allowlisted projection, then audit the emitted artifact.
8. Run the applicable conformance class and publish only the resulting bounded compatibility claim.

## Portable package boundary

The TypeScript packages are local reference implementations. Their packed artifacts contain compiled code and embedded protocol resources only. The CLI and MCP server do not assume that `spec/`, `schemas/`, or `capabilities/` exists in a parent repository after installation. Canonical language-neutral files under this repository's versioned directories remain authoritative over packaged conveniences.
