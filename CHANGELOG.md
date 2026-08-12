# Changelog

All material protocol and reference-tooling changes are recorded here. MASA uses semantic versioning; a tooling patch may advance without changing the normative protocol version when its record contracts remain compatible.

## 0.2.0 - 2026-08-11

Minor protocol and reference-tooling release.

- Added the optional Observation profile, promoting `epistemicStatus`, `temporalCharacter`, and `signalKind` after independent use in Cosmoaudition System and GERM.
- Kept value availability, source health, freshness, confidence, method, disclosure, and observation metadata as separate axes; a declared Observation profile requires all three new axes on every Observation.
- Added RFC 0002, versioned 0.2.0 specification/schema/ontology/context/example/conformance resources, and an invalid fixture proving incomplete Observation metadata is refused.
- Preserved every 0.1.0 normative resource and evidence snapshot unchanged. Migration creates a new attributable revision; it does not rewrite an earlier record in place.
- Corrected conformance migration reporting for the second protocol line: 0.2.0 evidence says `not_tested` rather than claiming migration is not applicable.
- Updated the TypeScript reference packages, CLI, MCP resources, capability catalog, and package artifacts to 0.2.0.

## 0.1.1 - 2026-08-09

Patch release of the TypeScript reference implementation. The normative MASA protocol, schemas, capability-set format, profile directories, and record/request version fields remain `0.1.0`.

- Enforced every declared profile during public audits and recursively removed approved-extension secrets, credential-bearing URL parameters, absolute private paths, and nested precise coordinates.
- Expanded conservative offline non-public address detection across private, documentation, benchmarking, selected reserved IPv4/IPv6 space, and common transition forms; DNS resolution remains an explicitly documented connection-time policy boundary.
- Refused processing plans against invalid target records and removed duplicate MCP validation work.
- Made ZIP packing and promotion portable across Windows path and directory semantics, bounded temporary names independently of caller filenames, and added a Windows release-gate lane.
- Separated normative protocol identity from generated reference-implementation identity across the CLI, MCP server, capabilities, resources, and conformance evidence.
- Added deterministic capability metadata, synchronized release-version generation, pinned read-only CI, dependency maintenance, and a gate that validates the exact checked-in evidence set against the current specification, fixtures, runner, and release identity.

## 0.1.0 - 2026-08-07

First public release of the MASA Sound Matter Aware protocol and its local TypeScript reference implementation.

- Normative Core plus Audio, Listening, Analysis, Transformation, Generation, Processing, Mapping, Agent, and Publication profiles.
- 29 JSON Schema 2020-12 contracts under the canonical root `https://masa.sonicfield.org/`, provenance-aware term and relation registries, and an optional JSON-LD context.
- Processing layer (RFC 0001): granular, spectral, and time-pitch operations — `matter.granulate`, `matter.extract`, `matter.reduce`, `matter.fragment`, `matter.timestretch`, `matter.pitchshift` — the engine-neutral `masa-processing-request` contract, the `masa:granulated-from` lineage relation, and grain, grain-cloud, stratum, and stratosound vocabulary registered as attributed source terms after Curtis Roads and Paul Osetinsky. The reference implementation performs no signal processing; engines are external and named per receipt.
- `.masa.json`, directory-bundle, and `.masa.zip` exchange forms with bounded, deterministic packing and verified extraction.
- Offline structural, semantic, lineage, policy, integrity, and public-disclosure validation with deterministic, value-free diagnostics; public projection with private-identity decorrelation.
- Local `masa` CLI (validate, inspect, verify, pack, unpack, lineage, process template/check, project-public, audit-public, schema, capabilities) and a read-oriented stdio MCP server (`matter.validate`, `matter.inspect`, `matter.trace_lineage`, `matter.audit_public_export`, `matter.plan_processing`) confined to configured roots.
- Bounded operational skills (matter inspection, claim registration, sound matter processing, public-safe export) and adapter archetypes (studio application, generative engine, DSP engine, sonification system, public web).
- Executable conformance fixtures and recorded local evidence for the Reader, Writer, Transformer, Agent Host, and Publisher classes.

No compatibility with an earlier MASA release is claimed. Migration status is `not_applicable`.

### Pre-release working-line history

The 0.1.0 line was developed locally; these entries record its pre-release state and repairs.

#### Project-agnostic identity and defect repair - 2026-08-06

- Migrated every canonical identifier from the originating project's host to the protocol's own root `https://masa.sonicfield.org/` (schema `$id` values, the `$schema` and `@context` constants, vocabulary namespace, capability catalog, and example URLs). The identifier root now lives in one generator module (`scripts/canonical.ts`) and is enforced by both generation and schema checking. No release precedes this change, so no conforming record is invalidated.
- Removed the remaining application-specific language: adapter documents became neutral archetypes with placeholder namespaces; ontology term references now cite the published works and MASA's own sections instead of unreleased project documents; `masa:Actor` and `masa:Context` joined the term registry; the JSON-LD context now maps every Core entity type and collection.
- Repaired the private→public identity flow: `createPublicProjection` rewrites every reference to the private record identifier into the declared `publicRecordId`, embeds extension-omission notices inside the published Publication object, and is covered by tests and an audit round trip.
- Repaired reference-tool defects: installed `masa` and `masa-mcp` bins were silent no-ops when launched through package-manager symlinks; ontology lookups trusted prototype-chain member names such as `constructor`; diagnostic ordering and the conformance fixture digest depended on the host locale; a leap-second timestamp produced a false temporal-order error; folded-name ancestor collisions and unmanifested empty ZIP directory entries were accepted at inspection time; unpack promotion could replace a concurrently created empty directory; MCP tool failures echoed operating-system messages containing absolute resolved paths.
- Tightened validation and evidence: strict JSON bounds nesting depth (512) and rejects numeric overflow to infinity; derivation-cycle checking is iterative and survives adversarial relation chains; a completed `expire` operation requires an authorizing policy result; publication prohibitions apply when they name contained entities; invalid examples must fail with their expected diagnostic codes; the fixture digest also covers schemas, registries, and the context document.

#### Defect repair - 2026-07-29

- Repaired the absence-state contradiction: `known`, Measurement and Claim results, Claim and Context content, thresholds, and seeded values are non-null; `deleted` carries a reason plus deletion-receipt references.
- Added namespaced register and scale values, typed-reference diagnostics, ordered temporal checks, direction-aware lineage traversal, and exact publication-permission coherence.
- Embedded protocol resources in the reference packages so packed CLI and MCP artifacts do not depend on a repository-relative checkout.
- Replaced application-specific conformance-example vocabulary with the neutral `example:` namespace and expanded valid, invalid, CLI, MCP, and packaging coverage.

Rejecting null where a field makes a positive assertion was one deliberate validation tightening within the unreleased working draft. The repaired assertion-null family comprises `{ "state": "known", "value": null }`, `Measurement.value`, `Claim.content`, `Claim.value`, `Context.content`, `Threshold.value`, and `OperationReceipt.determinism.seed`. It repairs a direct contradiction with the already normative requirement to distinguish unknown, withheld, unavailable, deleted, and not-applicable states. A repository-wide check confirmed that no valid fixture or coordinated local adapter used any of these null assertion forms, and direct regression tests cover every repaired field. A released patch version must not invalidate conforming records; any equivalent change after release requires the versioning and migration process in `spec/0.1.0/versioning.md`.

#### Initial working draft - 2026-07-27

- Established the first normative local MASA Core.
- Added Audio, Listening, Analysis, Transformation, Generation, Mapping, Agent, and Publication profiles.
- Added JSON Schema 2020-12 contracts, terminology and relation registries, and an optional JSON-LD context.
- Added directory and ZIP bundle contracts, offline validation, deterministic diagnostics, semantic lineage checks, and public-safe projection rules.
- Added TypeScript model, validator, bundle, CLI, and local MCP reference packages.
- Added executable conformance fixtures and local release evidence generation.
