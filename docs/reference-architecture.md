# MASA reference architecture

MASA separates a language-neutral protocol from its local TypeScript reference implementation. JSON Schema is the sole structural authority; generated TypeScript declarations are conveniences and may not weaken runtime validation.

```text
spec + ontology + schemas
           |
           v
     generated types
           |
     +-----+----------+
     |                |
 browser-safe core  browser-safe validator
                          |
                    Node bundle layer
                     /            \
                  CLI          local MCP
```

## Authority boundaries

- `spec/`, `schemas/`, `ontology/`, and `contexts/` define protocol 0.1.0.
- `packages/core` contains pure types, identity helpers, indexing, deterministic JSON, and projection helpers. It performs no filesystem or network access.
- `packages/validator` registers all schemas locally in Ajv 2020 and adds reference, lineage, profile, policy, and disclosure invariants. It never dereferences a URI.
- `packages/bundle` is the only package that reads or writes bundle paths. It streams ZIP entries, imposes limits, verifies the manifest, and promotes outputs only after complete verification.
- `cli` is a thin local command boundary. It has no implicit network behavior.
- `mcp` exposes read-oriented stdio resources and tools within launch-configured roots. Record content is data, never authority.

## Validation pipeline

1. Parse JSON with size limits at the caller boundary.
2. Validate structure against locally registered, versioned schemas.
3. Index identities and check reference closure.
4. check event order and acyclic material lineage.
5. Enforce each declared profile.
6. Evaluate disclosure and public-projection safety where applicable.
7. For bundles, compare the complete entry set, sizes, and SHA-256 digests with the manifest.

Structural validity means only that the record follows the protocol. It does not prove that a claim is true, an actor had legitimate authority, or an asset may be published.

## Extension boundary

Application-specific data stays under a namespaced key in `extensions`. Ordinary readers preserve unknown namespaces. Public projections exclude them unless the publication declaration approves the namespace and a known adapter audits its exact shape.

This lets unrelated analyzers, instruments, archives, agent hosts, and publication systems share a stable core without flattening their different operations into one application model. Repository-specific adapters remain informative integration documents rather than protocol dependencies.
