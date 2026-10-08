import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateMatterRecord, validateOperationReceipt } from "./index.js";
const cases = JSON.parse(readFileSync(new URL("../../../examples/0.2.0/lineage-cases.json", import.meta.url), "utf8")) as Array<{
  name: string; valid: boolean; codes: string[]; record: any;
}>;
describe("bidirectional generating lineage and per-event preservation", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = validateMatterRecord(scenario.record);
      expect(result.valid, JSON.stringify(result.diagnostics)).toBe(scenario.valid);
      for (const code of scenario.codes) expect(result.diagnostics.map(d => d.code)).toContain(code);
    });
  }
  it("defers external receipt contents without pretending to verify causality", () => {
    const record = structuredClone(cases[0]!.record);
    record.history = { mode: "external", href: "events.ndjson", eventIds: [record.history.events[0].id] };
    expect(validateMatterRecord(record).valid).toBe(true);
  });
  it("checks completed preservation in standalone external receipts", () => {
    const receipt = structuredClone(cases[0]!.record.history.events[0]);
    expect(validateOperationReceipt(receipt).valid).toBe(true);
    delete receipt.parameters.preservationIntent;
    expect(validateOperationReceipt(receipt).valid).toBe(false);
  });
});
