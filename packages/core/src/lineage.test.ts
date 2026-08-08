import { describe, expect, it } from "vitest";

import type { MatterRecord } from "./generated/index.js";
import { traceLineage } from "./lineage.js";

function record(relations: unknown[]): MatterRecord {
  return {
    id: "urn:uuid:record",
    actors: [],
    sources: [],
    representations: [
      { id: "urn:uuid:parent", type: "masa:Representation" },
      { id: "urn:uuid:child", type: "masa:Representation" },
      { id: "urn:uuid:grandchild", type: "masa:Representation" },
    ],
    relations,
    policies: [],
    history: { mode: "embedded", events: [] },
  } as unknown as MatterRecord;
}

describe("traceLineage", () => {
  it("traverses direct and inverse registered lineage directions", () => {
    const value = record([
      {
        id: "urn:uuid:relation-1",
        type: "masa:Relation",
        subject: "urn:uuid:child",
        predicate: "masa:derived-from",
        object: "urn:uuid:parent",
      },
      {
        id: "urn:uuid:relation-2",
        type: "masa:Relation",
        subject: "urn:uuid:child",
        predicate: "masa:derivation-of",
        object: "urn:uuid:grandchild",
      },
    ]);

    const trace = traceLineage(value, "urn:uuid:child");
    expect(trace.ancestors.map(({ id }) => id)).toEqual(["urn:uuid:parent"]);
    expect(trace.descendants.map(({ id }) => id)).toEqual(["urn:uuid:grandchild"]);
    expect(trace.relations).toHaveLength(2);
  });

  it("reports bounded traversal without guessing extension predicates", () => {
    const value = record([
      {
        id: "urn:uuid:relation-1",
        type: "masa:Relation",
        subject: "urn:uuid:child",
        predicate: "masa:derived-from",
        object: "urn:uuid:parent",
      },
      {
        id: "urn:uuid:relation-extension",
        type: "masa:Relation",
        subject: "urn:uuid:grandchild",
        predicate: "example:resembles",
        object: "urn:uuid:child",
      },
    ]);

    const trace = traceLineage(value, "urn:uuid:child", { direction: "descendants", maxDepth: 1 });
    expect(trace.descendants).toEqual([]);
    expect(trace.relations).toEqual([]);
    expect(() => traceLineage(value, "urn:uuid:missing")).toThrow(/does not exist/);
  });

  it("never treats prototype-chain member names as registered lineage predicates", () => {
    const value = record([
      {
        id: "urn:uuid:relation-proto",
        type: "masa:Relation",
        subject: "urn:uuid:child",
        predicate: "constructor",
        object: "urn:uuid:parent",
      },
    ]);

    const trace = traceLineage(value, "urn:uuid:child");
    expect(trace.ancestors).toEqual([]);
    expect(trace.descendants).toEqual([]);
    expect(trace.relations).toEqual([]);
  });

  it("keeps relations whose endpoints are both inside the trace at the depth frontier", () => {
    const value = record([
      {
        id: "urn:uuid:relation-1",
        type: "masa:Relation",
        subject: "urn:uuid:child",
        predicate: "masa:derived-from",
        object: "urn:uuid:parent",
      },
      {
        id: "urn:uuid:relation-2",
        type: "masa:Relation",
        subject: "urn:uuid:grandchild",
        predicate: "masa:derived-from",
        object: "urn:uuid:parent",
      },
      {
        id: "urn:uuid:relation-3",
        type: "masa:Relation",
        subject: "urn:uuid:grandchild",
        predicate: "masa:derived-from",
        object: "urn:uuid:child",
      },
    ]);

    const trace = traceLineage(value, "urn:uuid:parent", { direction: "descendants", maxDepth: 1 });
    expect(trace.descendants.map(({ id }) => id).sort()).toEqual([
      "urn:uuid:child",
      "urn:uuid:grandchild",
    ]);
    expect(trace.relations.map((relation) => relation.id).sort()).toEqual([
      "urn:uuid:relation-1",
      "urn:uuid:relation-2",
      "urn:uuid:relation-3",
    ]);
    expect(trace.truncated).toBe(false);
  });

  it("omits relations beyond the returned depth frontier", () => {
    const value = record([
      {
        id: "urn:uuid:relation-1",
        type: "masa:Relation",
        subject: "urn:uuid:child",
        predicate: "masa:derived-from",
        object: "urn:uuid:parent",
      },
      {
        id: "urn:uuid:relation-2",
        type: "masa:Relation",
        subject: "urn:uuid:grandchild",
        predicate: "masa:derived-from",
        object: "urn:uuid:child",
      },
    ]);

    const trace = traceLineage(value, "urn:uuid:parent", { direction: "descendants", maxDepth: 1 });
    expect(trace.descendants.map(({ id }) => id)).toEqual(["urn:uuid:child"]);
    expect(trace.relations.map((relation) => relation.id)).toEqual(["urn:uuid:relation-1"]);
    expect(trace.truncated).toBe(true);
  });
});
