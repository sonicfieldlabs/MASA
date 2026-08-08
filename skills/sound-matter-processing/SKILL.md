---
name: sound-matter-processing
description: Plan, authorize, delegate, and account a granular, spectral, or time-pitch processing operation on a MASA record through an external engine.
---

# Sound matter processing

Use this procedure when an agent or conventional workflow needs to granulate, extract, reduce, fragment, timestretch, or pitch-shift a representation described by a MASA record. MASA plans and accounts the operation; an external engine performs it.

1. Validate the source record and confirm the input representation exists and is available (`matter.validate` / `masa validate`).
2. Compose a processing request with `matter.plan_processing` or `masa process template <operation>` and edit it: exact input representation identifiers, typed parameters, determinism requirement, and output contract. Validate it with `masa process check`.
3. Resolve policy before any engine runs: the request's `policyRefs` name the policies the engine evaluation must cite. Unknown authority, unknown provider terms, or a prohibition on any input blocks the operation; refusal is an outcome, not an error.
4. Under host authority, hand the request to a granular, spectral, or time-pitch engine through its adapter. The engine returns descendant representations and one OperationReceipt whose Tool names the engine and version, whose parameters echo the typed request parameters, and whose determinism declares seed state.
5. Record the results in a derived record: preserve the input representation unchanged, add each descendant with a new identifier, add the receipt to history, and add a lineage relation (`masa:granulated-from`, `masa:isolated-from`, `masa:segmented-from`, or `masa:derived-from`) whose `operationRef` names the receipt.
6. Revalidate (`masa validate`). A failed, refused, or cancelled engine run keeps its receipt and produces no descendants.
7. When a listening host is attached (an audio-capable model or listening service), listening passes MAY select regions, strata, or grain schemes — record them as passes and claims, never as unattributed parameters. Re-listen to descendants in new passes when the workflow needs verified accounts of the result.
8. Publish descendants only through the public-safe-export procedure; processed matter inherits the policy questions of its sources.

Never treat granulation as destruction of the source, an extraction as the sound's essence, or technical access to bytes as permission to process them.
