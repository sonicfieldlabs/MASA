# Sound matter processing

MASA 0.1.0 carries a Processing profile so that agentic and conventional workflows can command granular, spectral, and time-pitch work on sound matter — granulation, extraction of bands, strata, or partials, reduction, fragmentation, time-stretching, and pitch-shifting — while every operation stays contracted, authorized, and accounted. The reference implementation performs no digital signal processing; engines are external and named per receipt.

## The flow

```text
record ──▶ plan ──▶ authorize ──▶ engine ──▶ record'
          (request)  (policy)     (DSP)      (descendants + receipt + lineage)
```

1. **Plan.** An agent composes a `masa-processing-request` — through the MCP tool `matter.plan_processing`, from `masa process template <operation>`, or by hand — naming the operation, the input representations, typed parameters, a determinism requirement, and an output contract. `masa process check` validates it offline.
2. **Authorize.** The host resolves policy: the request cites the policies its evaluation must satisfy. Unknown authority or a matching prohibition means refusal before any engine runs.
3. **Process.** An engine adapter (see `adapters/dsp-engine.md`) executes the request and returns descendant representations plus one `OperationReceipt` — engine identity in `tool`, echoed parameters, declared determinism and seed, honest final status.
4. **Account.** The workflow writes a derived record: inputs preserved, descendants under new identifiers, the receipt in history, and a lineage relation (`masa:granulated-from`, `masa:isolated-from`, `masa:segmented-from`, `masa:derived-from`) bound to the receipt through `operationRef`. `masa validate` verifies the whole account.

## Installing on a harness

Any agent harness gains sound-matter capabilities from this repository alone:

- **CLI** — `masa validate`, `masa inspect`, `masa lineage`, `masa process template`, `masa process check`, `masa project-public`, `masa audit-public`.
- **MCP** — the local stdio server exposes `matter.validate`, `matter.inspect`, `matter.trace_lineage`, `matter.audit_public_export`, and `matter.plan_processing`, plus specification resources, inside configured roots.
- **Skills** — `skills/` holds bounded procedures (`matter-inspection`, `claim-registration`, `sound-matter-processing`, `public-safe-export`) that a harness can register directly.

Engines are attached separately. Granular environments, phase-vocoder and spectral-modeling libraries, source-separation tools, and time-pitch algorithms integrate through the engine adapter archetype without ever becoming MASA dependencies; the protocol only requires that their runs come back as receipts with descendants and honest statuses.

## Listening-informed processing

When the host attaches an audio-capable model or a listening service, listening can drive processing: a pass over the source selects regions to granulate, strata to extract, or transients to fragment. The boundary stays typed — what was heard is a claim in a listening pass; what was chosen is an authored parameter; what was processed is a receipt. Descendants can be re-listened in new passes, so a workflow can iterate listen → process → listen while every step remains attributable, and a host without any listening capability can still plan, authorize, and account the same operations.

## Vocabulary and boundaries

Grain, granulation, and grain cloud carry Curtis Roads's granular lexicon; stratum and stratosound carry Paul Osetinsky's spectral-layer lexicon — all registered as attributed source terms. The protocol's own boundaries hold throughout: a grain is not a note; a cloud is not the granulated source; an extraction is an authored cut, not the sound's essence; a reduction is a sparser account, not a summary of meaning; processed descendants inherit the policy questions of their sources; and technical access to bytes is never permission to process them.
