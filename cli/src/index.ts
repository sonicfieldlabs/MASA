#!/usr/bin/env node
import { access, link, open, stat, unlink, writeFile } from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicProjection,
  MASA_PROTOCOL_VERSION,
  MASA_REFERENCE_IMPLEMENTATION_VERSION,
  parseJsonStrict,
  referenceCapabilitySet,
  stableStringify,
  summarizeRecord,
  traceLineage,
  type LineageDirection,
  type MatterRecord
} from "@sonicfield/masa";
import {
  BundleValidationError,
  inspectBundle,
  packBundle,
  unpackBundle,
  verifyBundle
} from "@sonicfield/masa-bundle";
import {
  auditPublicRecord,
  getEmbeddedSchema,
  listEmbeddedSchemas,
  validateDocument,
  validateMatterRecord
} from "@sonicfield/masa-validator";

const MAX_RECORD_BYTES = 16 * 1024 * 1024;

export interface CliIo {
  out(value: string): void;
  error(value: string): void;
}

const defaultIo: CliIo = {
  out: (value) => process.stdout.write(`${value}\n`),
  error: (value) => process.stderr.write(`${value}\n`)
};

class UsageError extends Error {}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`--${name} requires a value.`);
  return value;
}

function positionals(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (value === "--json") continue;
    if (value === "--out" || value === "--version" || value === "--direction" || value === "--max-depth") {
      index += 1;
      continue;
    }
    if (value.startsWith("--")) throw new UsageError(`Unknown option ${value}.`);
    values.push(value);
  }
  return values;
}

function integerOption(args: readonly string[], name: string, minimum: number, maximum: number): number | undefined {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function emit(io: CliIo, value: unknown, json: boolean): void {
  if (json || typeof value !== "string") io.out(stableStringify(value, 2));
  else io.out(value);
}

async function loadJsonDocument(path: string): Promise<unknown> {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES) {
      throw new Error("JSON input must be a regular file no larger than 16 MiB.");
    }
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_RECORD_BYTES) {
      throw new Error("JSON input must be a regular file no larger than 16 MiB.");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("JSON input must be valid UTF-8.");
    }
    return parseJsonStrict(text);
  } finally {
    await handle.close();
  }
}

async function loadRecord(path: string): Promise<MatterRecord> {
  return (await loadJsonDocument(path)) as MatterRecord;
}

const PROCESSING_TEMPLATE_PARAMETERS: Readonly<Record<string, Record<string, unknown>>> = {
  granulate: {
    grain: { durationMs: { min: 5, max: 80 }, envelope: "gaussian" },
    emission: { mode: "asynchronous", grainsPerSecond: 200 },
    selection: { order: "statistical" },
    output: { kind: "texture" }
  },
  extract: { domain: "spectral-band", bandHz: { lowHz: 200, highHz: 2000 }, residual: false },
  reduce: { kind: "spectral-peaks", keepPartials: 24 },
  fragment: { strategy: "equal-duration", count: 8 },
  timestretch: { factor: 2, transientMode: "preserve" },
  pitchshift: { cents: -700, formantPreserved: true }
};

const PLACEHOLDER_ID = "urn:uuid:00000000-0000-4000-8000-000000000000";

function processingTemplate(operation: string): Record<string, unknown> {
  if (!Object.hasOwn(PROCESSING_TEMPLATE_PARAMETERS, operation)) {
    throw new UsageError(
      `Unknown processing operation ${operation}. Use one of: ${Object.keys(PROCESSING_TEMPLATE_PARAMETERS).join(", ")}.`
    );
  }
  return {
    requestType: "masa-processing-request",
    requestVersion: MASA_PROTOCOL_VERSION,
    masaVersion: MASA_PROTOCOL_VERSION,
    id: PLACEHOLDER_ID,
    createdAt: "2026-01-01T00:00:00Z",
    operationType: `matter.${operation}`,
    inputs: [PLACEHOLDER_ID],
    parameters: PROCESSING_TEMPLATE_PARAMETERS[operation],
    determinism: "require-seeded",
    policyRefs: [],
    outputContract: { roles: ["derivative"], maxOutputs: 16 },
    extensions: {}
  };
}

function isZipPath(path: string): boolean {
  return extname(path).toLowerCase() === ".zip";
}

async function writeNewJson(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  await access(dirname(target), constants.W_OK);
  const temporary = join(dirname(target), `.${Date.now()}-${process.pid}.masa.tmp`);
  await writeFile(temporary, `${stableStringify(value, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite ${target}.`);
    }
    throw error;
  }
  await unlink(temporary);
}

function usage(): string {
  return [
    `MASA local CLI ${MASA_REFERENCE_IMPLEMENTATION_VERSION} (protocol ${MASA_PROTOCOL_VERSION})`,
    "",
    "masa validate <record-or-bundle> [--json]",
    "masa inspect <record-or-bundle> [--json]",
    "masa verify <bundle> [--json]",
    "masa pack <directory> --out <bundle.masa.zip> [--json]",
    "masa unpack <bundle.masa.zip> --out <directory> [--json]",
    "masa project-public <record> --out <public-record.masa.json> [--json]",
    "masa audit-public <record> [--json]",
    "masa process template <granulate|extract|reduce|fragment|timestretch|pitchshift> [--out <file>]",
    "masa process check <request.json> [--json]",
    "masa lineage <record> <entity-id> [--direction ancestors|descendants|both] [--max-depth 1..64] [--json]",
    "masa conformance <reader|writer|transformer|agent-host|publisher> <record> [--json]",
    "masa schema list [--json]",
    `masa schema show <name> [--version ${MASA_PROTOCOL_VERSION}] [--json]`,
    "masa capabilities [--json]"
  ].join("\n");
}

async function validateCommand(path: string): Promise<{ output: unknown; code: number }> {
  const absolute = resolve(path);
  const metadata = await stat(absolute);
  if (metadata.isDirectory() || isZipPath(absolute)) {
    const inspection = await inspectBundle(absolute);
    return { output: inspection, code: inspection.valid ? 0 : 1 };
  }
  const result = validateMatterRecord(await loadRecord(absolute));
  return { output: { valid: result.valid, diagnostics: result.diagnostics }, code: result.valid ? 0 : 1 };
}

async function conformanceCommand(className: string, path: string): Promise<{ output: unknown; code: number }> {
  const record = await loadRecord(resolve(path));
  const requiredProfile: Record<string, string> = {
    reader: "core",
    writer: "core",
    transformer: "transformation",
    "agent-host": "agent",
    publisher: "publication"
  };
  const profile = requiredProfile[className];
  if (!profile) throw new UsageError(`Unknown conformance class ${className}.`);
  const validation = className === "publisher"
    ? auditPublicRecord(record)
    : validateMatterRecord(record);
  const profilePresent =
    Array.isArray(record.profiles) &&
    (record.profiles as readonly unknown[]).includes(profile);
  const valid = validation.valid && profilePresent;
  return {
    output: {
      suite: "masa-artifact-check",
      suiteVersion: MASA_REFERENCE_IMPLEMENTATION_VERSION,
      masaVersion: typeof record.masaVersion === "string" ? record.masaVersion : "undeclared",
      class: className,
      profile,
      status: valid ? "partial" : "failed",
      note: "This command checks one artifact. Run `pnpm conformance` for reference-implementation evidence.",
      diagnostics: validation.diagnostics,
      profilePresent
    },
    code: valid ? 0 : 1
  };
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const [command, ...args] = argv;
    const json = hasFlag(args, "json");
    const positional = positionals(args);

    if (!command || command === "help" || command === "--help" || command === "-h") {
      io.out(usage());
      return 0;
    }

    if (command === "validate") {
      if (positional.length !== 1) throw new UsageError("validate requires one path.");
      const result = await validateCommand(positional[0]!);
      emit(io, result.output, json);
      return result.code;
    }

    if (command === "inspect") {
      if (positional.length !== 1) throw new UsageError("inspect requires one path.");
      const absolute = resolve(positional[0]!);
      const metadata = await stat(absolute);
      const output = metadata.isDirectory() || isZipPath(absolute)
        ? await inspectBundle(absolute)
        : summarizeRecord(await loadRecord(absolute));
      emit(io, output, json);
      return typeof output === "object" && output !== null && "valid" in output && output.valid === false ? 1 : 0;
    }

    if (command === "verify") {
      if (positional.length !== 1) throw new UsageError("verify requires one bundle path.");
      emit(io, await verifyBundle(resolve(positional[0]!)), json);
      return 0;
    }

    if (command === "pack") {
      if (positional.length !== 1) throw new UsageError("pack requires one directory path.");
      const destination = option(args, "out");
      if (!destination) throw new UsageError("pack requires --out.");
      emit(io, await packBundle(resolve(positional[0]!), resolve(destination)), json);
      return 0;
    }

    if (command === "unpack") {
      if (positional.length !== 1) throw new UsageError("unpack requires one archive path.");
      const destination = option(args, "out");
      if (!destination) throw new UsageError("unpack requires --out.");
      emit(io, await unpackBundle(resolve(positional[0]!), resolve(destination)), json);
      return 0;
    }

    if (command === "project-public") {
      if (positional.length !== 1) throw new UsageError("project-public requires one record path.");
      const destination = option(args, "out");
      if (!destination) throw new UsageError("project-public requires --out.");
      const projection = createPublicProjection(await loadRecord(resolve(positional[0]!)));
      const audit = auditPublicRecord(projection.record);
      if (!audit.valid) {
        emit(io, { valid: false, diagnostics: audit.diagnostics, report: projection.report }, json);
        return 1;
      }
      await writeNewJson(destination, projection.record);
      emit(io, { valid: true, diagnostics: audit.diagnostics, report: projection.report, output: resolve(destination) }, json);
      return 0;
    }

    if (command === "audit-public") {
      if (positional.length !== 1) throw new UsageError("audit-public requires one record path.");
      const audit = auditPublicRecord(await loadRecord(resolve(positional[0]!)));
      emit(io, { valid: audit.valid, diagnostics: audit.diagnostics }, json);
      return audit.valid ? 0 : 1;
    }

    if (command === "lineage") {
      if (positional.length !== 2) throw new UsageError("lineage requires a record path and entity ID.");
      const directionValue = option(args, "direction") ?? "both";
      if (!["ancestors", "descendants", "both"].includes(directionValue)) {
        throw new UsageError("--direction must be ancestors, descendants, or both.");
      }
      const maxDepth = integerOption(args, "max-depth", 1, 64);
      const record = await loadRecord(resolve(positional[0]!));
      const validation = validateMatterRecord(record);
      if (!validation.valid) {
        emit(io, { valid: false, diagnostics: validation.diagnostics }, json);
        return 1;
      }
      emit(
        io,
        traceLineage(record, positional[1]!, {
          direction: directionValue as LineageDirection,
          ...(maxDepth === undefined ? {} : { maxDepth })
        }),
        true
      );
      return 0;
    }

    if (command === "conformance") {
      if (positional.length !== 2) throw new UsageError("conformance requires a class and record path.");
      const result = await conformanceCommand(positional[0]!, positional[1]!);
      emit(io, result.output, json);
      return result.code;
    }

    if (command === "process") {
      const [subcommand, target] = positional;
      if (subcommand === "template" && target) {
        const template = processingTemplate(target);
        const destination = option(args, "out");
        if (destination) {
          await writeNewJson(destination, template);
          emit(io, { valid: true, output: resolve(destination) }, json);
          return 0;
        }
        emit(io, template, true);
        return 0;
      }
      if (subcommand === "check" && target) {
        const document = await loadJsonDocument(resolve(target));
        const result = validateDocument("processingRequest", document);
        emit(io, { valid: result.valid, diagnostics: result.diagnostics }, json);
        return result.valid ? 0 : 1;
      }
      throw new UsageError("process requires `template <operation>` or `check <request.json>`.");
    }

    if (command === "schema") {
      const [subcommand, schemaName] = positional;
      if (subcommand === "list" && !schemaName) {
        const names = listEmbeddedSchemas().map(({ fileName }) => fileName);
        emit(io, names, json);
        return 0;
      }
      if (subcommand === "show" && schemaName) {
        const version = option(args, "version") ?? MASA_PROTOCOL_VERSION;
        if (version !== MASA_PROTOCOL_VERSION || !/^[a-z][a-z0-9/-]*(?:\.schema\.json)?$/u.test(schemaName) || schemaName.includes("..")) {
          throw new UsageError(`Only a named MASA ${MASA_PROTOCOL_VERSION} schema may be shown.`);
        }
        const schema = getEmbeddedSchema(schemaName);
        if (schema === undefined) throw new UsageError(`Unknown MASA schema ${schemaName}.`);
        emit(io, schema, true);
        return 0;
      }
      throw new UsageError("schema requires `list` or `show <name>`. ");
    }

    if (command === "capabilities") {
      if (positional.length !== 0) throw new UsageError("capabilities takes no positional arguments.");
      emit(io, referenceCapabilitySet, true);
      return 0;
    }

    throw new UsageError(`Unknown command ${command}.`);
  } catch (error) {
    if (error instanceof UsageError) {
      io.error(error.message);
      io.error(usage());
      return 2;
    }
    if (error instanceof BundleValidationError) {
      emit(io, { valid: false, diagnostics: error.inspection.diagnostics }, true);
      return 1;
    }
    const code = error instanceof Error && "code" in error ? String(error.code) : "MASA_IO_FAILURE";
    io.error(stableStringify({ code, message: error instanceof Error ? error.message : "Unknown failure" }, 2));
    return code === "MASA_UNSUPPORTED_VERSION" ? 4 : 3;
  }
}

/**
 * Installed bins are symlinks into the package; Node realpaths the main
 * module but not argv[1], so both sides must be canonicalized before they
 * are compared. Otherwise the installed command silently does nothing.
 */
function executedScriptHref(argvPath: string | undefined): string | undefined {
  if (!argvPath) return undefined;
  try {
    return pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return pathToFileURL(argvPath).href;
  }
}

const executedPath = executedScriptHref(process.argv[1]);
if (executedPath === import.meta.url) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
