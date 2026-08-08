import type { MatterRecord, OperationReceipt } from "./generated/index.js";
import { asJsonArray, isJsonObject, readString } from "./traversal.js";

export const RECORD_ENTITY_COLLECTIONS = [
  "actors",
  "sources",
  "representations",
  "encounters",
  "apertures",
  "listeningPasses",
  "claims",
  "measurements",
  "regions",
  "observations",
  "mappings",
  "relations",
  "policies",
  "contexts",
  "agentRuns",
  "capabilities",
] as const;

export type RecordEntityCollection = (typeof RECORD_ENTITY_COLLECTIONS)[number];

export interface IndexedEntity {
  id: string;
  type?: string;
  collection: RecordEntityCollection | "events" | "policyRules" | "record";
  instancePath: string;
  value: Record<string, unknown>;
}

export interface DuplicateIdentity {
  id: string;
  firstPath: string;
  duplicatePath: string;
}

export interface RecordIndex {
  byId: ReadonlyMap<string, IndexedEntity>;
  duplicates: readonly DuplicateIdentity[];
  eventsById: ReadonlyMap<string, OperationReceipt>;
  relationsBySubject: ReadonlyMap<string, readonly Record<string, unknown>[]>;
  relationsByObject: ReadonlyMap<string, readonly Record<string, unknown>[]>;
}

/** Build identity and relation indexes without mutating or normalizing a record. */
export function indexRecord(record: MatterRecord): RecordIndex {
  const byId = new Map<string, IndexedEntity>();
  const duplicates: DuplicateIdentity[] = [];
  const eventsById = new Map<string, OperationReceipt>();
  const relationsBySubjectMutable = new Map<string, Record<string, unknown>[]>();
  const relationsByObjectMutable = new Map<string, Record<string, unknown>[]>();
  const rawRecord = record as unknown as Record<string, unknown>;

  function add(value: unknown, collection: IndexedEntity["collection"], instancePath: string): void {
    if (!isJsonObject(value)) {
      return;
    }
    const id = readString(value, "id");
    if (id === undefined) {
      return;
    }
    const existing = byId.get(id);
    if (existing !== undefined) {
      duplicates.push({ id, firstPath: existing.instancePath, duplicatePath: instancePath });
      return;
    }
    const type = readString(value, "type");
    byId.set(id, {
      id,
      ...(type === undefined ? {} : { type }),
      collection,
      instancePath,
      value,
    });
  }

  add(rawRecord, "record", "");
  for (const collection of RECORD_ENTITY_COLLECTIONS) {
    asJsonArray(rawRecord[collection]).forEach((value, index) => {
      add(value, collection, `/${collection}/${index}`);
    });
  }

  asJsonArray(rawRecord.policies).forEach((policy, policyIndex) => {
    if (!isJsonObject(policy)) {
      return;
    }
    asJsonArray(policy.rules).forEach((rule, ruleIndex) => {
      add(rule, "policyRules", `/policies/${policyIndex}/rules/${ruleIndex}`);
    });
  });

  const history = rawRecord.history;
  if (isJsonObject(history) && history.mode === "embedded") {
    asJsonArray(history.events).forEach((value, index) => {
      add(value, "events", `/history/events/${index}`);
      if (isJsonObject(value)) {
        const id = readString(value, "id");
        if (id !== undefined && byId.get(id)?.instancePath === `/history/events/${index}`) {
          eventsById.set(id, value as unknown as OperationReceipt);
        }
      }
    });
  }

  asJsonArray(rawRecord.relations).forEach((value) => {
    if (!isJsonObject(value)) {
      return;
    }
    const subject = readString(value, "subject");
    const object = readString(value, "object");
    if (subject !== undefined) {
      const relations = relationsBySubjectMutable.get(subject) ?? [];
      relations.push(value);
      relationsBySubjectMutable.set(subject, relations);
    }
    if (object !== undefined) {
      const relations = relationsByObjectMutable.get(object) ?? [];
      relations.push(value);
      relationsByObjectMutable.set(object, relations);
    }
  });

  return {
    byId,
    duplicates,
    eventsById,
    relationsBySubject: relationsBySubjectMutable,
    relationsByObject: relationsByObjectMutable,
  };
}

export interface RecordSummary {
  id: string;
  masaVersion: string;
  revision: number;
  profiles: readonly string[];
  disclosure: string;
  entityCounts: Readonly<Record<RecordEntityCollection | "events", number>>;
  duplicateIds: number;
}

export function summarizeRecord(record: MatterRecord): RecordSummary {
  const rawRecord = record as unknown as Record<string, unknown>;
  const index = indexRecord(record);
  const counts = Object.create(null) as Record<RecordEntityCollection | "events", number>;
  for (const collection of RECORD_ENTITY_COLLECTIONS) {
    counts[collection] = asJsonArray(rawRecord[collection]).length;
  }
  const history = rawRecord.history;
  counts.events = isJsonObject(history) && history.mode === "embedded"
    ? asJsonArray(history.events).length
    : index.eventsById.size;

  return {
    id: readString(rawRecord, "id") ?? "",
    masaVersion: readString(rawRecord, "masaVersion") ?? "",
    revision: typeof rawRecord.revision === "number" ? rawRecord.revision : 0,
    profiles: asJsonArray(rawRecord.profiles).filter(
      (value): value is string => typeof value === "string",
    ),
    disclosure: readString(rawRecord, "disclosure") ?? "",
    entityCounts: counts,
    duplicateIds: index.duplicates.length,
  };
}
