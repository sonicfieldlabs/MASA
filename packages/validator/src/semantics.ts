import type { Diagnostic, IndexedEntity, MatterRecord, OperationReceipt } from "@sonicfield/masa";
import {
  acyclicRelationOrientations,
  asJsonArray,
  indexRecord,
  isJsonObject,
  lineageRelationDirections,
  readString,
  readStringArray,
  sortDiagnostics,
  walkJson,
} from "@sonicfield/masa";

import { diagnostic } from "./diagnostic.js";

const PROCESSING_OPERATIONS = new Set([
  "matter.granulate",
  "matter.extract",
  "matter.reduce",
  "matter.fragment",
  "matter.timestretch",
  "matter.pitchshift",
]);

const CONSEQUENTIAL_EFFECTS = new Set([
  "delete",
  "derive",
  "expire",
  "external-action",
  "generate",
  "map",
  "perform",
  "publish",
  "remember",
  "render",
  "transform",
  "withhold",
]);

export function auditMatterRecordSemantics(record: MatterRecord): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const raw = record as unknown as Record<string, unknown>;
  const index = indexRecord(record);
  const knownIds = new Set(index.byId.keys());

  if (isJsonObject(raw.history) && raw.history.mode === "external") {
    for (const eventId of readStringArray(raw.history, "eventIds")) {
      knownIds.add(eventId);
    }
  }

  for (const duplicate of index.duplicates) {
    diagnostics.push(
      diagnostic(
        "MASA_DUPLICATE_ID",
        duplicate.duplicatePath,
        "An identifier is reused by more than one local entity",
        "Assign a new globally unique identifier and update only the references to that entity",
      ),
    );
  }

  const unresolved = (ref: unknown, instancePath: string, external = false): void => {
    if (typeof ref !== "string" || external || knownIds.has(ref)) {
      return;
    }
    diagnostics.push(
      diagnostic(
        "MASA_UNRESOLVED_REF",
        instancePath,
        "A required local reference does not resolve inside the record history",
        "Include the referenced entity or represent the reference through an explicit external, withheld, unavailable, or deleted state",
      ),
    );
  };

  unresolved(raw.createdBy, "/createdBy");
  auditRecordReferences(raw, unresolved);
  diagnostics.push(...auditReferenceTypes(raw, index.byId));
  diagnostics.push(...auditQualifiedStates(raw, unresolved));
  diagnostics.push(...auditTemporalSemantics(raw));
  diagnostics.push(...auditEventHistory(raw, knownIds));
  diagnostics.push(...auditDerivationGraph(raw));
  diagnostics.push(...auditDescendantReceipts(raw, index.eventsById, knownIds));

  if (
    isJsonObject(raw.publication) &&
    (raw.disclosure === "public" || asJsonArray(raw.profiles).includes("publication"))
  ) {
    const publicRecordId = readString(raw.publication, "publicRecordId");
    if (publicRecordId !== undefined && publicRecordId !== readString(raw, "id")) {
      diagnostics.push(
        diagnostic(
          "MASA_PUBLIC_DISCLOSURE",
          "/publication/publicRecordId",
          "Publication identity does not match the public record",
          "Use the public projection identifier in both fields",
        ),
      );
    }
  }

  return sortDiagnostics(diagnostics);
}

export function auditEventReceiptSemantics(receipt: OperationReceipt): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const raw = receipt as unknown as Record<string, unknown>;
  const startedAt = readString(raw, "startedAt");
  const endedAt = readString(raw, "endedAt");
  if (startedAt !== undefined && endedAt !== undefined && Date.parse(endedAt) < Date.parse(startedAt)) {
    diagnostics.push(
      diagnostic(
        "MASA_EVENT_SEQUENCE",
        "/endedAt",
        "An operation ends before it starts",
        "Correct the timestamps while preserving the original receipt as superseded evidence when already committed",
      ),
    );
  }

  const inputs = new Set(readStringArray(raw, "inputs"));
  const outputs = readStringArray(raw, "outputs");
  const effectClass = readString(raw, "effectClass");
  if (effectClass !== undefined && CONSEQUENTIAL_EFFECTS.has(effectClass)) {
    for (let index = 0; index < outputs.length; index += 1) {
      if (inputs.has(outputs[index] ?? "")) {
        diagnostics.push(
          diagnostic(
            "MASA_DESCENDANT_REUSES_INPUT",
            `/outputs/${index}`,
            "A consequential operation reuses an input identifier as an output",
            "Create a new descendant identifier and relate it to the preserved input",
          ),
        );
      }
    }
  }

  if (
    readString(raw, "finalStatus") === "completed" &&
    effectClass !== undefined &&
    CONSEQUENTIAL_EFFECTS.has(effectClass)
  ) {
    const evaluation = raw.policyEvaluation;
    const result = isJsonObject(evaluation) ? readString(evaluation, "result") : undefined;
    if (result !== "permitted" && result !== "required") {
      diagnostics.push(
        diagnostic(
          "MASA_POLICY_DENIED",
          "/policyEvaluation/result",
          "A completed consequential operation lacks an authorizing policy result",
          "Refuse the operation or attach an attributable permitted policy evaluation before performing it",
        ),
      );
    }
  }

  return sortDiagnostics(diagnostics);
}

function auditRecordReferences(
  record: Record<string, unknown>,
  unresolved: (ref: unknown, instancePath: string, external?: boolean) => void,
): void {
  function arrayRefs(value: unknown, key: string, basePath: string): void {
    readStringArray(value, key).forEach((ref, index) => unresolved(ref, `${basePath}/${key}/${index}`));
  }

  asJsonArray(record.actors).forEach((actor, index) => {
    arrayRefs(actor, "authorityRefs", `/actors/${index}`);
  });
  asJsonArray(record.sources).forEach((source, index) => {
    arrayRefs(source, "policyRefs", `/sources/${index}`);
    arrayRefs(source, "causalClaimRefs", `/sources/${index}`);
  });
  asJsonArray(record.representations).forEach((representation, index) => {
    arrayRefs(representation, "policyRefs", `/representations/${index}`);
  });
  asJsonArray(record.encounters).forEach((encounter, index) => {
    arrayRefs(encounter, "actors", `/encounters/${index}`);
    arrayRefs(encounter, "contextRefs", `/encounters/${index}`);
  });
  asJsonArray(record.listeningPasses).forEach((pass, index) => {
    arrayRefs(pass, "actors", `/listeningPasses/${index}`);
    arrayRefs(pass, "representations", `/listeningPasses/${index}`);
    unresolved(readString(pass, "encounterRef"), `/listeningPasses/${index}/encounterRef`);
    unresolved(readString(pass, "apertureRef"), `/listeningPasses/${index}/apertureRef`);
    arrayRefs(pass, "claimRefs", `/listeningPasses/${index}`);
  });
  asJsonArray(record.claims).forEach((claim, index) => {
    arrayRefs(claim, "about", `/claims/${index}`);
    unresolved(readString(claim, "actor"), `/claims/${index}/actor`);
    unresolved(readString(claim, "listeningPassRef"), `/claims/${index}/listeningPassRef`);
    arrayRefs(claim, "alternativeClaimRefs", `/claims/${index}`);
    auditEvidenceRefs(claim, "basis", `/claims/${index}`, unresolved);
    auditMethodRefs(claim, "/claims/" + index, unresolved);
  });
  asJsonArray(record.measurements).forEach((measurement, index) => {
    unresolved(readString(measurement, "about"), `/measurements/${index}/about`);
    unresolved(readString(measurement, "actor"), `/measurements/${index}/actor`);
    unresolved(readString(measurement, "claimRef"), `/measurements/${index}/claimRef`);
    auditMethodRefs(measurement, `/measurements/${index}`, unresolved);
  });
  asJsonArray(record.regions).forEach((region, index) => {
    unresolved(readString(region, "representationRef"), `/regions/${index}/representationRef`);
    unresolved(readString(region, "createdBy"), `/regions/${index}/createdBy`);
    auditMethodRefs(region, `/regions/${index}`, unresolved);
  });
  asJsonArray(record.observations).forEach((observation, index) => {
    unresolved(readString(observation, "sourceRef"), `/observations/${index}/sourceRef`);
    unresolved(readString(observation, "claimRef"), `/observations/${index}/claimRef`);
    auditMethodRefs(observation, `/observations/${index}`, unresolved);
  });
  asJsonArray(record.mappings).forEach((mapping, index) => {
    arrayRefs(mapping, "sourceObservationRefs", `/mappings/${index}`);
    arrayRefs(mapping, "actors", `/mappings/${index}`);
  });
  asJsonArray(record.relations).forEach((relation, index) => {
    unresolved(readString(relation, "subject"), `/relations/${index}/subject`);
    unresolved(readString(relation, "object"), `/relations/${index}/object`);
    unresolved(readString(relation, "assertedBy"), `/relations/${index}/assertedBy`);
    unresolved(readString(relation, "operationRef"), `/relations/${index}/operationRef`);
    auditEvidenceRefs(relation, "basis", `/relations/${index}`, unresolved);
  });
  asJsonArray(record.policies).forEach((policy, policyIndex) => {
    unresolved(readString(policy, "issuer"), `/policies/${policyIndex}/issuer`);
    asJsonArray(isJsonObject(policy) ? policy.rules : undefined).forEach((rule, ruleIndex) => {
      arrayRefs(rule, "targets", `/policies/${policyIndex}/rules/${ruleIndex}`);
      arrayRefs(rule, "subjects", `/policies/${policyIndex}/rules/${ruleIndex}`);
    });
  });
  asJsonArray(record.agentRuns).forEach((run, index) => {
    unresolved(readString(run, "actorRef"), `/agentRuns/${index}/actorRef`);
    arrayRefs(run, "capabilityRefs", `/agentRuns/${index}`);
    arrayRefs(run, "memoryRefs", `/agentRuns/${index}`);
    arrayRefs(run, "authorityRefs", `/agentRuns/${index}`);
    arrayRefs(run, "operationRefs", `/agentRuns/${index}`);
  });

  if (isJsonObject(record.history) && record.history.mode === "embedded") {
    asJsonArray(record.history.events).forEach((event, eventIndex) => {
      if (!isJsonObject(event) || !isJsonObject(event.parameters)) return;
      if (event.effectClass === "generate") {
        for (const key of ["parentRefs", "conditioningRefs", "regionRefs", "rejectedOutputRefs"] as const) {
          arrayRefs(event.parameters, key, `/history/events/${eventIndex}/parameters`);
        }
      }
      if (typeof event.operationType === "string" && PROCESSING_OPERATIONS.has(event.operationType)) {
        arrayRefs(event.parameters, "regionRefs", `/history/events/${eventIndex}/parameters`);
        if (isJsonObject(event.parameters.selection)) {
          arrayRefs(event.parameters.selection, "regionRefs", `/history/events/${eventIndex}/parameters/selection`);
        }
      }
    });
  }

  if (isJsonObject(record.publication)) {
    unresolved(readString(record.publication, "approvedBy"), "/publication/approvedBy");
    auditPolicyEvaluation(record.publication.policyEvaluation, "/publication/policyEvaluation", unresolved);
  }
}

function auditReferenceTypes(
  record: Record<string, unknown>,
  byId: ReadonlyMap<string, IndexedEntity>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  type Collection = IndexedEntity["collection"];
  const expect = (
    ref: unknown,
    path: string,
    collections: readonly Collection[],
  ): void => {
    if (typeof ref !== "string") return;
    const entity = byId.get(ref);
    if (entity === undefined || collections.includes(entity.collection)) return;
    diagnostics.push(
      diagnostic(
        "MASA_REF_TYPE",
        path,
        "A reference resolves to an entity of the wrong protocol kind",
        `Reference an entity from: ${collections.join(", ")}.`,
      ),
    );
  };
  const expectArray = (
    value: unknown,
    key: string,
    path: string,
    collections: readonly Collection[],
  ): void => {
    readStringArray(value, key).forEach((ref, index) =>
      expect(ref, `${path}/${key}/${index}`, collections),
    );
  };

  expect(record.createdBy, "/createdBy", ["actors"]);
  asJsonArray(record.actors).forEach((actor, index) => {
    expectArray(actor, "authorityRefs", `/actors/${index}`, ["actors", "policies", "policyRules"]);
  });
  asJsonArray(record.sources).forEach((source, index) => {
    expectArray(source, "policyRefs", `/sources/${index}`, ["policies"]);
    expectArray(source, "causalClaimRefs", `/sources/${index}`, ["claims"]);
  });
  asJsonArray(record.representations).forEach((representation, index) => {
    expectArray(representation, "policyRefs", `/representations/${index}`, ["policies"]);
  });
  asJsonArray(record.encounters).forEach((encounter, index) => {
    expectArray(encounter, "actors", `/encounters/${index}`, ["actors"]);
    expectArray(encounter, "contextRefs", `/encounters/${index}`, ["contexts"]);
  });
  asJsonArray(record.listeningPasses).forEach((pass, index) => {
    expectArray(pass, "actors", `/listeningPasses/${index}`, ["actors"]);
    expectArray(pass, "representations", `/listeningPasses/${index}`, ["representations"]);
    expect(readString(pass, "encounterRef"), `/listeningPasses/${index}/encounterRef`, ["encounters"]);
    expect(readString(pass, "apertureRef"), `/listeningPasses/${index}/apertureRef`, ["apertures"]);
    expectArray(pass, "claimRefs", `/listeningPasses/${index}`, ["claims"]);
  });
  asJsonArray(record.claims).forEach((claim, index) => {
    expect(readString(claim, "actor"), `/claims/${index}/actor`, ["actors"]);
    expect(readString(claim, "listeningPassRef"), `/claims/${index}/listeningPassRef`, ["listeningPasses"]);
    expectArray(claim, "alternativeClaimRefs", `/claims/${index}`, ["claims"]);
    auditEvidenceReferenceTypes(claim, "basis", `/claims/${index}`, expect);
  });
  asJsonArray(record.measurements).forEach((measurement, index) => {
    expect(readString(measurement, "actor"), `/measurements/${index}/actor`, ["actors"]);
    expect(readString(measurement, "claimRef"), `/measurements/${index}/claimRef`, ["claims"]);
  });
  asJsonArray(record.regions).forEach((region, index) => {
    expect(readString(region, "representationRef"), `/regions/${index}/representationRef`, ["representations"]);
    expect(readString(region, "createdBy"), `/regions/${index}/createdBy`, ["actors"]);
  });
  asJsonArray(record.observations).forEach((observation, index) => {
    expect(readString(observation, "sourceRef"), `/observations/${index}/sourceRef`, ["sources"]);
    expect(readString(observation, "claimRef"), `/observations/${index}/claimRef`, ["claims"]);
  });
  asJsonArray(record.mappings).forEach((mapping, index) => {
    expectArray(mapping, "sourceObservationRefs", `/mappings/${index}`, ["observations"]);
    expectArray(mapping, "actors", `/mappings/${index}`, ["actors"]);
  });
  asJsonArray(record.relations).forEach((relation, index) => {
    expect(readString(relation, "assertedBy"), `/relations/${index}/assertedBy`, ["actors"]);
    expect(readString(relation, "operationRef"), `/relations/${index}/operationRef`, ["events"]);
    auditEvidenceReferenceTypes(relation, "basis", `/relations/${index}`, expect);
  });
  asJsonArray(record.policies).forEach((policy, policyIndex) => {
    expect(readString(policy, "issuer"), `/policies/${policyIndex}/issuer`, ["actors"]);
    asJsonArray(isJsonObject(policy) ? policy.rules : undefined).forEach((rule, ruleIndex) => {
      expectArray(rule, "subjects", `/policies/${policyIndex}/rules/${ruleIndex}`, ["actors"]);
    });
  });
  asJsonArray(record.agentRuns).forEach((run, index) => {
    expect(readString(run, "actorRef"), `/agentRuns/${index}/actorRef`, ["actors"]);
    expectArray(run, "capabilityRefs", `/agentRuns/${index}`, ["capabilities"]);
    expectArray(run, "operationRefs", `/agentRuns/${index}`, ["events"]);
  });
  if (isJsonObject(record.publication)) {
    expect(readString(record.publication, "approvedBy"), "/publication/approvedBy", ["actors"]);
    auditPolicyEvaluationTypes(record.publication.policyEvaluation, "/publication/policyEvaluation", expect);
  }
  if (isJsonObject(record.history) && record.history.mode === "embedded") {
    asJsonArray(record.history.events).forEach((event, index) => {
      expectArray(event, "actors", `/history/events/${index}`, ["actors"]);
      expectArray(event, "claimRefs", `/history/events/${index}`, ["claims"]);
      if (isJsonObject(event)) {
        auditPolicyEvaluationTypes(event.policyEvaluation, `/history/events/${index}/policyEvaluation`, expect);
        if (
          typeof event.operationType === "string" &&
          PROCESSING_OPERATIONS.has(event.operationType) &&
          isJsonObject(event.parameters)
        ) {
          expectArray(event.parameters, "regionRefs", `/history/events/${index}/parameters`, ["regions"]);
          if (isJsonObject(event.parameters.selection)) {
            expectArray(event.parameters.selection, "regionRefs", `/history/events/${index}/parameters/selection`, ["regions"]);
          }
        }
      }
    });
  }
  return sortDiagnostics(diagnostics);
}

function auditEvidenceReferenceTypes(
  value: unknown,
  key: string,
  basePath: string,
  expect: (ref: unknown, path: string, collections: readonly IndexedEntity["collection"][]) => void,
): void {
  if (!isJsonObject(value)) return;
  const collectionsByRole: Readonly<Record<string, readonly IndexedEntity["collection"][]>> = {
    source: ["sources"],
    representation: ["representations"],
    claim: ["claims"],
    measurement: ["measurements"],
    observation: ["observations"],
    context: ["contexts"],
    operation: ["events"],
  };
  asJsonArray(value[key]).forEach((item, index) => {
    const role = readString(item, "role");
    const collections = role === undefined ? undefined : collectionsByRole[role];
    if (collections !== undefined) {
      expect(readString(item, "ref"), `${basePath}/${key}/${index}/ref`, collections);
    }
  });
}

function auditPolicyEvaluationTypes(
  value: unknown,
  basePath: string,
  expect: (ref: unknown, path: string, collections: readonly IndexedEntity["collection"][]) => void,
): void {
  if (!isJsonObject(value)) return;
  readStringArray(value, "policyRefs").forEach((ref, index) =>
    expect(ref, `${basePath}/policyRefs/${index}`, ["policies"]),
  );
  readStringArray(value, "authorityRefs").forEach((ref, index) =>
    expect(ref, `${basePath}/authorityRefs/${index}`, ["actors", "policies", "policyRules"]),
  );
  expect(readString(value, "evaluator"), `${basePath}/evaluator`, ["actors"]);
}

function auditQualifiedStates(
  record: Record<string, unknown>,
  unresolved: (ref: unknown, instancePath: string, external?: boolean) => void,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walkJson(record, ({ value, instancePath }) => {
    if (!isJsonObject(value) || instancePath.includes("/extensions/")) return;
    if (value.state === "withheld") {
      readStringArray(value, "policyRefs").forEach((ref, index) =>
        unresolved(ref, `${instancePath}/policyRefs/${index}`),
      );
    }
    if (value.state === "deleted") {
      readStringArray(value, "receiptRefs").forEach((ref, index) =>
        unresolved(ref, `${instancePath}/receiptRefs/${index}`),
      );
    }
    if (
      instancePath.endsWith("/health") &&
      ["degraded", "error", "unavailable", "unknown"].includes(readString(value, "status") ?? "") &&
      readString(value, "reason") === undefined
    ) {
      diagnostics.push(
        diagnostic(
          "MASA_STATE_REASON_MISSING",
          instancePath,
          "A non-healthy source state has no explanatory reason",
          "Add a concise reason without exposing protected values.",
          "warning",
        ),
      );
    }
    if (
      instancePath.endsWith("/freshness") &&
      readString(value, "status") === "unknown" &&
      readString(value, "reason") === undefined
    ) {
      diagnostics.push(
        diagnostic(
          "MASA_STATE_REASON_MISSING",
          instancePath,
          "Unknown freshness has no explanatory reason",
          "Add a concise reason distinguishing unknown time from stale or unavailable data.",
          "warning",
        ),
      );
    }
  });
  return sortDiagnostics(diagnostics);
}

function auditTemporalSemantics(record: Record<string, unknown>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const order = (first: unknown, second: unknown, path: string, message: string): void => {
    if (typeof first !== "string" || typeof second !== "string") return;
    const firstMs = Date.parse(first);
    const secondMs = Date.parse(second);
    // Schema-valid RFC 3339 values that Date.parse cannot represent (such as
    // leap seconds) skip the ordering check instead of failing it.
    if (Number.isNaN(firstMs) || Number.isNaN(secondMs)) return;
    if (secondMs >= firstMs) return;
    diagnostics.push(
      diagnostic(
        "MASA_TEMPORAL_ORDER",
        path,
        message,
        "Correct the temporal order while preserving any previously committed account as superseded evidence.",
      ),
    );
  };
  const window = (value: unknown, path: string): void => {
    if (!isJsonObject(value) || typeof value.start !== "number" || typeof value.end !== "number") return;
    if (value.end >= value.start) return;
    diagnostics.push(
      diagnostic(
        "MASA_WINDOW_ORDER",
        `${path}/end`,
        "A bounded window ends before it starts",
        "Use an ordered interval; represent reversed mapping direction in the mapping curve or range instead.",
      ),
    );
  };
  const freshness = (value: unknown, path: string): void => {
    if (!isJsonObject(value)) return;
    order(value.observedAt, value.retrievedAt, `${path}/retrievedAt`, "Freshness retrieval precedes observation");
    order(value.retrievedAt, value.expiresAt, `${path}/expiresAt`, "Freshness expiry precedes retrieval");
  };

  asJsonArray(record.sources).forEach((source, index) => {
    if (isJsonObject(source)) freshness(source.freshness, `/sources/${index}/freshness`);
  });
  asJsonArray(record.observations).forEach((observation, index) => {
    if (isJsonObject(observation)) freshness(observation.freshness, `/observations/${index}/freshness`);
  });
  asJsonArray(record.apertures).forEach((aperture, index) => {
    if (!isJsonObject(aperture)) return;
    asJsonArray(aperture.ranges).forEach((item, itemIndex) => window(item, `/apertures/${index}/ranges/${itemIndex}`));
    asJsonArray(aperture.windows).forEach((item, itemIndex) => window(item, `/apertures/${index}/windows/${itemIndex}`));
  });
  asJsonArray(record.claims).forEach((claim, index) => {
    if (isJsonObject(claim)) window(claim.window, `/claims/${index}/window`);
  });
  asJsonArray(record.measurements).forEach((measurement, index) => {
    if (isJsonObject(measurement)) window(measurement.window, `/measurements/${index}/window`);
  });
  asJsonArray(record.policies).forEach((policy, index) => {
    if (isJsonObject(policy)) {
      order(policy.validFrom, policy.validUntil, `/policies/${index}/validUntil`, "Policy validity ends before it begins");
    }
  });
  return sortDiagnostics(diagnostics);
}

function auditEventHistory(record: Record<string, unknown>, knownIds: ReadonlySet<string>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isJsonObject(record.history) || record.history.mode !== "embedded") {
    return diagnostics;
  }

  let previousSequence = -1;
  const seenSequences = new Set<number>();
  asJsonArray(record.history.events).forEach((event, index) => {
    if (!isJsonObject(event)) {
      return;
    }
    const sequence = event.sequence;
    if (
      typeof sequence !== "number" ||
      !Number.isInteger(sequence) ||
      seenSequences.has(sequence) ||
      sequence <= previousSequence
    ) {
      diagnostics.push(
        diagnostic(
          "MASA_EVENT_SEQUENCE",
          `/history/events/${index}/sequence`,
          "Embedded event sequence numbers are duplicated or non-monotonic",
          "Assign unique increasing local sequence numbers while preserving event identifiers",
        ),
      );
    }
    if (typeof sequence === "number") {
      seenSequences.add(sequence);
      previousSequence = Math.max(previousSequence, sequence);
    }
    if (event.recordId !== record.id) {
      diagnostics.push(
        diagnostic(
          "MASA_UNRESOLVED_REF",
          `/history/events/${index}/recordId`,
          "An embedded receipt identifies a different record",
          "Set the receipt recordId to the containing record identifier or move it to the correct history",
        ),
      );
    }
    diagnostics.push(...prefixDiagnostics(auditEventReceiptSemantics(event as unknown as OperationReceipt), `/history/events/${index}`));
    auditReceiptReferences(event, `/history/events/${index}`, knownIds, diagnostics);
  });
  return diagnostics;
}

function auditReceiptReferences(
  event: Record<string, unknown>,
  basePath: string,
  knownIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  const check = (ref: string, path: string): void => {
    if (!knownIds.has(ref)) {
      diagnostics.push(
        diagnostic(
          "MASA_UNRESOLVED_REF",
          path,
          "An operation receipt contains an unresolved local reference",
          "Include the referenced entity or use an explicitly external bundle reference",
        ),
      );
    }
  };
  for (const key of ["actors", "inputs", "outputs", "claimRefs"] as const) {
    readStringArray(event, key).forEach((ref, index) => check(ref, `${basePath}/${key}/${index}`));
  }
  auditPolicyEvaluation(event.policyEvaluation, `${basePath}/policyEvaluation`, (ref, path) => {
    if (typeof ref === "string") {
      check(ref, path);
    }
  });
}

function auditPolicyEvaluation(
  value: unknown,
  basePath: string,
  unresolved: (ref: unknown, instancePath: string) => void,
): void {
  if (!isJsonObject(value)) {
    return;
  }
  for (const key of ["targets", "policyRefs", "authorityRefs"] as const) {
    readStringArray(value, key).forEach((ref, index) => unresolved(ref, `${basePath}/${key}/${index}`));
  }
  unresolved(readString(value, "evaluator"), `${basePath}/evaluator`);
}

function auditEvidenceRefs(
  value: unknown,
  key: string,
  basePath: string,
  unresolved: (ref: unknown, instancePath: string, external?: boolean) => void,
): void {
  if (!isJsonObject(value)) {
    return;
  }
  asJsonArray(value[key]).forEach((evidence, index) => {
    unresolved(
      readString(evidence, "ref"),
      `${basePath}/${key}/${index}/ref`,
      readString(evidence, "role") === "external",
    );
  });
}

function auditMethodRefs(
  value: unknown,
  basePath: string,
  unresolved: (ref: unknown, instancePath: string) => void,
): void {
  if (!isJsonObject(value) || !isJsonObject(value.method)) {
    return;
  }
  readStringArray(value.method, "apparatusRefs").forEach((ref, index) =>
    unresolved(ref, `${basePath}/method/apparatusRefs/${index}`),
  );
}

function auditDerivationGraph(record: Record<string, unknown>): Diagnostic[] {
  const adjacency = new Map<string, Array<{ target: string; path: string }>>();
  asJsonArray(record.relations).forEach((relation, index) => {
    const predicate = readString(relation, "predicate");
    const subject = readString(relation, "subject");
    const object = readString(relation, "object");
    if (predicate === undefined || subject === undefined || object === undefined) {
      return;
    }
    const orientation = Object.hasOwn(acyclicRelationOrientations, predicate)
      ? acyclicRelationOrientations[predicate]
      : undefined;
    if (orientation === undefined) {
      return;
    }
    const origin = orientation.reverse ? object : subject;
    const target = orientation.reverse ? subject : object;
    const edges = adjacency.get(origin) ?? [];
    edges.push({ target, path: `/relations/${index}` });
    adjacency.set(origin, edges);
  });

  const diagnostics: Diagnostic[] = [];
  const active = new Set<string>();
  const complete = new Set<string>();
  // Iterative depth-first search: a hostile record can chain enough
  // relations that recursion would exhaust the call stack.
  const visit = (start: string): void => {
    if (complete.has(start)) {
      return;
    }
    const stack: Array<{ node: string; edgeIndex: number }> = [{ node: start, edgeIndex: 0 }];
    active.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const edges = adjacency.get(frame.node) ?? [];
      if (frame.edgeIndex < edges.length) {
        const edge = edges[frame.edgeIndex]!;
        frame.edgeIndex += 1;
        if (active.has(edge.target)) {
          diagnostics.push(
            diagnostic(
              "MASA_DERIVATION_CYCLE",
              edge.path,
              "An acyclic lineage relation closes a directed cycle",
              "Remove or reclassify the incorrect edge while preserving the conflicting assertion as a separate attributable account",
            ),
          );
        } else if (!complete.has(edge.target)) {
          active.add(edge.target);
          stack.push({ node: edge.target, edgeIndex: 0 });
        }
      } else {
        active.delete(frame.node);
        complete.add(frame.node);
        stack.pop();
      }
    }
  };

  for (const node of [...adjacency.keys()].sort()) {
    visit(node);
  }
  return diagnostics;
}

function auditDescendantReceipts(
  record: Record<string, unknown>,
  eventsById: ReadonlyMap<string, OperationReceipt>,
  knownIds: ReadonlySet<string>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const representationIds = new Set(
    asJsonArray(record.representations)
      .map((representation) => readString(representation, "id"))
      .filter((id): id is string => id !== undefined),
  );
  const descendantRelations = new Map<string, Record<string, unknown>[]>();

  asJsonArray(record.relations).forEach((relation, index) => {
    if (!isJsonObject(relation)) {
      return;
    }
    const predicate = readString(relation, "predicate") ?? "";
    const direction = Object.hasOwn(lineageRelationDirections, predicate)
      ? lineageRelationDirections[predicate]
      : undefined;
    if (direction === undefined) return;
    const subject = readString(relation, "subject");
    const object = readString(relation, "object");
    if (subject === undefined || object === undefined) {
      return;
    }
    const descendant = direction === "subject-is-descendant" ? subject : object;
    const parent = direction === "subject-is-descendant" ? object : subject;
    if (!representationIds.has(descendant)) return;
    const operationRef = readString(relation, "operationRef");
    if (operationRef === undefined || !knownIds.has(operationRef)) {
      diagnostics.push(
        diagnostic(
          "MASA_DESCENDANT_RECEIPT",
          `/relations/${index}/operationRef`,
          "A descendant representation lacks a resolvable generating operation",
          "Add the generating OperationReceipt and reference it from the lineage relation",
        ),
      );
    }
    if (descendant === parent) {
      diagnostics.push(
        diagnostic(
          "MASA_DESCENDANT_REUSES_INPUT",
          `/relations/${index}/subject`,
          "A descendant relation reuses the parent representation identifier",
          "Assign the descendant a new identifier and preserve the parent unchanged",
        ),
      );
    }
    const relations = descendantRelations.get(descendant) ?? [];
    relations.push(relation);
    descendantRelations.set(descendant, relations);
  });

  for (const [eventId, receipt] of eventsById) {
    const rawReceipt = receipt as unknown as Record<string, unknown>;
    const effect = readString(rawReceipt, "effectClass");
    if (effect === undefined || !CONSEQUENTIAL_EFFECTS.has(effect)) {
      continue;
    }
    const inputs = new Set(readStringArray(rawReceipt, "inputs"));
    for (const output of readStringArray(rawReceipt, "outputs")) {
      if (!representationIds.has(output)) {
        continue;
      }
      const linked = (descendantRelations.get(output) ?? []).some((relation) => {
        const predicate = readString(relation, "predicate") ?? "";
        const direction = Object.hasOwn(lineageRelationDirections, predicate)
          ? lineageRelationDirections[predicate]
          : undefined;
        const parent = direction === "subject-is-descendant"
          ? readString(relation, "object")
          : readString(relation, "subject");
        return readString(relation, "operationRef") === eventId && parent !== undefined && inputs.has(parent);
      });
      if (!linked) {
        diagnostics.push(
          diagnostic(
            "MASA_DESCENDANT_RECEIPT",
            indexPathForReceipt(record, eventId, "outputs"),
            "An operation output has no parent relation tied to its receipt",
            "Add a typed parent relation whose operationRef identifies this receipt",
          ),
        );
      }
    }
  }
  return diagnostics;
}

function indexPathForReceipt(record: Record<string, unknown>, eventId: string, suffix: string): string {
  if (!isJsonObject(record.history) || record.history.mode !== "embedded") {
    return `/history/${suffix}`;
  }
  const index = asJsonArray(record.history.events).findIndex((event) => readString(event, "id") === eventId);
  return index < 0 ? `/history/${suffix}` : `/history/events/${index}/${suffix}`;
}

function prefixDiagnostics(diagnostics: readonly Diagnostic[], prefix: string): Diagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    instancePath: `${prefix}${item.instancePath}`,
  }));
}
