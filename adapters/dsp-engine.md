# DSP engine adapter archetype

Placeholder namespace: `dsp:`

A signal-processing engine — granular synthesizer, spectral-analysis library, time-pitch algorithm, or general DSP toolkit — consumes MASA processing requests and returns descendants plus receipts. The engine is never part of MASA: it is named by the receipt's Tool (name, version, kind), and its provider terms remain qualified values that can be unknown or withheld.

An engine adapter must document:

1. which `masa-processing-request` operations it accepts (`matter.granulate`, `matter.extract`, `matter.reduce`, `matter.fragment`, `matter.timestretch`, `matter.pitchshift`) and which typed parameters it honors, extends, or refuses;
2. how it reports determinism: a `require-deterministic` or `require-seeded` request that the engine cannot honor is refused, not silently downgraded;
3. that every completed run yields new descendant identifiers, echoes the request parameters in the receipt, and never mutates input bytes;
4. that failed, refused, cancelled, and partial runs return receipts with those statuses and no fabricated outputs;
5. its resource bounds (duration, memory, output count) against the request's output contract;
6. which engine-specific vocabulary stays in its own namespace (grain-scheme extensions, window types, algorithm names).

Typical engine families this archetype covers: granular and pulsar synthesis environments, phase-vocoder and spectral-modeling libraries, source separation and partial-tracking tools, and time-stretch or pitch-shift algorithms. The adapter, not MASA, owns codec handling, sample-rate policy, and real-time behavior.

Grain, cloud, and stratum vocabulary in requests carries its attributed meaning from the term registry; an engine's private taxonomy never redefines it.
