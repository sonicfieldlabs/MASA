# RFC 0001: Processing profile and processing-request contract

- Status: accepted
- Authors: Sonic Field Labs
- Created: 2026-08-07
- Target MASA version: 0.1.0

## Problem and use cases

MASA 0.1.0 described listening, analysis, transformation, and generation, but had no typed vocabulary for the operations that make sound matter workable at the micro and spectral scales: granulation, spectral dissection, extraction, reduction, fragmentation, time-stretching, and pitch-shifting. Agentic workflows need to command these operations through a harness (CLI, MCP, skills) while the signal processing itself runs in external engines — granular synthesizers, spectral libraries, time-pitch algorithms — that MASA must neither embed nor mandate.

## Theoretical and terminology status

Granular vocabulary follows Curtis Roads (grain, granulation, grain cloud, emission modes, envelopes, density as compositional parameter; *Composing Electronic Music: A New Aesthetic*, *Microsound*). Spectral-layer vocabulary follows Paul Osetinsky (*Stratosound*, 2010): strata as time-frequency layers separated along the frequency axis, complementing temporal separation. All are registered as attributed source terms with non-equivalences; MASA operation names (`matter.granulate`, `matter.extract`, `matter.reduce`, `matter.fragment`, `matter.timestretch`, `matter.pitchshift`) are protocol working vocabulary.

## Proposed contract

1. A `processing` profile: records declaring it carry at least one typed processing operation in history; a completed embedded operation requires a distinct descendant representation and a lineage relation bound to the receipt.
2. Typed parameter schemas per operation (grain scheme, extraction domain, reduction kind, fragmentation strategy, stretch factor, pitch cents) that engines may extend but not omit.
3. A `masa-processing-request` document: the engine-neutral contract an external adapter consumes (operation, parameters, input references, determinism requirement, policy references, output contract). A request grants no permission.
4. A read-only planning capability (`matter.plan_processing`) that composes and validates requests without performing signal processing, exposed by the reference MCP server and CLI.
5. One new lineage relation, `masa:granulated-from` (derivation, acyclic, subject-is-descendant).

## Alternatives

- Folding the operations into the Transformation profile: rejected — granular and spectral parameters deserve typed contracts, and transformation's operation set stays general.
- Embedding a reference DSP engine: rejected — MASA is not an audio engine; embedding one would bind the protocol to a runtime and violate the engine-neutral boundary.
- Defining engine wire protocols (plugin ABIs, OSC, streams): out of scope — the request document is the portable boundary; transports belong to adapters.

## Effects on implementations

Additive for readers and writers (a new profile value and schemas). Engines adopt the adapter archetype (`adapters/dsp-engine.md`) and return receipts; hosts confirm consequential operations under policy. The reference implementation gains planning and validation only; it performs no DSP and its conformance claims are unchanged in kind.

## Privacy, rights, accessibility, and ecological effects

Processing inherits the source's policy state: fragments, strata, and textures are descendants whose disclosure, consent, and license questions do not reset. Extraction can isolate voices; precise-location, secret, and disclosure audits apply to processed descendants exactly as to sources. Requests carry policy references so refusal is expressible before any engine runs.

## Migration and conformance

Added in the unreleased 0.1.0 line; no released record is invalidated. Fixtures: one valid granulation record, one invalid processing record (completed operation without its lineage relation), exercised by the reader and transformer conformance classes.

## Objections and unresolved questions

- Whether pulsar synthesis and spectral freezing deserve first-class operations or remain engine extensions under `matter.transform`: deferred to a future RFC with implementation evidence.
- Whether grain-level Regions should be enumerable in records (bounded lists versus statistical description): deferred; the grain scheme describes populations statistically, and per-grain accounting remains possible through Regions today.
