# Contributing to MASA

MASA changes begin with a concrete cross-implementation problem. Use an RFC when a change alters a core term, schema, relation, profile invariant, public-safety rule, or conformance result.

Every normative change must update, in one coherent set:

1. the specification and vocabulary;
2. the JSON Schemas;
3. valid and invalid examples;
4. conformance fixtures and expected diagnostics;
5. generated TypeScript artifacts;
6. migration notes and the changelog.

Application-specific terms remain in their namespace until at least two independent implementations demonstrate a shared need. Preserve source-term, adapted-term, project-term, and working-term status and never back-attribute MASA's working definition to an external author.

Run:

```bash
pnpm install
pnpm check
```

Do not add network access to validation or use a schema library as a second normative source. JSON Schema remains authoritative.

