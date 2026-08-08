# Processing profile 0.1.0

The Processing profile carries granular, spectral, and time-pitch operations on sound matter: granulation, extraction, reduction, fragmentation, time-stretching, and pitch-shifting. MASA describes, requests, authorizes, and verifies these operations; it performs none of them. Signal processing belongs to an external engine that consumes a validated processing request and returns descendants plus an OperationReceipt naming itself through the receipt's Tool.

## Operations

| Operation | Meaning | Typical lineage predicate |
| --- | --- | --- |
| `matter.granulate` | Decompose a representation into grains under a declared grain scheme and emit a texture or a fragment set. | `masa:granulated-from` |
| `matter.extract` | Isolate a spectral band, spectral strata, partial set, or temporal region from a representation. | `masa:isolated-from` |
| `matter.reduce` | Produce a sparser account of a representation: spectral peaks, envelope, decimation, mixdown, or denoising. | `masa:derived-from` |
| `matter.fragment` | Cut a representation into bounded fragments by regions, transients, equal durations, or grains. | `masa:segmented-from` |
| `matter.timestretch` | Change duration under a declared factor without asserting pitch identity. | `masa:derived-from` or `masa:variation-of` |
| `matter.pitchshift` | Change pitch by a declared amount in cents without asserting duration identity. | `masa:derived-from` or `masa:variation-of` |

A completed processing operation requires a preserved input, at least one distinct descendant Representation, an OperationReceipt with typed parameters, and a lineage relation whose `operationRef` names the receipt. Failed, refused, cancelled, or not-performed operations fabricate no descendants. Determinism is declared on the receipt; a seeded rerun is a claimable expectation, never an assumed fact.

## Grain vocabulary

The granular parameters carry Curtis Roads's granular lexicon as attributed vocabulary: grain duration ranges on the micro time scale, grain envelopes (`gaussian`, `expodec`, `rexpodec`, `triangular`, `trapezoidal`), emission modes (`synchronous`, `quasi-synchronous`, `asynchronous`), density in grains per second, and selection order over the source. Density is a compositional parameter: raising it induces coalescence, lowering it induces evaporation. A grain is not a note; a grain cloud is not the granulated source; granulation does not destroy or replace the preserved input.

## Spectral vocabulary

Spectral extraction distinguishes a fixed frequency band, a partial set, and strata. Following Osetinsky's stratosound, a stratum is a time-frequency layer separated from a sound along its frequency axis — a perceptual and analytic layer, not merely a filter band. Temporal dissection produces fragments; spectral dissection produces strata; granular dissection produces grains bounded in both dimensions. An extraction is an authored cut, not the sound's essence, and a reduction is a sparser account, not a summary of meaning.

## Engine boundary

Engines are external. The receipt's Tool names the engine, version, and kind; `provider` and `adapter` remain qualified values that can be unknown or withheld. A processing request (`processing-request.schema.json`) is the engine-neutral contract: operation, typed parameters, input references, determinism requirement, policy references, and an output contract. Technical ability to process a representation is not permission to process it: a completed consequential operation requires a permitting policy evaluation, and provider terms that are unknown remain unknown.

## Listening boundary

When the host attaches an audio-capable model or a listening service, listening passes MAY inform grain selection, strata choice, or region boundaries. Listening evidence stays typed: a heard claim requires a listening pass, a measured claim requires method and units, and neither becomes a processing parameter without an attributable authoring step. Processing outputs MAY be re-listened; a re-listening is a new pass and never overwrites the account of the source.
