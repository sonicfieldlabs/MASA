# RFC 0003: Aperture, sonic register and projection

Status: **draft — not adopted**. No normative schema or ontology changes.

An aperture describes which distinctions a declared route can support for a source,
representation, interval and claim kind. It is not a sensor capability inferred from
a sample rate. A register records the kind of evidence presented without collapsing
digital computation into physical capture or human hearing.

Proposed terms are `masa:aperture`, `masa:sonicRegister` and `masa:projection`.
Proposed register values: `physical_acoustic_capture`, `digital_waveform`,
`simulated_field`, `nonacoustic_observation`, `sonic_control`,
`latent_representation`, `sonic_analysis`, `sonic_speculation`.

An aperture would bind source and representation identities, observer/route,
claim kind, supported intervals and bands, evidence references, and explicit
supported/unsupported/undetermined outcomes. Disjoint bands remain disjoint.
Unknown capture support must not be promoted by an upsampled representation.

A projection would identify native inputs, transformation receipt, intended
recipient and `losses`. Sonification changes an observation's representation;
it does not turn the original observation into acoustic capture. Human-oriented
images and audio projections remain descendants, never substitute evidence.

Application payloads continue using `akouo/agent-native-evidence/v1`,
`akouo/aperture-request/v1` and `oida.spectral`; these proposed `masa:` terms
must not be emitted as adopted ontology terms. Oída and Station must independently
implement the semantics and supply conformance examples before a versioned MASA
decision may promote them. Neither implementation exists as a result of this RFC.

Open decisions: vocabulary alignment with representation/claim classes, clock
alignment receipts, projection-loss vocabulary, and evidence validation ownership.
Acceptance requires two implementations, offline positive/negative conformance
fixtures and an explicit versioned decision. Until then this document is design only.
