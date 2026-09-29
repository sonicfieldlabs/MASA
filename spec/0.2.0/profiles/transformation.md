# Transformation profile 0.2.0

A completed transformation requires a preserved input, a distinct descendant Representation, an OperationReceipt, a parent relation, a preservation intent, and a reversibility class.

Core transformation operations include segment, isolate, transform, sculpt, recompose, render, and compensate. Interface undo is recorded separately from a verified material inverse. Failed, refused, cancelled, or not-performed transformations do not fabricate descendants.

## Validation erratum, reference tooling 0.2.1

A lineage relation MUST identify the actual receipt that lists its parent in `inputs` and its descendant in `outputs`, in either predicate direction. Only completed or partial outcomes can attest produced descendants. A partial receipt may attest only its explicitly produced outputs, with an authorizing policy result for consequential effects; a partial attempt with no outputs remains valid without descendant claims. An undetermined outcome does not establish generating causality.

A core transformation operation identifies its requirements even when the record omits the transformation profile label. Every embedded transformation operation is checked, including additional operations after a valid one. Completed status activates the nonempty-output and preservation-intent requirements independently of whether those fields were supplied. Preservation intent includes both its nonempty properties list and its qualified verification. Failed, refused, cancelled and not-performed attempts remain valid when they disclose noncompletion and do not claim descendants.

A standalone record with external history establishes only declared receipt identifiers. Bundle validation MUST bind the available event-log receipts to their parent/output relations and validate each completed transformation receipt. No remote history is fetched. Generating effects are derive, transform, generate, map, render, perform, remember and publish; destructive and no-effect receipts cannot generate a descendant representation. A completed or partial read receipt may establish `masa:captured-from` provenance for an explicitly listed capture output; it cannot attest a transformation or derivation.
