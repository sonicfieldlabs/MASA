# MASA Core 0.1.0

Status: normative local protocol release

Version: `0.1.0`
Canonical schema: `https://masa.sonicfield.org/schemas/0.1.0/matter-record.schema.json`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** indicate conformance requirements.

## 1. Purpose

MASA is a language-neutral protocol for carrying inspectable accounts of sound as matter across software, scripts, archives, instruments, and agentic workflows. It is informed by a preserved research corpus on listening and sonic matter, attributed term by term in the vocabulary registries, but it does not turn that theory into mandatory data.

The Core connects sources, representations, encounters, claims, operations, actors, policies, contexts, and lineage. A MatterRecord is an envelope around these relations. It is not the physical event, an audio asset, a sound object, an auditum, or a final description of sound.

## 2. Conformance surface

A conforming document MUST:

1. be valid JSON without duplicate object keys or the prohibited `__proto__` member name;
2. declare `masaVersion: "0.1.0"` and the `core` profile;
3. validate against the Core JSON Schema without remote schema retrieval;
4. pass the semantic invariants in Section 8;
5. keep extensions inside the namespaced `extensions` object;
6. preserve unknown extensions during ordinary Reader and Writer round trips or report an explicit incompatibility;
7. carry an explicit policy state, including when authority is unknown;
8. distinguish claim kind, actor, confidence, health, freshness, and disclosure.

Conformance is reported for an exact MASA version, profile, conformance class, implementation version, and test suite. “MASA-compatible” without that tuple is not a conformance claim.

## 3. Qualified states

Required knowledge that may be missing or protected uses a qualified state rather than `null` or an empty string:

| State | Meaning |
| --- | --- |
| `known` | A non-null value is asserted and its provenance can be named. |
| `unknown` | The record cannot currently establish a value; a reason is required. |
| `withheld` | A value exists or may exist but policy prevents disclosure; policy references are required. |
| `unavailable` | An operational dependency or representation cannot be accessed; a reason is required. |
| `deleted` | A previously held value was removed; a reason and deletion receipt reference are required. |
| `not_applicable` | The field does not apply to this object or profile. |

`known` with `null` is invalid because it collapses all qualified absence states. Omission means “not asserted by this profile.” It does not mean unknown, withheld, deleted, or empty.

## 4. Identifiers and versions

- Every record and stored entity MUST have a globally unique absolute identifier.
- The reference implementation generates `urn:uuid:<uuid>` identifiers. Other absolute identifiers MAY be used.
- A content digest identifies exact bytes. It MUST NOT be used as the sole semantic identity, authorship claim, ownership claim, or consent record.
- `masaVersion` identifies the normative protocol version. Records MUST NOT use `latest` as a stored version.
- A revised account increments `revision` and declares `supersedes` when applicable. A transformation creates a descendant representation rather than changing the bytes behind an existing representation identifier.

## 5. Core objects

### 5.1 MatterRecord

A MatterRecord contains the shared envelope and at least one Actor, one Representation, and one Policy. It declares its profiles, revision, creator, disclosure, registers, scales, relations, and event history. Arrays that have no current members remain empty only when the schema permits them.

### 5.2 Actor

An Actor is a human, community, organization, software system, agent, model, or instrument participating in a claim or operation. Actor identity MAY be pseudonymous, opaque, or withheld. `user` is an actor origin, never a confidence value.

### 5.3 Source

A Source records origin or causal reference and the status of that identification. Known file origin does not prove physical, social, or represented cause. Source coverage, authority, rights, health, and freshness remain explicit.

### 5.4 Representation

A Representation is a carrier available to a system: file, stream, buffer, data series, prompt, image, mesh, score, model output, performance capture, or another supported medium. A representation declares availability, disclosure, location state, policy, and integrity state. `source-representation` means the preserved input to this lineage, not unmediated reality.

### 5.5 Encounter, Aperture, and ListeningPass

An Encounter situates how matter entered a process. An Aperture records selection and conditioning such as channels, ranges, windows, thresholds, preprocessing, exclusions, and blind spots. A ListeningPass connects actors, representations, an aperture, listening modes, context, claims, and an outcome. Human listening and machine audition MAY be related but MUST remain non-equivalent actor and method states.

### 5.6 Claim

The only Core claim kinds are:

`heard | measured | inferred | interpreted | speculative | undetermined`

- `heard` names a situated perceptual or operational registration and requires a listening route or method.
- `measured` requires a value, unit, method, window or range, and uncertainty or calibration state.
- `inferred` requires evidence inputs and a named rule, model, comparison, or method.
- `interpreted` requires a declared position or contextual frame.
- `speculative` requires a rationale and an explicit boundary from source observation.
- `undetermined` requires a reason such as missing, conflicting, restricted, stale, ambiguous, out of scope, or not performed.

Remembering and translation are provenance or method. Human or model authorship is actor provenance. Withholding is disclosure. None is a claim kind.

### 5.7 Confidence, health, freshness, and disclosure

Confidence is either `not_assessed` or an assessed expression with a method and scale. A `high`, `medium`, or `low` class is valid only when the scale and method are named.

Source health records operational state such as healthy, degraded, unavailable, or error. Freshness records observation, retrieval, expiry, and current or stale status. Disclosure records public, private, restricted, withheld, or redacted state. These axes MUST NOT be merged.

### 5.8 OperationReceipt and history

An OperationReceipt records one attempted operation, including completed, failed, refused, cancelled, partial, undetermined, and not-performed outcomes. It carries actors, inputs, outputs, tool and method, parameters, policy evaluation, determinism, reversibility, warnings, errors, and claims.

History uses exactly one mode:

- `embedded`, with complete receipts inside a standalone `.masa.json` record; or
- `external`, with an `events.ndjson` reference and an ordered list of event identifiers inside a bundle.

The two modes prevent an embedded event history and an external log from silently disagreeing.

### 5.9 Relation and lineage

Relations are explicit assertions with subject, predicate, object, actor, time, and basis. The relation registry declares whether the subject or object is the descendant for causal-lineage traversal; inverse syntax therefore produces the same directed lineage. Derivation and version relations form an acyclic graph. Epistemic relations such as support, contradiction, difference, and incomparability MAY be cyclic.

Lineage records derivation and responsibility. It does not settle authorship, ownership, license, consent, or ethical legitimacy.

### 5.10 Policy and evaluation

A Policy states an issuer, authority basis, status, disclosure, rules, targets, actions, validity, and review route. A PolicyEvaluation applies one or more policies to one operation and target. Runtime authority and policy permission are independent; both must allow a consequential action.

Unknown authority MUST NOT authorize publication, external upload, identification, precise-location disclosure, training, deletion, or another consequential external action.

### 5.11 Context and integrity

Context may be historical, territorial, ecological, institutional, compositional, cosmological, technical, or another namespaced frame. It declares provenance and claim status.

Integrity records algorithm, digest, byte size, verification status, and verification time. Integrity verifies referenced bytes under a method; it does not establish their meaning or legitimacy.

## 6. Registers and scales

Core registers are physical-event, perceptual-acoulogical, compositional-transformational, digital-technical, ecological-territorial, historical-political, and cosmological-speculative.

Core scales are microtemporal, spectral-stratal, object-event, meso-form, environmental, corpus-lineage, infrastructural, planetary, and cosmic. Implementations MAY add namespaced registers and scales without changing the meaning of Core values. A scale label SHOULD include actual windows, ranges, resolution, and source coverage when known. Planetary is not universal, and microsound is one scale rather than the whole of sonic matter.

## 7. Extensions

All extension data MUST appear in an `extensions` object with namespaced keys. Core schemas reject unknown top-level properties to catch misspellings. A namespace identifies its governing implementation or community; it does not imply affiliation with the MASA reference repository.

Readers MUST preserve unsupported extension values semantically and report them. Publishers MUST exclude unsupported extensions unless an approved publication schema and policy apply to the exact projection.

## 8. Semantic invariants

After JSON Schema validation, an implementation MUST enforce:

1. all entity identifiers are unique inside the record or bundle;
2. all required local references resolve; explicitly external, withheld, unavailable, or deleted references remain typed as such;
3. profile declarations match their required entities and behavior;
4. local event identifiers and sequence numbers are unique and sequence order is monotonic;
5. wall-clock time does not establish distributed causal order;
6. relations that the versioned registry marks acyclic — derivation, version, structural containment, and related registered categories — form one acyclic directed graph;
7. completed consequential operations include a policy evaluation;
8. a transform, isolate, segment, render, or generation output never reuses its input Representation identifier;
9. every descendant representation has a parent relation and generating operation;
10. an immutable included representation cannot change digest under the same identifier;
11. a refused or withheld receipt does not reconstruct protected content;
12. publication and deletion are irreversible; interface undo is not a material inverse;
13. a deletion tombstone retains only independently authorized fields;
14. unknown extension data survives local Reader and Writer round trips;
15. public projections contain no absolute local paths, credentials, private endpoints, protected precision, restricted media, or unapproved extensions.
16. references that name a protocol role resolve to the correct entity kind, not merely to any reused identifier;
17. temporal windows, freshness intervals, policy validity, and operation intervals preserve their declared order;
18. a permitted public projection cites an active public rule that explicitly permits the exact publish action and target under known authority.

## 9. Validation phases

Reference validation runs in this order:

1. JSON syntax and duplicate-key safety;
2. JSON Schema 2020-12 structure;
3. reference closure, identity, event, and lineage semantics;
4. declared profile invariants;
5. policy, disclosure, public-safety, and bundle integrity checks.

Structural validity does not prove a claim true, a policy legitimate, a transformation reproducible, or publication authorized.

## 10. Non-equivalence register

Conforming systems preserve at least these distinctions:

- physical event ≠ signal ≠ representation ≠ MatterRecord;
- source origin ≠ causal attribution;
- sounding body ≠ perceptual sound matter;
- sound object ≠ auditum;
- recording ≠ original event;
- feature or measurement ≠ perceived quality;
- claim kind ≠ confidence ≠ actor ≠ health ≠ freshness ≠ disclosure;
- mapping ≠ source voice;
- observation ≠ derived index ≠ mapping ≠ synthesis ≠ performance ≠ speculation;
- copy ≠ encoding derivative ≠ continuation ≠ inpaint ≠ variation ≠ mutation ≠ graft;
- lineage ≠ authorship, ownership, license, consent, or ethical legitimacy;
- technical access ≠ authority;
- interface undo ≠ verified inverse;
- plurality ≠ fusion;
- silence, missing data, timeout, withholding, refusal, and low signal are not interchangeable.
