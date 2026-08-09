import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configuredRoots } from "./root-policy.js";
import { planProcessingTarget, validateTarget } from "./tools.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("MCP tool failure redaction", () => {
  it("never copies operating-system error messages into tool output", async () => {
    const root = await mkdtemp(join(tmpdir(), "masa-tools-"));
    temporaryRoots.push(root);
    const roots = await configuredRoots(root, root);

    const result = await validateTarget(join(root, "does-not-exist.masa.json"), roots);

    expect(result.status).toBe("failed");
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toBe("The input could not be read.");
    expect(result.diagnostics[0]!.message).not.toContain(root);
  });

  it("refuses paths outside the configured roots with a MASA code", async () => {
    const root = await mkdtemp(join(tmpdir(), "masa-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "masa-outside-"));
    temporaryRoots.push(root, outside);
    const roots = await configuredRoots(root, root);
    await writeFile(join(outside, "record.json"), "{}\n", "utf8");

    const result = await validateTarget(join(outside, "record.json"), roots);

    expect(result.status).toBe("refused");
    expect(result.diagnostics[0]!.code).toBe("MASA_PATH_ESCAPE");
    expect(result.diagnostics[0]!.message).not.toContain(outside);
  });
});

describe("MCP processing planning", () => {
  it("refuses references supplied by an invalid record", async () => {
    const root = await mkdtemp(join(tmpdir(), "masa-tools-"));
    temporaryRoots.push(root);
    const roots = await configuredRoots(root, root);
    const representationId = "urn:uuid:10000000-0000-4000-8000-000000000001";
    const recordPath = join(root, "invalid-record.json");
    await writeFile(
      recordPath,
      JSON.stringify({
        representations: [{ id: representationId, type: "masa:Representation" }]
      }),
      "utf8"
    );

    const result = await planProcessingTarget(
      {
        operationType: "matter.granulate",
        parameters: {
          grain: { durationMs: { min: 5, max: 80 }, envelope: "gaussian" },
          emission: { mode: "asynchronous", grainsPerSecond: 200 },
          selection: { order: "statistical" },
          output: { kind: "texture" }
        },
        inputs: [representationId],
        path: recordPath
      },
      roots
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("MASA_SCHEMA_INVALID");
    expect(result.data).toBeUndefined();
  });
});
