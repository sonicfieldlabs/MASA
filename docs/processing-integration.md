# Processing and listening integration boundaries

MASA 0.2 already describes external processing requests and receipts through the
[Processing profile](../spec/0.2.0/profiles/processing.md) and preserved descendants
through the [Transformation profile](../spec/0.2.0/profiles/transformation.md).
Applications should reuse those structures. MASA does not perform DSP or promote
application-specific listening vocabulary into the `masa:` namespace.

## Declare the operation actually performed

| Operation | Required integration distinctions |
| --- | --- |
| Filtered sample-rate conversion | Input/output rates, filter and version, retained bands, and actual duration. Changing representation rate with appropriate resampling ordinarily preserves playback duration. |
| Playback-rate change | Declared playback-rate ratio and resulting duration/pitch relation. Reinterpreting samples at another rate is not equivalent to filtered resampling. |
| Frequency translation | Translation frequency in Hz, algorithm/version, input/output bands, and source-to-output mapping. It is not a uniform musical pitch ratio. |
| Pitch shifting | Declared cents or ratio and the engine's duration behavior. Reuse `matter.pitchshift`; do not infer duration preservation merely from its name. |
| Time stretching | Declared factor and the engine's pitch behavior. Reuse `matter.timestretch`; do not infer pitch identity from its name. |
| Granulation | Reuse `matter.granulate`, the grain scheme, envelope, density, emission, and selection parameters. Execution stays in the named external engine. |

For operations without a standardized MASA request vocabulary, the adopting
application owns a namespaced schema and adapter. Do not label a frequency
translation as pitch shifting merely to satisfy an existing operation enum.
Preserve the source representation and record distinct descendant IDs, source and
output hashes, engine/version, algorithm parameters with units, affected window,
parent relationships, and the operation receipt. Reuse existing fields wherever
they express the fact; carry any additional detail in the application's namespace.
Unknown parameters remain qualified unknowns, not plausible defaults. A refusal,
failure, or cancellation must not fabricate a completed descendant.

## Keep evidence domains separate

An integration needs separate declarations for physical capture support, sampled
representation, effective model input after preprocessing, and human access under
a declared chain and conditions. A sample rate alone supports none of the other
three declarations. A transformed rendering gives access to the rendering; its
receipt is needed to interpret its relationship to the source.

Numerical sample/frame/subsample coordinates describe a representation or an
estimate. They do not establish a physical sensor's bandwidth, resolution, or a
human listener's temporal discrimination. Namespace registration and scale terms
must preserve that distinction. Epistemic category, confidence, source health,
availability, freshness, and disclosure remain independent; they must not be
collapsed into a total ranking of observations.

The [project integration guide](project-agnostic-integration.md) defines namespace
ownership, opaque local preservation, offline schemas, and public projection.
Applications implementing an observation-to-record adapter must retain the
observation reference and qualified status, resolve required references locally,
and establish authority outside the report. Core schema conformance does not
certify that an application's evidence mapping or external DSP engine is correct.
