# Mapping profile 0.1.0

The Mapping profile separates SourceObservation, normalization, derived relation, Mapping, synthesis target, render, performer intervention, and interpretation.

A Mapping declares source field and unit, observation time and scope, input range, normalization and clipping, missing-data behavior, target parameter and range, curve, smoothing, cadence, author, and epistemic note.

Missing, stale, unavailable, or invalid data MUST NOT silently become zero or a held value. Skipping, carrying, interpolating, sonifying uncertainty, or refusing is an explicit operation. A performer action is not source evidence. A sonification is an authored relation, not the source's literal voice.

