# MASA vocabulary 0.1.0

The canonical machine-readable registries are [`ontology/0.1.0/terms.json`](../../ontology/0.1.0/terms.json) and [`relations.json`](../../ontology/0.1.0/relations.json). This document explains their governance.

## Term status

| Status | Meaning |
| --- | --- |
| `source-term` | Attested and attributed to external scholarship in the preserved research corpus. |
| `adapted-term` | A source term explicitly changed by the project. |
| `project-term` | Established in a preserved implementation or research-project source. |
| `working-term` | Proposed by the curator, theory, or protocol and still revisable. |

Every registered term declares namespace, definition, status, attribution, introduction version, source or decision references, and non-equivalences. A wire-format mapping never makes two theoretical concepts equivalent.

## Namespace policy

- `masa:` contains the shared protocol vocabulary.
- Each implementation, community, or research project chooses and governs its own namespace; `example:` is reserved for non-production examples.
- Adapter documents in this repository are illustrative archetypes with placeholder namespaces; a concrete application names and governs its own namespace in its own repository, and no application namespace is ever required for MASA conformance.
- A term can move into `masa:` only after a versioned RFC, source-status review, and evidence from at least two implementations.
- Promotion never erases the prior namespace or conceptual lineage.

## Relation policy

Relations declare a category, whether they participate in the acyclic derivation graph, and—when applicable—which endpoint is the descendant. Domain metaphors remain implementation extensions. Tradition-specific terms such as ch'ixi, pacha, cosmotechnics, Deep Listening, sound object, and auditum retain attribution and are not generic software labels.
