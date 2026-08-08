import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "./index.js";

function capture(): { io: CliIo; out: string[]; error: string[] } {
  const out: string[] = [];
  const error: string[] = [];
  return { io: { out: (value) => out.push(value), error: (value) => error.push(value) }, out, error };
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "masa-cli-test-"));
  temporaryRoots.push(value);
  return value;
}

describe("MASA CLI", () => {
  it("prints help without side effects", async () => {
    const result = capture();
    await expect(runCli(["help"], result.io)).resolves.toBe(0);
    expect(result.out.join("\n")).toContain("MASA 0.1.0 local CLI");
    expect(result.error).toEqual([]);
  });

  it("uses exit code 2 for incomplete commands", async () => {
    const result = capture();
    await expect(runCli(["pack", "input"], result.io)).resolves.toBe(2);
    expect(result.error[0]).toContain("--out");
  });

  it("reports a structured failure for a record without profiles", async () => {
    const root = await temporaryRoot();
    const recordPath = join(root, "empty.masa.json");
    await writeFile(recordPath, "{}\n", "utf8");

    const result = capture();
    await expect(runCli(["conformance", "reader", recordPath, "--json"], result.io)).resolves.toBe(1);
    expect(result.out.join("\n")).toContain("MASA_SCHEMA_INVALID");
    expect(result.error).toEqual([]);
  });

  it("emits bundle diagnostics and exit code 1 when verify fails", async () => {
    const root = await temporaryRoot();
    const bundle = join(root, "broken.masa");
    await mkdir(bundle);
    await writeFile(join(bundle, "manifest.json"), "{}\n", "utf8");

    const result = capture();
    await expect(runCli(["verify", bundle, "--json"], result.io)).resolves.toBe(1);
    expect(result.out.join("\n")).toContain('"valid": false');
    expect(result.out.join("\n")).toContain("MASA_SCHEMA_INVALID");
  });

  it("emits processing templates that pass their own validation", async () => {
    const root = await temporaryRoot();
    for (const operation of ["granulate", "extract", "reduce", "fragment", "timestretch", "pitchshift"]) {
      const requestPath = join(root, `${operation}.masa-process.json`);
      const template = capture();
      await expect(
        runCli(["process", "template", operation, "--out", requestPath], template.io),
      ).resolves.toBe(0);

      const check = capture();
      await expect(runCli(["process", "check", requestPath, "--json"], check.io)).resolves.toBe(0);
      expect(check.out.join("\n")).toContain('"valid": true');
    }

    const unknown = capture();
    await expect(runCli(["process", "template", "liquefy"], unknown.io)).resolves.toBe(2);
  });

  it("serves schemas and capabilities from package-embedded resources", async () => {
    const listed = capture();
    await expect(runCli(["schema", "list", "--json"], listed.io)).resolves.toBe(0);
    expect(listed.out.join("\n")).toContain("matter-record.schema.json");

    const shown = capture();
    await expect(runCli(["schema", "show", "tools/trace-lineage-input"], shown.io)).resolves.toBe(0);
    expect(shown.out.join("\n")).toContain("matter.trace_lineage input");

    const capabilities = capture();
    await expect(runCli(["capabilities"], capabilities.io)).resolves.toBe(0);
    expect(capabilities.out.join("\n")).toContain("matter.audit_public_export");
  });
});
