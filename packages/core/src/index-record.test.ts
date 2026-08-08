import { describe, expect, it } from "vitest";

import type { MatterRecord } from "./generated/index.js";
import { indexRecord, summarizeRecord } from "./index-record.js";

describe("indexRecord", () => {
  it("indexes entities, nested policy rules, events, and duplicate identities", () => {
    const record = {
      id: "urn:uuid:record",
      masaVersion: "0.1.0",
      revision: 1,
      profiles: ["core"],
      disclosure: "private",
      actors: [{ id: "urn:uuid:actor", type: "masa:Actor" }],
      policies: [
        {
          id: "urn:uuid:policy",
          type: "masa:Policy",
          rules: [{ id: "urn:uuid:rule" }],
        },
      ],
      representations: [{ id: "urn:uuid:actor", type: "masa:Representation" }],
      history: {
        mode: "embedded",
        events: [{ id: "urn:uuid:event", type: "masa:OperationReceipt" }],
      },
    } as unknown as MatterRecord;

    const index = indexRecord(record);
    expect(index.byId.get("urn:uuid:rule")?.collection).toBe("policyRules");
    expect(index.eventsById.has("urn:uuid:event")).toBe(true);
    expect(index.duplicates).toHaveLength(1);
    expect(summarizeRecord(record).duplicateIds).toBe(1);
  });
});
