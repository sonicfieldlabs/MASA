import { readFileSync } from "node:fs";

import { createPublicProjection, type MatterRecord } from "@sonicfield/masa";
import { describe, expect, it } from "vitest";

import {
  auditMatterRecordSemantics,
  auditPublicRecord,
  getEmbeddedSchema,
  listEmbeddedSchemas,
  validateCapability,
  validateCapabilitySet,
  validateDocument,
  validateMatterRecord,
} from "./index.js";

function fixture(path: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("offline MASA validation", () => {
  it("accepts the canonical minimal and publication fixtures", () => {
    const minimal = validateMatterRecord(
      fixture("examples/0.1.0/valid/minimal-record.masa.json"),
    );
    const publication = auditPublicRecord(
      fixture("examples/0.1.0/valid/publication.masa.json"),
    );

    expect(minimal).toMatchObject({ valid: true, diagnostics: [] });
    expect(publication).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("reports stable semantic diagnostics for unresolved references and cycles", () => {
    const dangling = validateMatterRecord(
      fixture("examples/0.1.0/invalid/dangling-reference.masa.json"),
    );
    const cyclic = validateMatterRecord(
      fixture("examples/0.1.0/invalid/derivation-cycle.masa.json"),
    );

    expect(dangling.valid).toBe(false);
    expect(dangling.diagnostics.map(({ code }) => code)).toContain("MASA_UNRESOLVED_REF");
    expect(cyclic.valid).toBe(false);
    expect(cyclic.diagnostics.map(({ code }) => code)).toContain("MASA_DERIVATION_CYCLE");
    expect(validateMatterRecord(fixture("examples/0.1.0/invalid/dangling-reference.masa.json")))
      .toEqual(dangling);
  });

  it("blocks local paths from public records", () => {
    const result = auditPublicRecord(
      fixture("examples/0.1.0/invalid/public-local-path.masa.json"),
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MASA_PUBLIC_PATH" })]),
    );
  });

  it("emits remediable, value-free structural diagnostics", () => {
    const result = validateMatterRecord({
      masaVersion: "9.9.9",
      password: "must-never-appear-in-a-diagnostic",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("MASA_UNSUPPORTED_VERSION");
    expect(result.diagnostics.every(({ remediation }) => remediation.length > 0)).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toContain("must-never-appear-in-a-diagnostic");
  });

  it("validates the generated capability catalog and embedded schemas", () => {
    const catalog = fixture("capabilities/0.1.0/reference.json") as {
      capabilities: unknown[];
    };

    expect(validateCapabilitySet(catalog).valid).toBe(true);
    expect(validateCapability(catalog.capabilities[0]).valid).toBe(true);
    expect(validateDocument("matterRecord", fixture("examples/0.1.0/valid/minimal-record.masa.json")).valid)
      .toBe(true);
    expect(validateDocument("unknown-schema", {}).diagnostics[0]?.code).toBe("MASA_SCHEMA_UNKNOWN");
    expect(listEmbeddedSchemas().some(({ fileName }) => fileName === "tools/trace-lineage-input.schema.json"))
      .toBe(true);
    expect(getEmbeddedSchema("tools/trace-lineage-input")).toMatchObject({ title: "matter.trace_lineage input" });
  });

  it("keeps qualified deletion distinct and rejects the assertion-null family", () => {
    const deleted = validateMatterRecord(
      fixture("examples/0.1.0/valid/deleted-state.masa.json"),
    );
    expect(deleted.valid).toBe(true);

    const knownNull = validateMatterRecord(
      fixture("examples/0.1.0/invalid/known-null-qualified-value.masa.json"),
    );
    expect(knownNull.valid).toBe(false);

    const nullMeasurement = structuredClone(
      fixture("examples/0.1.0/valid/listening-analysis-audio.masa.json"),
    ) as any;
    nullMeasurement.measurements[0].value = null;
    expect(validateMatterRecord(nullMeasurement).valid).toBe(false);

    const nullClaim = structuredClone(
      fixture("examples/0.1.0/valid/listening-analysis-audio.masa.json"),
    ) as any;
    nullClaim.claims[0].content = null;
    expect(validateMatterRecord(nullClaim).valid).toBe(false);

    const nullClaimValue = structuredClone(
      fixture("examples/0.1.0/valid/listening-analysis-audio.masa.json"),
    ) as any;
    nullClaimValue.claims[0].value = null;
    expect(validateMatterRecord(nullClaimValue).valid).toBe(false);

    const nullContext = structuredClone(
      fixture("examples/0.1.0/valid/minimal-record.masa.json"),
    ) as any;
    nullContext.contexts.push({
      id: "urn:uuid:ffffffff-ffff-4fff-8fff-fffffffffff1",
      type: "masa:Context",
      contextKind: "technical",
      content: null,
      provenance: { state: "unknown", reason: "Regression fixture." },
      applicability: "Regression fixture.",
      position: { state: "not_applicable" },
      claimStatus: "not_a_claim",
      disclosure: "private",
      extensions: {},
    });
    expect(validateMatterRecord(nullContext).valid).toBe(false);

    const nullThreshold = structuredClone(
      fixture("examples/0.1.0/valid/listening-analysis-audio.masa.json"),
    ) as any;
    nullThreshold.apertures[0].thresholds.push({
      name: "Regression threshold",
      comparison: "greater-than",
      value: null,
      unit: "linear",
      method: {
        name: "Regression fixture",
        version: { state: "known", value: "1.0.0" },
        parameters: {},
      },
      uncertainty: [],
    });
    expect(validateMatterRecord(nullThreshold).valid).toBe(false);

    const nullSeed = structuredClone(
      fixture("examples/0.1.0/valid/generation.masa.json"),
    ) as any;
    nullSeed.history.events[0].determinism.seed = null;
    expect(validateMatterRecord(nullSeed).valid).toBe(false);

    const missingReceipt = structuredClone(
      fixture("examples/0.1.0/valid/deleted-state.masa.json"),
    ) as any;
    missingReceipt.representations[0].locator.receiptRefs = ["urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff"];
    expect(validateMatterRecord(missingReceipt).diagnostics.map(({ code }) => code))
      .toContain("MASA_UNRESOLVED_REF");
  });

  it("checks typed references, interval order, and namespaced classification", () => {
    const wrongCreator = structuredClone(
      fixture("examples/0.1.0/valid/minimal-record.masa.json"),
    ) as any;
    wrongCreator.createdBy = wrongCreator.representations[0].id;
    expect(validateMatterRecord(wrongCreator).diagnostics.map(({ code }) => code))
      .toContain("MASA_REF_TYPE");

    const reversedWindow = structuredClone(
      fixture("examples/0.1.0/valid/listening-analysis-audio.masa.json"),
    ) as any;
    reversedWindow.measurements[0].window.end = -1;
    expect(validateMatterRecord(reversedWindow).diagnostics.map(({ code }) => code))
      .toContain("MASA_WINDOW_ORDER");

    const extended = structuredClone(
      fixture("examples/0.1.0/valid/minimal-record.masa.json"),
    ) as any;
    extended.registers.push("example:field-practice");
    extended.scales.push("example:installation-cycle");
    expect(validateMatterRecord(extended).valid).toBe(true);
  });

  it("audits a decorrelated projection produced by the reference pipeline", () => {
    const source = structuredClone(
      fixture("examples/0.1.0/valid/publication.masa.json"),
    ) as any;
    source.publication.publicRecordId = "urn:uuid:99999999-9999-4999-8999-999999999999";

    const projection = createPublicProjection(source as MatterRecord);
    const audit = auditPublicRecord(projection.record);

    expect(audit.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    expect(audit.valid).toBe(true);
    expect(JSON.stringify(projection.record)).not.toContain(source.id);
  });

  it("survives adversarial relation graphs without crashing", () => {
    const chain: unknown[] = [];
    for (let index = 0; index < 30_000; index += 1) {
      chain.push({
        id: `urn:uuid:relation-${index}`,
        type: "masa:Relation",
        subject: `urn:uuid:node-${index + 1}`,
        predicate: "masa:derived-from",
        object: `urn:uuid:node-${index}`,
      });
    }
    const longChain = {
      id: "urn:uuid:record",
      relations: chain,
      history: { mode: "embedded", events: [] },
    } as unknown as MatterRecord;
    expect(() => auditMatterRecordSemantics(longChain)).not.toThrow();

    const prototypePredicates = {
      id: "urn:uuid:record",
      relations: [
        {
          id: "urn:uuid:relation-a",
          type: "masa:Relation",
          subject: "urn:uuid:a",
          predicate: "constructor",
          object: "urn:uuid:b",
        },
        {
          id: "urn:uuid:relation-b",
          type: "masa:Relation",
          subject: "urn:uuid:b",
          predicate: "constructor",
          object: "urn:uuid:a",
        },
      ],
      history: { mode: "embedded", events: [] },
    } as unknown as MatterRecord;
    const diagnostics = auditMatterRecordSemantics(prototypePredicates);
    expect(diagnostics.map(({ code }) => code)).not.toContain("MASA_DERIVATION_CYCLE");
  });

  it("does not flag schema-valid leap-second timestamps as temporal disorder", () => {
    const record = structuredClone(
      fixture("examples/0.1.0/valid/mapping.masa.json"),
    ) as any;
    record.sources[0].freshness = {
      status: "stale",
      observedAt: "2016-12-31T23:59:60Z",
      retrievedAt: "2017-01-01T00:00:05Z",
    };
    record.observations[0].freshness = record.sources[0].freshness;

    const result = validateMatterRecord(record);
    expect(result.diagnostics.map(({ code }) => code)).not.toContain("MASA_TEMPORAL_ORDER");
  });

  it("accepts inverse lineage syntax and verifies publication permission rules", () => {
    const inverse = structuredClone(
      fixture("examples/0.1.0/valid/transformation.masa.json"),
    ) as any;
    const relation = inverse.relations[0];
    relation.predicate = "masa:derivation-of";
    [relation.subject, relation.object] = [relation.object, relation.subject];
    expect(validateMatterRecord(inverse).valid).toBe(true);

    const unsupportedPermission = structuredClone(
      fixture("examples/0.1.0/valid/publication.masa.json"),
    ) as any;
    unsupportedPermission.policies[0].rules[0].actions = ["read"];
    const audit = auditPublicRecord(unsupportedPermission);
    expect(audit.valid).toBe(false);
    expect(audit.diagnostics.map(({ code }) => code)).toContain("MASA_POLICY_DENIED");
  });
});
