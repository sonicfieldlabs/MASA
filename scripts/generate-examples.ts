import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { CANONICAL_ROOT, SCHEMA_ID_PREFIX } from "./canonical.js";

type JsonObject = Record<string, any>;

const root = resolve(import.meta.dirname, "..");
const validDirectory = join(root, "examples", "0.1.0", "valid");
const invalidDirectory = join(root, "examples", "0.1.0", "invalid");
const minimalPath = join(validDirectory, "minimal-record.masa.json");
const minimal = JSON.parse(await readFile(minimalPath, "utf8")) as JsonObject;

const actorId = minimal.actors[0].id as string;
const policyId = minimal.policies[0].id as string;
const policyRuleId = minimal.policies[0].rules[0].id as string;

function clone(): JsonObject {
  return structuredClone(minimal) as JsonObject;
}

function known(value: unknown): JsonObject {
  return { state: "known", value };
}

function unknown(reason: string, reasonCode: string): JsonObject {
  return { state: "unknown", reason, reasonCode };
}

function method(name: string): JsonObject {
  return { name, version: known("1.0.0"), parameters: {} };
}

function window(start = 0, end = 1): JsonObject {
  return { kind: "temporal", unit: "s", start, end };
}

function audioTechnical(): JsonObject {
  return {
    durationSeconds: known(1),
    channels: known(1),
    sampleRateHz: known(48000),
    bitDepth: known(24),
    encoding: known("PCM signed integer little-endian"),
    spatialFormat: known("mono"),
    levelContext: unknown("No calibrated playback or capture level is attached to this fixture.", "not_calibrated")
  };
}

function retarget(record: JsonObject, id: string): void {
  record.id = id;
  record.policies[0].rules[0].targets = [id];
}

function policyEvaluation(record: JsonObject, action: string, targets: string[]): JsonObject {
  return {
    action,
    targets,
    policyRefs: [policyId],
    result: "permitted",
    evaluatedAt: "2026-07-27T12:01:00Z",
    evaluator: actorId,
    authorityRefs: [policyRuleId],
    reasons: ["The active local fixture policy explicitly permits this bounded operation."]
  };
}

function tool(id: string, name: string, kind = "software"): JsonObject {
  return { id, name, version: known("0.1.0"), kind };
}

function receipt(record: JsonObject, values: Partial<JsonObject>): JsonObject {
  return {
    id: values.id,
    type: "masa:OperationReceipt",
    recordId: record.id,
    sequence: values.sequence ?? 0,
    operationType: values.operationType,
    effectClass: values.effectClass,
    finalStatus: values.finalStatus ?? "completed",
    startedAt: values.startedAt ?? "2026-07-27T12:01:00Z",
    endedAt: values.endedAt ?? "2026-07-27T12:01:01Z",
    actors: values.actors ?? [actorId],
    inputs: values.inputs ?? [],
    outputs: values.outputs ?? [],
    tool: { state: "known", value: values.tool },
    parameters: values.parameters ?? {},
    policyEvaluation: values.policyEvaluation,
    reversibility: values.reversibility ?? "undetermined",
    determinism: values.determinism ?? { state: "deterministic" },
    warnings: values.warnings ?? [],
    errors: values.errors ?? [],
    claimRefs: values.claimRefs ?? [],
    extensions: values.extensions ?? {}
  };
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing !== content) {
    await writeFile(path, content, "utf8");
  }
}

async function save(directory: string, name: string, value: JsonObject): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeIfChanged(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

const listening = clone();
retarget(listening, "urn:uuid:00000000-0000-4000-8000-000000000002");
listening.title = "Plural listening and situated analysis";
listening.profiles = ["core", "audio", "listening", "analysis"];
listening.representations[0].mediaType = "audio/wav";
listening.representations[0].audio = audioTechnical();
listening.encounters = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000501",
    type: "masa:Encounter",
    occurredAt: "2026-07-27T12:02:00Z",
    actors: [actorId],
    question: "How does the short event hold together across focal and global attention?",
    position: known("Headphones, seated, local studio; playback level not calibrated"),
    accessConditions: ["One-channel unavailable source is represented by fixture metadata only"],
    contextRefs: [],
    extensions: {}
  }
];
listening.apertures = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000502",
    type: "masa:Aperture",
    description: "Full-band one-second aperture without preprocessing",
    channels: ["mono"],
    ranges: [{ kind: "spectral", unit: "Hz", start: 20, end: 20000 }],
    windows: [window()],
    thresholds: [],
    preprocessing: [],
    exclusions: [],
    blindSpots: ["Unavailable source bytes prevent independent replay"],
    extensions: {}
  }
];
listening.claims = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000503",
    type: "masa:Claim",
    kind: "heard",
    about: [listening.representations[0].id],
    basis: [{ ref: listening.representations[0].id, role: "representation" }],
    actor: actorId,
    createdAt: "2026-07-27T12:03:00Z",
    content: "The event was registered as one compact gesture.",
    method: method("focal listening pass"),
    listeningPassRef: "urn:uuid:00000000-0000-4000-8000-000000000505",
    confidence: { status: "not_assessed" },
    uncertainty: ["Playback level was not calibrated"],
    alternativeClaimRefs: ["urn:uuid:00000000-0000-4000-8000-000000000504"],
    disclosure: "private",
    extensions: {}
  },
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000504",
    type: "masa:Claim",
    kind: "heard",
    about: [listening.representations[0].id],
    basis: [{ ref: listening.representations[0].id, role: "representation" }],
    actor: actorId,
    createdAt: "2026-07-27T12:04:00Z",
    content: "A second pass registered two successive material articulations rather than one gesture.",
    method: method("global re-listening pass"),
    listeningPassRef: "urn:uuid:00000000-0000-4000-8000-000000000506",
    confidence: { status: "not_assessed" },
    uncertainty: ["The two accounts remain intentionally unresolved"],
    alternativeClaimRefs: ["urn:uuid:00000000-0000-4000-8000-000000000503"],
    disclosure: "private",
    extensions: {}
  }
];
listening.listeningPasses = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000505",
    type: "masa:ListeningPass",
    actors: [actorId],
    representations: [listening.representations[0].id],
    encounterRef: listening.encounters[0].id,
    apertureRef: listening.apertures[0].id,
    modes: ["focal", "material"],
    createdAt: "2026-07-27T12:03:00Z",
    outcome: "claims",
    claimRefs: [listening.claims[0].id],
    disclosure: "private",
    extensions: {}
  },
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000506",
    type: "masa:ListeningPass",
    actors: [actorId],
    representations: [listening.representations[0].id],
    encounterRef: listening.encounters[0].id,
    apertureRef: listening.apertures[0].id,
    modes: ["global", "material"],
    createdAt: "2026-07-27T12:04:00Z",
    outcome: "claims",
    claimRefs: [listening.claims[1].id],
    disclosure: "private",
    extensions: {}
  }
];
listening.regions = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000507",
    type: "masa:Region",
    representationRef: listening.representations[0].id,
    basis: "temporal",
    bounds: { unit: "s", start: 0, end: 1 },
    createdBy: actorId,
    createdAt: "2026-07-27T12:05:00Z",
    method: method("fixture interval declaration"),
    uncertainty: ["Region follows metadata duration because bytes are unavailable"],
    extensions: {}
  }
];
listening.measurements = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000508",
    type: "masa:Measurement",
    about: listening.representations[0].id,
    metric: "declared duration",
    value: 1,
    unit: "s",
    method: method("metadata declaration"),
    window: window(),
    actor: actorId,
    createdAt: "2026-07-27T12:05:00Z",
    uncertainty: ["Not remeasured from bytes"],
    extensions: {}
  }
];

const transformation = clone();
retarget(transformation, "urn:uuid:00000000-0000-4000-8000-000000000003");
transformation.title = "Lineage-preserving transformation";
transformation.profiles = ["core", "audio", "transformation"];
transformation.policies[0].rules[0].actions.push("transform");
transformation.representations[0].id = "urn:uuid:00000000-0000-4000-8000-000000000601";
transformation.representations[0].mediaType = "audio/wav";
transformation.representations[0].audio = audioTechnical();
transformation.representations.push({
  ...structuredClone(transformation.representations[0]),
  id: "urn:uuid:00000000-0000-4000-8000-000000000602",
  role: "derivative",
  format: known("WAVE PCM derivative; bytes omitted from fixture")
});
const transformationReceiptId = "urn:uuid:00000000-0000-4000-8000-000000000603";
transformation.history = {
  mode: "embedded",
  events: [
    receipt(transformation, {
      id: transformationReceiptId,
      operationType: "matter.transform",
      effectClass: "transform",
      inputs: [transformation.representations[0].id],
      outputs: [transformation.representations[1].id],
      tool: tool("urn:uuid:00000000-0000-4000-8000-000000000604", "MASA fixture transform", "script"),
      parameters: {
        operation: "gain",
        gainDb: -3,
        preservationIntent: {
          properties: ["duration", "channel-layout"],
          verification: unknown("Derivative bytes are omitted from this structural fixture.", "not_bundled")
        }
      },
      policyEvaluation: policyEvaluation(transformation, "transform", [transformation.representations[1].id]),
      reversibility: "compensatable"
    })
  ]
};
transformation.relations = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000605",
    type: "masa:Relation",
    subject: transformation.representations[1].id,
    predicate: "masa:derived-from",
    object: transformation.representations[0].id,
    assertedBy: actorId,
    createdAt: "2026-07-27T12:01:01Z",
    basis: [{ ref: transformationReceiptId, role: "operation" }],
    operationRef: transformationReceiptId,
    extensions: {}
  }
];

const generation = structuredClone(transformation) as JsonObject;
retarget(generation, "urn:uuid:00000000-0000-4000-8000-000000000004");
generation.title = "Seeded generated descendant";
generation.profiles = ["core", "audio", "generation"];
generation.policies[0].rules[0].actions.push("generate");
generation.representations[1].id = "urn:uuid:00000000-0000-4000-8000-000000000702";
generation.representations[1].role = "model-output";
generation.relations[0].id = "urn:uuid:00000000-0000-4000-8000-000000000705";
generation.relations[0].subject = generation.representations[1].id;
generation.relations[0].predicate = "masa:derived-from";
generation.relations[0].operationRef = "urn:uuid:00000000-0000-4000-8000-000000000703";
generation.relations[0].basis = [{ ref: generation.relations[0].operationRef, role: "operation" }];
generation.history.events = [
  receipt(generation, {
    id: generation.relations[0].operationRef,
    operationType: "matter.generate",
    effectClass: "generate",
    inputs: [generation.representations[0].id],
    outputs: [generation.representations[1].id],
    tool: {
      ...tool("urn:uuid:00000000-0000-4000-8000-000000000704", "Local fixture generator", "model"),
      provider: known("offline fixture; no provider invocation"),
      adapter: known("reference adapter 0.1.0")
    },
    parameters: {
      generationMethod: "seeded local variation fixture",
      parentRefs: [generation.representations[0].id],
      conditioningRefs: [],
      regionRefs: [],
      prompt: known("bounded local fixture"),
      negativePrompt: { state: "not_applicable" },
      model: known("fixture-model 0.1.0; not executed"),
      adapter: known("reference adapter 0.1.0"),
      provider: known("offline fixture; no provider invocation"),
      providerPolicyState: unknown("No external provider terms apply to this unexecuted fixture.", "not_applicable_offline"),
      selection: known("Single supplied conformance descendant"),
      rejectedOutputRefs: []
    },
    policyEvaluation: policyEvaluation(generation, "generate", [generation.representations[1].id]),
    reversibility: "irreversible",
    determinism: { state: "seeded", seed: 27072026 }
  })
];

const mapping = clone();
retarget(mapping, "urn:uuid:00000000-0000-4000-8000-000000000005");
mapping.title = "Stale observation skipped explicitly";
mapping.profiles = ["core", "mapping"];
mapping.policies[0].rules[0].actions.push("map");
mapping.sources = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000801",
    type: "masa:Source",
    sourceKind: "astronomical-api-field",
    identification: known("Example solar activity index"),
    locator: known("https://example.invalid/observations/solar-index"),
    authority: unknown("Fixture does not assert institutional authority.", "fixture_only"),
    rights: unknown("Provider terms were not retrieved for this offline fixture.", "not_retrieved"),
    coverage: known({ scope: "demonstration only" }),
    health: { status: "degraded", checkedAt: "2026-07-27T11:00:00Z", reason: "Fixture marks the feed stale" },
    freshness: { status: "stale", observedAt: "2026-07-26T11:00:00Z", ageSeconds: 90000 },
    policyRefs: [policyId],
    disclosure: "private",
    extensions: {}
  }
];
mapping.observations = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000802",
    type: "masa:Observation",
    sourceRef: mapping.sources[0].id,
    field: "solar_activity_index",
    observedAt: "2026-07-26T11:00:00Z",
    scope: known("Example interval"),
    value: known(72.4),
    unit: known("index-point"),
    method: method("offline fixture observation"),
    health: mapping.sources[0].health,
    freshness: mapping.sources[0].freshness,
    disclosure: "private",
    extensions: {}
  }
];
mapping.mappings = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000803",
    type: "masa:Mapping",
    sourceObservationRefs: [mapping.observations[0].id],
    sourceField: "solar_activity_index",
    sourceUnit: "index-point",
    inputRange: [0, 100],
    normalization: { method: "linear", clipping: "clamp", parameters: {} },
    target: "synth.filter.cutoff",
    outputRange: [120, 7200],
    curve: "exponential",
    smoothingMs: 200,
    cadence: "once per accepted observation",
    missingData: "skip",
    epistemicNote: "This authored mapping does not make the synthesized result the source's voice.",
    actors: [actorId],
    createdAt: "2026-07-27T12:06:00Z",
    extensions: { "example:control": { parameter: "filter.cutoff" } }
  }
];
mapping.history = {
  mode: "embedded",
  events: [
    receipt(mapping, {
      id: "urn:uuid:00000000-0000-4000-8000-000000000804",
      operationType: "matter.map",
      effectClass: "map",
      finalStatus: "not_performed",
      inputs: [mapping.observations[0].id],
      outputs: [],
      tool: tool("urn:uuid:00000000-0000-4000-8000-000000000805", "Generic mapping adapter fixture", "software"),
      parameters: { reason: "stale input", missingData: "skip" },
      policyEvaluation: policyEvaluation(mapping, "map", [mapping.mappings[0].id]),
      warnings: ["Stale observation was not converted into a control value"]
    })
  ]
};

const agent = clone();
retarget(agent, "urn:uuid:00000000-0000-4000-8000-000000000006");
agent.title = "Bounded local agent inspection";
agent.profiles = ["core", "agent"];
const agentId = "urn:uuid:00000000-0000-4000-8000-000000000901";
const agentReceiptId = "urn:uuid:00000000-0000-4000-8000-000000000903";
const capabilityId = "urn:uuid:00000000-0000-4000-8000-000000000905";
agent.actors.push({
  id: agentId,
  type: "masa:Actor",
  actorKind: "agent",
  roles: ["validator"],
  name: known("Local MASA fixture agent"),
  authorityRefs: [policyRuleId],
  disclosure: "private",
  extensions: {}
});
agent.policies[0].rules[0].subjects.push(agentId);
agent.capabilities = [
  {
    id: capabilityId,
    type: "masa:Capability",
    name: "matter.validate",
    purpose: "Validate one record inside a host-configured local root without writing or using the network.",
    supportedMasaVersions: ["0.1.0"],
    profiles: ["core", "agent"],
    inputSchema: { state: "known", uri: `${SCHEMA_ID_PREFIX}matter-record.schema.json` },
    outputSchema: { state: "known", uri: `${SCHEMA_ID_PREFIX}conformance-result.schema.json` },
    resources: { local: ["configured-roots"], network: [], providers: [], hardware: [] },
    sideEffects: ["local-read"],
    authority: { required: true, source: "trusted-host", scopes: ["local-read"] },
    confirmation: "host-policy",
    riskFlags: {
      expose: false,
      publish: false,
      delete: false,
      overwrite: false,
      paidProvider: false,
      externalSystem: false,
      preciseLocation: false
    },
    receiptType: "masa:OperationReceipt",
    determinism: ["deterministic"],
    outcomes: ["completed", "failed", "refused", "not_performed"],
    limits: { maxRecordBytes: 16777216 },
    extensions: {}
  }
];
agent.agentRuns = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000902",
    type: "masa:AgentRun",
    actorRef: agentId,
    plan: ["Validate the local record", "Stop without modifying it"],
    capabilityRefs: [capabilityId],
    memoryRefs: [],
    authorityRefs: [policyRuleId],
    budget: { maxOperations: 1, network: false },
    stopConditions: ["Stop after validation", "Refuse any requested external action"],
    operationRefs: [agentReceiptId],
    review: known("Fixture reviewed by its local author"),
    outcome: "completed",
    extensions: {}
  }
];
agent.history = {
  mode: "embedded",
  events: [
    receipt(agent, {
      id: agentReceiptId,
      operationType: "matter.validate",
      effectClass: "read",
      actors: [agentId],
      inputs: [agent.id],
      outputs: [],
      tool: tool("urn:uuid:00000000-0000-4000-8000-000000000904", "MASA local validator"),
      parameters: { network: false, write: false },
      policyEvaluation: policyEvaluation(agent, "validate", [agent.id]),
      reversibility: "reversible"
    })
  ]
};

const processing = clone();
retarget(processing, "urn:uuid:00000000-0000-4000-8000-000000000009");
processing.title = "Granulated texture with an accounted grain scheme";
processing.profiles = ["core", "audio", "processing"];
processing.policies[0].rules[0].actions.push("granulate");
processing.representations[0].id = "urn:uuid:00000000-0000-4000-8000-000000000d01";
processing.representations[0].mediaType = "audio/wav";
processing.representations[0].audio = audioTechnical();
processing.representations.push({
  ...structuredClone(processing.representations[0]),
  id: "urn:uuid:00000000-0000-4000-8000-000000000d02",
  role: "render",
  format: known("WAVE PCM granular texture; bytes omitted from fixture")
});
processing.regions = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000d05",
    type: "masa:Region",
    representationRef: processing.representations[0].id,
    basis: "temporal",
    bounds: { unit: "s", start: 0.25, end: 0.75 },
    createdBy: actorId,
    createdAt: "2026-08-07T12:00:00Z",
    method: method("fixture interval declaration"),
    uncertainty: ["Selection interval follows metadata duration because bytes are unavailable"],
    extensions: {}
  }
];
const processingReceiptId = "urn:uuid:00000000-0000-4000-8000-000000000d03";
processing.history = {
  mode: "embedded",
  events: [
    receipt(processing, {
      id: processingReceiptId,
      operationType: "matter.granulate",
      effectClass: "derive",
      inputs: [processing.representations[0].id],
      outputs: [processing.representations[1].id],
      tool: tool("urn:uuid:00000000-0000-4000-8000-000000000d04", "Granular engine fixture", "software"),
      parameters: {
        grain: { durationMs: { min: 5, max: 80 }, envelope: "expodec", pitchScatterCents: 35 },
        emission: { mode: "asynchronous", grainsPerSecond: 240, totalGrains: 4800 },
        selection: { order: "statistical", regionRefs: [processing.regions[0].id] },
        output: { kind: "texture" }
      },
      policyEvaluation: policyEvaluation(processing, "granulate", [processing.representations[1].id]),
      reversibility: "irreversible",
      determinism: { state: "seeded", seed: 20260807 }
    })
  ]
};
processing.relations = [
  {
    id: "urn:uuid:00000000-0000-4000-8000-000000000d06",
    type: "masa:Relation",
    subject: processing.representations[1].id,
    predicate: "masa:granulated-from",
    object: processing.representations[0].id,
    assertedBy: actorId,
    createdAt: "2026-08-07T12:00:01Z",
    basis: [{ ref: processingReceiptId, role: "operation" }],
    operationRef: processingReceiptId,
    extensions: {}
  }
];

const publication = clone();
retarget(publication, "urn:uuid:00000000-0000-4000-8000-000000000007");
publication.title = "Public-safe MASA projection";
publication.description = "A deliberately minimal public derivative with no private media, local paths, or unknown extensions.";
publication.profiles = ["core", "publication"];
publication.disclosure = "public";
publication.extensions = {};
publication.actors[0].disclosure = "public";
publication.actors[0].name = known("MASA example author");
publication.representations[0].role = "preview";
publication.representations[0].mediaType = "application/json";
publication.representations[0].availability = "available";
publication.representations[0].locator = known(`${CANONICAL_ROOT}examples/public-safe.json`);
publication.representations[0].integrity = known({
  algorithm: "sha-256",
  digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  byteLength: 0,
  status: "unverified"
});
publication.representations[0].disclosure = "public";
publication.policies[0].policyKind = "publication";
publication.policies[0].disclosure = "public";
publication.policies[0].rules[0].actions = ["read", "publish"];
publication.policies[0].rules[0].authorityBasis = known("Fixture author approval for this exact public projection");
publication.publication = {
  publicRecordId: publication.id,
  approvedAt: "2026-07-27T12:10:00Z",
  approvedBy: actorId,
  policyEvaluation: policyEvaluation(publication, "publish", [publication.id]),
  omissions: [{ pointer: "/extensions/example:roundtrip", category: "unknown-extension", reason: "Not approved for public export" }],
  redactions: [],
  attribution: known("MASA protocol example"),
  license: known("MIT for protocol fixture metadata; no media is included"),
  retention: known("Retain while protocol 0.1.0 remains supported"),
  correctionUrl: `${CANONICAL_ROOT}corrections`,
  revocationUrl: `${CANONICAL_ROOT}revocations`,
  approvedExtensionNamespaces: []
};
publication.history = {
  mode: "embedded",
  events: [
    receipt(publication, {
      id: "urn:uuid:00000000-0000-4000-8000-000000000a01",
      operationType: "matter.publish",
      effectClass: "publish",
      inputs: [],
      outputs: [publication.id],
      tool: tool("urn:uuid:00000000-0000-4000-8000-000000000a02", "Human-reviewed public fixture", "human-procedure"),
      parameters: { projection: "allowlist", assetsIncluded: false },
      policyEvaluation: policyEvaluation(publication, "publish", [publication.id]),
      reversibility: "irreversible"
    })
  ]
};

await save(validDirectory, "listening-analysis-audio.masa.json", listening);
await save(validDirectory, "transformation.masa.json", transformation);
await save(validDirectory, "generation.masa.json", generation);
await save(validDirectory, "processing.masa.json", processing);
await save(validDirectory, "mapping.masa.json", mapping);
await save(validDirectory, "agent.masa.json", agent);
await save(validDirectory, "publication.masa.json", publication);

const deletedState = clone();
retarget(deletedState, "urn:uuid:00000000-0000-4000-8000-000000000008");
deletedState.title = "Explicitly deleted representation state";
const deletionReceiptId = "urn:uuid:00000000-0000-4000-8000-000000000c01";
const deletedValue = {
  state: "deleted",
  reason: "The local fixture models an authorized deletion without retaining removed values.",
  receiptRefs: [deletionReceiptId]
};
deletedState.representations[0].role = "tombstone";
deletedState.representations[0].availability = "deleted";
deletedState.representations[0].format = deletedValue;
deletedState.representations[0].locator = deletedValue;
deletedState.representations[0].integrity = deletedValue;
deletedState.policies[0].rules[0].actions.push("delete");
deletedState.policies[0].rules[0].targets.push(deletedState.representations[0].id);
deletedState.history = {
  mode: "embedded",
  events: [
    receipt(deletedState, {
      id: deletionReceiptId,
      operationType: "matter.delete",
      effectClass: "delete",
      inputs: [deletedState.representations[0].id],
      outputs: [],
      tool: tool("urn:uuid:00000000-0000-4000-8000-000000000c02", "Authorized deletion fixture", "human-procedure"),
      parameters: { retained: "tombstone only" },
      policyEvaluation: policyEvaluation(deletedState, "delete", [deletedState.representations[0].id]),
      reversibility: "irreversible"
    })
  ]
};
await save(validDirectory, "deleted-state.masa.json", deletedState);

const bundleDirectory = join(root, "examples", "0.1.0", "bundles", "transformation.masa");
const bundleRecord = structuredClone(transformation) as JsonObject;
const bundledReceipt = bundleRecord.history.events[0] as JsonObject;
bundleRecord.history = { mode: "external", href: "events.ndjson", eventIds: [bundledReceipt.id] };
const recordPath = "records/transformation.masa.json";
const recordText = `${JSON.stringify(bundleRecord, null, 2)}\n`;
const eventText = `${JSON.stringify(bundledReceipt)}\n`;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
await mkdir(join(bundleDirectory, "records"), { recursive: true });
await writeIfChanged(join(bundleDirectory, recordPath), recordText);
await writeIfChanged(join(bundleDirectory, "events.ndjson"), eventText);
const bundleManifest = {
  manifestType: "masa-bundle",
  manifestVersion: "0.1.0",
  masaVersion: "0.1.0",
  id: "urn:uuid:00000000-0000-4000-8000-000000000b01",
  createdAt: "2026-07-27T12:11:00Z",
  createdBy: actorId,
  disclosure: "private",
  profiles: transformation.profiles,
  records: [{ id: bundleRecord.id, path: recordPath }],
  files: [
    {
      path: "events.ndjson",
      role: "event-log",
      mediaType: "application/x-ndjson",
      byteLength: Buffer.byteLength(eventText),
      sha256: hash(eventText),
      disclosure: "private"
    },
    {
      path: recordPath,
      role: "record",
      mediaType: "application/vnd.sonicfield.masa.record+json",
      byteLength: Buffer.byteLength(recordText),
      sha256: hash(recordText),
      disclosure: "private",
      recordRef: bundleRecord.id
    }
  ],
  externalReferences: [],
  omissions: [{ category: "media", reason: "No audio bytes are required for this structural lineage fixture." }],
  extensions: {}
};
await writeIfChanged(join(bundleDirectory, "manifest.json"), `${JSON.stringify(bundleManifest, null, 2)}\n`);

const missingUnit = structuredClone(listening) as JsonObject;
delete missingUnit.measurements[0].unit;
await save(invalidDirectory, "measurement-missing-unit.masa.json", missingUnit);

const dangling = clone();
dangling.representations[0].policyRefs = ["urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff"];
await save(invalidDirectory, "dangling-reference.masa.json", dangling);

const cycle = structuredClone(transformation) as JsonObject;
cycle.relations.push({
  ...structuredClone(cycle.relations[0]),
  id: "urn:uuid:00000000-0000-4000-8000-000000000606",
  subject: cycle.representations[0].id,
  object: cycle.representations[1].id
});
await save(invalidDirectory, "derivation-cycle.masa.json", cycle);

const failedOutput = structuredClone(transformation) as JsonObject;
failedOutput.history.events[0].finalStatus = "failed";
failedOutput.history.events[0].errors = ["Fixture failure"];
await save(invalidDirectory, "failed-operation-with-output.masa.json", failedOutput);

const profileMismatch = clone();
profileMismatch.profiles.push("audio");
await save(invalidDirectory, "profile-mismatch.masa.json", profileMismatch);

const duplicateId = clone();
duplicateId.representations[0].id = duplicateId.actors[0].id;
await save(invalidDirectory, "duplicate-id.masa.json", duplicateId);

const privatePublic = structuredClone(publication) as JsonObject;
privatePublic.actors[0].disclosure = "private";
await save(invalidDirectory, "public-private-actor.masa.json", privatePublic);

const localPath = structuredClone(publication) as JsonObject;
localPath.representations[0].locator = known("/Users/example/private/audio.wav");
await save(invalidDirectory, "public-local-path.masa.json", localPath);

const knownNull = clone();
knownNull.representations[0].format = { state: "known", value: null };
await save(invalidDirectory, "known-null-qualified-value.masa.json", knownNull);

const processingMissingLineage = structuredClone(processing) as JsonObject;
processingMissingLineage.relations = [];
await save(invalidDirectory, "processing-missing-parent-relation.masa.json", processingMissingLineage);

process.stdout.write("MASA examples generated deterministically.\n");
