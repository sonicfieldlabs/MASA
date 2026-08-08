# MASA policy and disclosure 0.1.0

MASA records policy state; it does not manufacture consent or jurisdiction.

## Separate concerns

- **License** concerns legal permissions attached to code, works, datasets, models, or outputs.
- **Consent** concerns affected people or communities and specific capture, use, transformation, storage, training, disclosure, or revocation conditions.
- **Jurisdiction** concerns who has authority over a body, voice, territory, habitat, archive, or relation.
- **Covenant** records human-written operational commitments.
- **Provider terms** record contractual conditions of an API, model, or service.
- **Runtime authority** is the host's scoped ability to perform an operation.

These fields can be connected but MUST NOT be collapsed.

## Effects and status

Rules have `permission`, `prohibition`, `duty`, or `unknown` effect. Policies have `active`, `expired`, `revoked`, `under_review`, or `unknown` status. A PolicyEvaluation records `permitted`, `prohibited`, `required`, `unknown`, `refused`, or `under_review` for an exact action and target.

Unknown or under-review authority does not authorize consequential external action. A public URL or technically readable file is not automatic permission to extract, train, transform, identify, or publish.

## Public projection

Publication builds a new allowlisted projection. It never edits the private record in place. A Publisher MUST:

1. require an active, permitted publication evaluation backed by an explicit permission rule for the exact publish action and target under known authority;
2. include only explicitly public entities and approved derivative assets;
3. exclude private, restricted, withheld, revoked, expired, unknown, or unapproved material;
4. exclude unknown extensions by default;
5. remove absolute paths, secrets, private endpoints, precise protected locations, restricted voices, private digests, and provider configuration;
6. emit omission and redaction categories without protected values;
7. retain attribution, protocol version, policy status, correction route, and revocation route;
8. audit the final emitted artifact again.

Secret scanning is defense in depth and cannot override policy.

## Deletion and tombstones

Deletion removes prohibited payloads from authorized storage targets. A minimal tombstone MAY remain only when separately authorized. The tombstone MUST NOT reconstruct protected content. Publication and deletion are irreversible operation classes.
