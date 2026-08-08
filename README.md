# MASA

**MASA** is a project-agnostic Sound Matter Aware protocol. It provides a local-first, language-neutral contract for systems that need to describe, listen to, measure, transform, granulate, dissect, generate, map, relate, govern, and exchange sound as matter without confusing an audio file, a physical event, a perceptual account, or a computational claim. Conformance never depends on any other repository.

Version `0.1.0` is the first public release, MIT-licensed and open to any project. Its normative sources are the specification, JSON Schemas, ontology registries, and conformance fixtures in this repository. The TypeScript packages, CLI, and MCP server are reference implementations of those artifacts.

## What is included

- a compact Core plus Audio, Listening, Analysis, Transformation, Generation, Processing, Mapping, Agent, and Publication profiles;
- JSON Schema 2020-12 contracts with stable versioned identifiers;
- an engine-neutral processing-request contract for granular, spectral, and time-pitch operations, with the granular lexicon carried as attributed vocabulary;
- provenance-aware terminology and relation registries;
- a JSON-LD context and documented PROV-O and ODRL mapping boundaries;
- `.masa.json`, directory-bundle, and `.masa.zip` exchange forms;
- offline structural, semantic, lineage, policy, integrity, and public-disclosure validation;
- deterministic local bundle packing and bounded extraction;
- browser-safe TypeScript model and validation packages;
- Node-only bundle tooling and the `masa` command-line interface;
- a read-oriented local MCP stdio server;
- conformance fixtures for Reader, Writer, Transformer, Agent Host, and Publisher behavior;
- local skills and non-normative adapter guidance for concrete integrations.

MASA is not an audio engine, model, hosted registry, universal ontology of sound, or claim that machines hear like humans or other species. It can be implemented by conventional software without agents.

## Quick start

Requirements: Node.js 22.20 or newer and pnpm 10.32.1.

```bash
pnpm install
pnpm check
pnpm masa -- validate examples/0.1.0/valid/minimal-record.masa.json
pnpm masa -- inspect examples/0.1.0/bundles/transformation.masa
pnpm masa -- lineage examples/0.1.0/valid/processing.masa.json urn:uuid:00000000-0000-4000-8000-000000000d02
pnpm masa -- process template granulate
pnpm masa -- conformance reader examples/0.1.0/valid/minimal-record.masa.json
```

Start the local MCP server over stdio:

```bash
pnpm build
pnpm mcp
```

The MCP server is offline and read-oriented by default. It exposes specification resources and local validation, inspection, lineage tracing, public-export audit, and processing-request planning tools inside configured roots. It does not fetch remote resources, perform signal processing, generate audio, publish, delete, or expose raw assets.

See [`docs/project-agnostic-integration.md`](docs/project-agnostic-integration.md) for the portable adoption boundary and minimal implementation sequence, and [`docs/processing.md`](docs/processing.md) for how granular, spectral, and time-pitch work is planned, delegated to external engines, and accounted.

## Local conformance evidence

The reference implementation records separate evidence for the `reader`, `writer`, `transformer`, `agent-host`, and `publisher` classes in [`conformance/0.1.0/evidence`](conformance/0.1.0/evidence). The current local run reports all five classes conformant on Node.js 22.22.3 for macOS arm64 against fixture-manifest digest `0240f5403d9d626c3eef75a55eb640cea84cf5b6d17d2824fe4874561c27be95`, computed over the examples, capability catalog, schemas, ontology registries, and JSON-LD context.

Run `pnpm check` to regenerate derived code and verify conformance on the current machine. Run `pnpm conformance:evidence` only when intentionally recording a new local evidence snapshot. Conformance is always specific to an implementation version, MASA version, profile, class, platform, and exact fixture set; it is not a universal certification.

## Repository map

```text
spec/                 normative protocol and profile documents
schemas/              canonical JSON Schema 2020-12 contracts
ontology/             canonical terminology and relation registries
contexts/             optional JSON-LD context
examples/             valid, invalid, and bundle examples
conformance/          executable fixtures, runner, and evidence
packages/core/        browser-safe types, IDs, vocabulary, projections
packages/validator/   browser-safe offline validation
packages/bundle/      Node-only directory and ZIP bundle tooling
cli/                  local `masa` command
mcp/                  local stdio MCP reference server
skills/               bounded operational procedures
adapters/             application adapter contracts
rfcs/                 protocol change process
```

## Normative boundaries

The protocol distinguishes:

- physical event, signal, representation, and MatterRecord;
- source origin and causal attribution;
- heard, measured, inferred, interpreted, speculative, and undetermined claims;
- confidence, source health, freshness, actor, and disclosure;
- observation, derived relation, mapping, synthesis, performance, and speculation;
- copy, encoding derivative, continuation, inpainting, variation, mutation, and graft;
- lineage, authorship, ownership, consent, and ethical legitimacy.

Unknown or protected facts are represented explicitly rather than by empty strings. Technical access does not grant permission. A mapping does not become the source's literal voice.

## Status and integration

This repository is self-contained and offline-first. No hosted service, public registry, package publication, or concrete application integration is claimed here. Application integrations begin only after this repository's local conformance evidence passes, live in their own repositories, and are versioned independently. The adapter documents under [`adapters/`](adapters) are illustrative archetypes, not integration claims.

The reference architecture lives in [`docs/reference-architecture.md`](docs/reference-architecture.md), and the portable adoption boundary lives in [`docs/project-agnostic-integration.md`](docs/project-agnostic-integration.md).

## License

MASA code, schemas, specification, and examples are licensed under the MIT License unless a file states otherwise.
