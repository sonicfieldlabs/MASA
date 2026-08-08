import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { parseJsonStrict, StrictJsonError, type Diagnostic } from "@sonicfield/masa";
import { inspectBundle } from "@sonicfield/masa-bundle";
import { auditPublicRecord, validateMatterRecord } from "@sonicfield/masa-validator";

const root = resolve(import.meta.dirname, "..");
const examples = join(root, "examples", "0.1.0");

const EXPECTED_VALID_COUNT = 9;

/**
 * Every invalid fixture must fail for its intended reason. A fixture that is
 * rejected with an unexpected code, or a validator crash, is a regression
 * rather than a correct rejection.
 */
const EXPECTED_INVALID: Readonly<Record<string, readonly string[]>> = {
  "dangling-reference.masa.json": ["MASA_UNRESOLVED_REF"],
  "derivation-cycle.masa.json": ["MASA_DERIVATION_CYCLE"],
  "duplicate-id.masa.json": ["MASA_DUPLICATE_ID"],
  "failed-operation-with-output.masa.json": ["MASA_SCHEMA_INVALID"],
  "known-null-qualified-value.masa.json": ["MASA_SCHEMA_INVALID"],
  "measurement-missing-unit.masa.json": ["MASA_SCHEMA_INVALID"],
  "processing-missing-parent-relation.masa.json": ["MASA_DESCENDANT_RECEIPT", "MASA_PROFILE_MISMATCH"],
  "profile-mismatch.masa.json": ["MASA_PROFILE_MISMATCH"],
  "public-local-path.masa.json": ["MASA_PUBLIC_PATH"],
  "public-private-actor.masa.json": ["MASA_PUBLIC_DISCLOSURE", "MASA_SCHEMA_INVALID"]
};

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".masa.json"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function declaredProfiles(record: unknown): readonly unknown[] {
  return typeof record === "object" && record !== null && "profiles" in record && Array.isArray(record.profiles)
    ? record.profiles
    : [];
}

const validFiles = await jsonFiles(join(examples, "valid"));
const invalidFiles = await jsonFiles(join(examples, "invalid"));
if (validFiles.length !== EXPECTED_VALID_COUNT) {
  throw new Error(`Expected exactly ${EXPECTED_VALID_COUNT} valid examples; found ${validFiles.length}.`);
}
const invalidNames = invalidFiles.map((path) => basename(path)).sort();
const expectedNames = Object.keys(EXPECTED_INVALID).sort();
if (invalidNames.length !== expectedNames.length || invalidNames.some((name, index) => name !== expectedNames[index])) {
  throw new Error(
    `The invalid example matrix must exactly match its expected-diagnostic table. Found: ${invalidNames.join(", ")}`
  );
}

for (const path of validFiles) {
  const record = parseJsonStrict(await readFile(path, "utf8"));
  const result = declaredProfiles(record).includes("publication")
    ? auditPublicRecord(record)
    : validateMatterRecord(record);
  if (!result.valid) {
    throw new Error(`${relative(root, path)} should be valid: ${JSON.stringify(result.diagnostics)}`);
  }
}

for (const path of invalidFiles) {
  const expectedCodes = EXPECTED_INVALID[basename(path)]!;
  let observed: readonly Diagnostic[];
  try {
    const record = parseJsonStrict(await readFile(path, "utf8"));
    const result = declaredProfiles(record).includes("publication")
      ? auditPublicRecord(record)
      : validateMatterRecord(record);
    if (result.valid) throw new Error(`${relative(root, path)} should be invalid.`);
    observed = result.diagnostics;
  } catch (error) {
    if (error instanceof StrictJsonError) {
      observed = [{
        code: error.code,
        severity: "error",
        instancePath: error.instancePath,
        message: error.message,
        remediation: "Correct the JSON input."
      }];
    } else {
      throw error;
    }
  }
  if (!observed.some((item) => expectedCodes.includes(item.code))) {
    throw new Error(
      `${relative(root, path)} was rejected without its expected diagnostic (${expectedCodes.join(" or ")}): ${JSON.stringify(observed.map((item) => item.code))}`
    );
  }
}

const bundleRoot = join(examples, "bundles");
const bundleEntries = await readdir(bundleRoot, { withFileTypes: true });
for (const entry of bundleEntries.filter((candidate) => candidate.isDirectory())) {
  const inspection = await inspectBundle(join(bundleRoot, entry.name));
  if (!inspection.valid) {
    throw new Error(`${relative(root, join(bundleRoot, entry.name))} should be a valid bundle: ${JSON.stringify(inspection.diagnostics)}`);
  }
}

process.stdout.write(`MASA examples: ${validFiles.length} valid, ${invalidFiles.length} invalid with expected diagnostics, and ${bundleEntries.filter((entry) => entry.isDirectory()).length} bundles checked.\n`);
