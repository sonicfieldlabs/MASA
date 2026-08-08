# MASA repository contract

This repository contains the normative MASA Sound Matter Aware protocol and its local reference tooling.

## Authority order

1. Versioned files under `spec/` define normative behavior.
2. Versioned JSON Schema files under `schemas/` define normative structure.
3. Versioned registries under `ontology/` define controlled vocabulary and relation metadata.
4. Conformance fixtures and tests define executable expectations.
5. TypeScript declarations and libraries are generated or implemented conveniences. They never override the language-neutral artifacts.

## Invariants

- Preserve source, representation, claim, operation, policy, and lineage as distinct objects.
- Keep claim kind, actor, confidence, source health, freshness, and disclosure separate.
- Keep unknown, withheld, unavailable, deleted, and not-applicable states distinct.
- Never mutate or replace an imported representation under the same identifier after consequential transformation.
- Every descendant has a parent relation and an operation receipt.
- Every consequential operation has a policy evaluation, including refusal and non-action.
- Unknown namespaced extensions survive ordinary local round trips. They are excluded from public projections unless explicitly approved.
- Validation is offline. Validators and the MCP server do not dereference remote resources.
- Public export is allowlist-based and creates a new projection. It never sanitizes a private record in place.
- The reference implementation performs no digital signal processing. Processing operations are contracted to external engines and accounted through receipts.
- Do not describe a profile, class, adapter, or integration as conformant without a recorded passing suite.

## Development

Use Node.js 22.20 or newer and pnpm 10.32.1. Run `pnpm check` before calling the local reference implementation complete. Tests must use isolated temporary directories and may not write into sibling repositories.

Do not add an application-specific term to the `masa:` namespace until at least two implementations justify the promotion and a versioned decision records it. Concrete applications keep their own extension namespaces in their own repositories.

## Git commit conventions
- Never add "Co-Authored-By" lines or any AI attribution trailers to commit messages.