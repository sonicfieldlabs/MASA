import type { MatterRecord } from "./generated/index.js";
import { lineageRelationDirections } from "./generated/ontology.js";
import { indexRecord, type IndexedEntity } from "./index-record.js";
import { asJsonArray, isJsonObject, readString } from "./traversal.js";

export type LineageDirection = "ancestors" | "descendants" | "both";

export interface LineageTraceOptions {
  /** Which causal direction to traverse. Defaults to both. */
  readonly direction?: LineageDirection;
  /** Maximum edge depth in either direction. Defaults to 16 and is capped at 64. */
  readonly maxDepth?: number;
}

export interface LineageTraceNode {
  readonly id: string;
  readonly depth: number;
  readonly type?: string;
  readonly collection?: IndexedEntity["collection"];
  readonly instancePath?: string;
}

export interface LineageTrace {
  readonly rootId: string;
  readonly direction: LineageDirection;
  readonly maxDepth: number;
  readonly truncated: boolean;
  readonly ancestors: readonly LineageTraceNode[];
  readonly descendants: readonly LineageTraceNode[];
  readonly relations: readonly Record<string, unknown>[];
}

export class LineageTraceError extends Error {
  readonly code: "MASA_LINEAGE_ENTITY_MISSING" | "MASA_LINEAGE_LIMIT_INVALID";

  constructor(code: LineageTraceError["code"], message: string) {
    super(message);
    this.name = "LineageTraceError";
    this.code = code;
  }
}

interface Edge {
  readonly parent: string;
  readonly child: string;
  readonly relation: Record<string, unknown>;
  readonly relationPath: string;
}

const DEFAULT_MAX_DEPTH = 16;
const MAX_MAX_DEPTH = 64;

/**
 * Traverse only relations whose versioned registry entry declares which side
 * is the descendant. Unknown extension relations remain preserved but are not
 * guessed into a causal direction.
 */
export function traceLineage(
  record: MatterRecord,
  rootId: string,
  options: LineageTraceOptions = {},
): LineageTrace {
  const direction = options.direction ?? "both";
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_MAX_DEPTH) {
    throw new LineageTraceError(
      "MASA_LINEAGE_LIMIT_INVALID",
      `Lineage maxDepth must be an integer between 1 and ${MAX_MAX_DEPTH}.`,
    );
  }

  const index = indexRecord(record);
  if (!index.byId.has(rootId)) {
    throw new LineageTraceError(
      "MASA_LINEAGE_ENTITY_MISSING",
      "The requested lineage entity does not exist in this record.",
    );
  }

  const edges = lineageEdges(record);
  const parentsByChild = groupEdges(edges, "child");
  const childrenByParent = groupEdges(edges, "parent");
  const relations = new Map<string, Record<string, unknown>>();
  let truncated = false;

  const traverse = (mode: "ancestors" | "descendants"): LineageTraceNode[] => {
    const nodes: LineageTraceNode[] = [];
    const seen = new Map<string, number>([[rootId, 0]]);
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor]!;
      cursor += 1;
      const candidates = mode === "ancestors"
        ? (parentsByChild.get(current.id) ?? [])
        : (childrenByParent.get(current.id) ?? []);
      for (const edge of candidates) {
        const next = mode === "ancestors" ? edge.parent : edge.child;
        if (current.depth >= maxDepth) {
          if (seen.has(next)) {
            // Both endpoints are inside the trace; keep their relation even
            // though the frontier prevents traversing further from here.
            relations.set(edge.relationPath, edge.relation);
          } else {
            truncated = true;
          }
          continue;
        }
        relations.set(edge.relationPath, edge.relation);
        const depth = current.depth + 1;
        const priorDepth = seen.get(next);
        if (priorDepth !== undefined && priorDepth <= depth) continue;
        seen.set(next, depth);
        queue.push({ id: next, depth });
      }
    }

    for (const [id, depth] of seen) {
      if (id === rootId) continue;
      nodes.push(nodeView(index.byId.get(id), id, depth));
    }
    return nodes.sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id, "en"));
  };

  const ancestors = direction === "descendants" ? [] : traverse("ancestors");
  const descendants = direction === "ancestors" ? [] : traverse("descendants");
  return {
    rootId,
    direction,
    maxDepth,
    truncated,
    ancestors,
    descendants,
    relations: [...relations.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, relation]) => relation),
  };
}

function lineageEdges(record: MatterRecord): Edge[] {
  const raw = record as unknown as Record<string, unknown>;
  return asJsonArray(raw.relations).flatMap((candidate, index) => {
    if (!isJsonObject(candidate)) return [];
    const predicate = readString(candidate, "predicate");
    const subject = readString(candidate, "subject");
    const object = readString(candidate, "object");
    if (predicate === undefined || subject === undefined || object === undefined) return [];
    const relationDirection = Object.hasOwn(lineageRelationDirections, predicate)
      ? lineageRelationDirections[predicate]
      : undefined;
    if (relationDirection === undefined) return [];
    return [
      {
        parent: relationDirection === "subject-is-descendant" ? object : subject,
        child: relationDirection === "subject-is-descendant" ? subject : object,
        relation: candidate,
        relationPath: `/relations/${index}`,
      },
    ];
  });
}

function nodeView(entity: IndexedEntity | undefined, id: string, depth: number): LineageTraceNode {
  if (entity === undefined) return { id, depth };
  return {
    id,
    depth,
    ...(entity.type === undefined ? {} : { type: entity.type }),
    collection: entity.collection,
    instancePath: entity.instancePath,
  };
}

function compareEdges(left: Edge, right: Edge): number {
  return (
    left.parent.localeCompare(right.parent, "en") ||
    left.child.localeCompare(right.child, "en") ||
    left.relationPath.localeCompare(right.relationPath, "en")
  );
}

function groupEdges(edges: readonly Edge[], key: "child" | "parent"): ReadonlyMap<string, readonly Edge[]> {
  const grouped = new Map<string, Edge[]>();
  for (const edge of edges) {
    const id = edge[key];
    const values = grouped.get(id) ?? [];
    values.push(edge);
    grouped.set(id, values);
  }
  for (const values of grouped.values()) values.sort(compareEdges);
  return grouped;
}
