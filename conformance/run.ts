import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  parseJsonStrict,
  stableStringify,
  StrictJsonError,
  type Diagnostic,
  type MatterRecord
} from "@sonicfield/masa";
import { inspectBundle, packBundle, unpackBundle } from "@sonicfield/masa-bundle";
import {
  auditPublicRecord,
  validateCapabilitySet,
  validateDocument,
  validateMatterRecord
} from "@sonicfield/masa-validator";

type EvidenceStatus = "conformant" | "partial" | "not_run" | "failed" | "unknown";
type ConformanceClass = "reader" | "writer" | "transformer" | "agent-host" | "publisher";

interface TestResult {
  id: string;
  status: EvidenceStatus;
  diagnostics: Diagnostic[];
}

const root = resolve(import.meta.dirname, "..");
const examples = join(root, "examples", "0.1.0");
const validDirectory = join(examples, "valid");
const invalidDirectory = join(examples, "invalid");

function conformanceFailure(id: string, error: unknown): Diagnostic {
  return {
    code: "MASA_CONFORMANCE_FAILURE",
    severity: "error",
    instancePath: `/${id}`,
    message: error instanceof Error ? error.message : "A conformance assertion failed.",
    remediation: "Correct the implementation or fixture, then rerun the exact MASA 0.1.0 suite."
  };
}

async function test(id: string, action: () => void | Promise<void>): Promise<TestResult> {
  try {
    await action();
    return { id, status: "conformant", diagnostics: [] };
  } catch (error) {
    return { id, status: "failed", diagnostics: [conformanceFailure(id, error)] };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function record(path: string): Promise<MatterRecord> {
  return parseJsonStrict(await readFile(path, "utf8")) as MatterRecord;
}

async function masaRecordFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".masa.json"))
    .sort()
    .map((name) => join(directory, name));
}

function validateDeclaredRecord(value: MatterRecord) {
  return (value.profiles as readonly string[]).includes("publication")
    ? auditPublicRecord(value)
    : validateMatterRecord(value);
}

const FIXTURE_EXTENSIONS = /\.(?:json|jsonld|ndjson)$/u;

async function fixtureDigest(): Promise<{ digest: string; byteLength: number }> {
  // The digest witnesses the exact executable fixture set together with the
  // normative inputs that give the fixtures meaning, so a schema, registry,
  // or context change cannot leave previously recorded evidence looking
  // current. Labels are POSIX-normalized and sorted by code point so the
  // digest is identical across platforms and locales.
  const roots = [
    examples,
    join(root, "capabilities", "0.1.0"),
    join(root, "schemas", "0.1.0"),
    join(root, "ontology", "0.1.0"),
    join(root, "contexts", "0.1.0")
  ];
  const labeled: Array<{ path: string; label: string }> = [];
  for (const directory of roots) {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !FIXTURE_EXTENSIONS.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      labeled.push({ path, label: relative(root, path).split(sep).join("/") });
    }
  }
  labeled.sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));
  const hash = createHash("sha256");
  let byteLength = 0;
  for (const { path, label } of labeled) {
    const content = await readFile(path);
    const labelBytes = `${label}\0`;
    hash.update(labelBytes);
    hash.update(content);
    hash.update("\0");
    byteLength += Buffer.byteLength(labelBytes) + content.byteLength + 1;
  }
  return { digest: hash.digest("hex"), byteLength };
}

const tests: TestResult[] = [];

tests.push(await test("reader.valid-profile-matrix", async () => {
  const files = await masaRecordFiles(validDirectory);
  assert(files.length === 9, "Valid fixture matrix does not match the expected count of 9.");
  for (const path of files) {
    const validation = validateDeclaredRecord(await record(path));
    assert(validation.valid, `${basename(path)} failed: ${stableStringify(validation.diagnostics)}`);
  }
}));

tests.push(await test("reader.invalid-profile-matrix", async () => {
  const files = await masaRecordFiles(invalidDirectory);
  assert(files.length === 10, "Invalid fixture matrix does not match the expected count of 10.");
  for (const path of files) {
    let valid = false;
    try {
      valid = validateDeclaredRecord(await record(path)).valid;
    } catch (error) {
      // Only a strict-JSON rejection counts as a correct refusal; any other
      // exception is a validator crash and must fail the suite.
      if (!(error instanceof StrictJsonError)) throw error;
      valid = false;
    }
    assert(!valid, `${basename(path)} was incorrectly accepted.`);
  }
}));

tests.push(await test("reader.strict-json-and-extension-roundtrip", async () => {
  let duplicateRefused = false;
  try {
    parseJsonStrict('{"id":1,"id":2}');
  } catch (error) {
    duplicateRefused = error instanceof Error && "code" in error && error.code === "MASA_JSON_DUPLICATE_KEY";
  }
  assert(duplicateRefused, "Duplicate JSON keys were not refused.");
  const source = await record(join(validDirectory, "minimal-record.masa.json"));
  const roundTrip = parseJsonStrict(stableStringify(source)) as MatterRecord;
  assert(
    stableStringify(roundTrip.extensions) === stableStringify(source.extensions),
    "Unknown namespaced extension content changed during a semantic round trip."
  );
}));

tests.push(await test("reader.directory-bundle", async () => {
  const inspection = await inspectBundle(join(examples, "bundles", "transformation.masa"));
  assert(inspection.valid, `Directory bundle failed: ${stableStringify(inspection.diagnostics)}`);
}));

tests.push(await test("reader.deterministic-zip-roundtrip", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "masa-conformance-"));
  try {
    const source = join(examples, "bundles", "transformation.masa");
    const first = join(temporary, "first.masa.zip");
    const second = join(temporary, "second.masa.zip");
    await packBundle(source, first);
    await packBundle(source, second);
    const firstBytes = await readFile(first);
    const secondBytes = await readFile(second);
    assert(firstBytes.equals(secondBytes), "Repeated deterministic packing produced different ZIP bytes.");
    const unpacked = join(temporary, "unpacked.masa");
    const inspection = await unpackBundle(first, unpacked);
    assert(inspection.valid, "Packed bundle did not survive bounded unpack and revalidation.");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}));

tests.push(await test("writer.identities-profiles-and-receipts", async () => {
  for (const name of ["minimal-record.masa.json", "listening-analysis-audio.masa.json", "mapping.masa.json"]) {
    const value = await record(join(validDirectory, name));
    const validation = validateMatterRecord(value);
    assert(validation.valid, `${name} is not a valid writer output.`);
    assert(value.id.startsWith("urn:uuid:"), `${name} does not use the reference globally unique ID form.`);
    assert(value.profiles.includes("core"), `${name} omits Core.`);
  }
}));

tests.push(await test("transformer.processing-lineage", async () => {
  const processed = await record(join(validDirectory, "processing.masa.json"));
  assert(validateMatterRecord(processed).valid, "Processing fixture failed validation.");
  assert(
    processed.relations.some((relation) => relation.predicate === "masa:granulated-from"),
    "Granulation lineage relation is absent."
  );
  const missingLineage = await record(join(invalidDirectory, "processing-missing-parent-relation.masa.json"));
  assert(
    !validateMatterRecord(missingLineage).valid,
    "A granulated descendant without its lineage relation was accepted."
  );
}));

tests.push(await test("transformer.lineage-and-failure", async () => {
  const transformed = await record(join(validDirectory, "transformation.masa.json"));
  assert(validateMatterRecord(transformed).valid, "Transformation fixture failed validation.");
  assert(transformed.representations[0]?.id !== transformed.representations[1]?.id, "Transformation reused its parent ID.");
  assert(transformed.relations.some((relation) => relation.predicate === "masa:derived-from"), "Parent relation is absent.");
  const failed = await record(join(invalidDirectory, "failed-operation-with-output.masa.json"));
  assert(!validateMatterRecord(failed).valid, "A failed operation fabricated a descendant without rejection.");
  const cycle = await record(join(invalidDirectory, "derivation-cycle.masa.json"));
  assert(!validateMatterRecord(cycle).valid, "A derivation cycle was accepted.");
}));

tests.push(await test("agent-host.capabilities-and-record", async () => {
  const catalog = parseJsonStrict(await readFile(join(root, "capabilities", "0.1.0", "reference.json"), "utf8"));
  const catalogValidation = validateCapabilitySet(catalog);
  assert(catalogValidation.valid, `Capability catalog failed: ${stableStringify(catalogValidation.diagnostics)}`);
  const agentRecord = await record(join(validDirectory, "agent.masa.json"));
  assert(validateMatterRecord(agentRecord).valid, "Agent profile fixture failed validation.");
}));

tests.push(await test("agent-host.mcp-stdio", async () => {
  const serverPath = join(root, "mcp", "dist", "server.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, MASA_ALLOWED_ROOTS: root }
  });
  const client = new Client({ name: "masa-conformance", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of [
      "matter.validate",
      "matter.inspect",
      "matter.trace_lineage",
      "matter.audit_public_export",
      "matter.plan_processing"
    ]) {
      assert(names.has(name), `MCP capability ${name} is absent.`);
    }
    const result = await client.callTool({
      name: "matter.validate",
      arguments: { path: join(validDirectory, "minimal-record.masa.json") }
    });
    assert(result.isError !== true, "MCP validation invocation returned a protocol error.");
    const structured = result.structuredContent as { valid?: unknown } | undefined;
    assert(structured?.valid === true, "MCP validation did not return a valid structured result.");
    const lineage = await client.callTool({
      name: "matter.trace_lineage",
      arguments: {
        path: join(validDirectory, "transformation.masa.json"),
        entityId: "urn:uuid:00000000-0000-4000-8000-000000000602",
        direction: "ancestors",
        maxDepth: 4
      }
    });
    assert(lineage.isError !== true, "MCP lineage invocation returned a protocol error.");
    const lineageStructured = lineage.structuredContent as {
      valid?: unknown;
      data?: { ancestors?: Array<{ id?: unknown }> };
    } | undefined;
    assert(lineageStructured?.valid === true, "MCP lineage did not return a valid structured result.");
    assert(
      lineageStructured.data?.ancestors?.some(
        ({ id }) => id === "urn:uuid:00000000-0000-4000-8000-000000000601",
      ),
      "MCP lineage omitted the registered causal ancestor.",
    );
    const plan = await client.callTool({
      name: "matter.plan_processing",
      arguments: {
        operationType: "matter.granulate",
        parameters: {
          grain: { durationMs: { min: 5, max: 80 }, envelope: "gaussian" },
          emission: { mode: "asynchronous", grainsPerSecond: 200 },
          selection: { order: "statistical" },
          output: { kind: "texture" }
        },
        inputs: ["urn:uuid:00000000-0000-4000-8000-000000000d01"],
        path: join(validDirectory, "processing.masa.json")
      }
    });
    assert(plan.isError !== true, "MCP processing planning returned a protocol error.");
    const planStructured = plan.structuredContent as {
      valid?: unknown;
      data?: { request?: { operationType?: unknown } };
    } | undefined;
    assert(planStructured?.valid === true, "MCP processing planning did not return a valid request.");
    assert(
      planStructured.data?.request?.operationType === "matter.granulate",
      "MCP processing planning returned the wrong operation."
    );
    const resource = await client.readResource({ uri: "masa://capabilities" });
    assert(resource.contents.length === 1, "MCP capability resource is absent.");
  } finally {
    await client.close().catch(() => undefined);
  }
}));

tests.push(await test("publisher.public-projection-audit", async () => {
  const publicRecord = await record(join(validDirectory, "publication.masa.json"));
  const audit = auditPublicRecord(publicRecord);
  assert(audit.valid, `Public fixture failed audit: ${stableStringify(audit.diagnostics)}`);
  for (const name of ["public-private-actor.masa.json", "public-local-path.masa.json"]) {
    const invalid = await record(join(invalidDirectory, name));
    assert(!auditPublicRecord(invalid).valid, `${name} was incorrectly accepted for publication.`);
  }
}));

const classTests: Readonly<Record<ConformanceClass, readonly string[]>> = {
  reader: [
    "reader.valid-profile-matrix",
    "reader.invalid-profile-matrix",
    "reader.strict-json-and-extension-roundtrip",
    "reader.directory-bundle",
    "reader.deterministic-zip-roundtrip"
  ],
  writer: ["reader.valid-profile-matrix", "writer.identities-profiles-and-receipts"],
  transformer: [
    "reader.directory-bundle",
    "reader.deterministic-zip-roundtrip",
    "transformer.lineage-and-failure",
    "transformer.processing-lineage"
  ],
  "agent-host": ["agent-host.capabilities-and-record", "agent-host.mcp-stdio"],
  publisher: ["publisher.public-projection-audit"]
};

const classProfiles: Readonly<Record<ConformanceClass, string>> = {
  reader: "core",
  writer: "core",
  transformer: "transformation",
  "agent-host": "agent",
  publisher: "publication"
};

const fixture = await fixtureDigest();
const runAt = new Date().toISOString();
const classes = Object.keys(classTests) as ConformanceClass[];
const evidence = classes.map((className, index) => {
  const selected = tests.filter((item) => classTests[className].includes(item.id));
  if (selected.length !== classTests[className].length) {
    throw new Error(`Conformance class ${className} is missing declared tests; evidence would misreport coverage.`);
  }
  const failed = selected.flatMap((item) => item.diagnostics);
  return {
    id: `urn:uuid:10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    type: "masa:ConformanceResult",
    suite: { name: "masa-typescript-reference-conformance", version: "0.1.0" },
    implementation: { name: "MASA local TypeScript reference", version: "0.1.0" },
    subject: "@sonicfield/masa workspace",
    platform: { os: platform(), architecture: arch(), runtime: `node ${process.version}` },
    masaVersion: "0.1.0",
    profile: classProfiles[className],
    class: className,
    status: failed.length === 0 ? "conformant" : "failed",
    migrationStatus: "not_applicable",
    runAt,
    tests: selected,
    fixtureManifestDigest: {
      algorithm: "sha-256",
      digest: fixture.digest,
      byteLength: fixture.byteLength,
      status: "verified",
      verifiedAt: runAt
    },
    diagnostics: failed,
    extensions: {}
  };
});

for (const result of evidence) {
  const validation = validateDocument("conformanceResult", result);
  if (!validation.valid) {
    throw new Error(`Conformance evidence does not satisfy its schema: ${stableStringify(validation.diagnostics)}`);
  }
}

if (process.argv.includes("--write-evidence")) {
  const evidenceDirectory = join(root, "conformance", "0.1.0", "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  for (const result of evidence) {
    await writeFile(join(evidenceDirectory, `${result.class}.json`), `${stableStringify(result, 2)}\n`, "utf8");
  }
}

process.stdout.write(`${stableStringify({ suite: "masa-typescript-reference-conformance", version: "0.1.0", evidence }, 2)}\n`);
if (evidence.some((result) => result.status === "failed")) process.exitCode = 1;
