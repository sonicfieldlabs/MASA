import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import {
  generateId,
  indexRecord,
  parseJsonStrict,
  summarizeRecord,
  traceLineage,
  type Diagnostic,
  type LineageDirection,
  type MatterRecord
} from "@sonicfield/masa";
import { inspectBundle } from "@sonicfield/masa-bundle";
import { auditPublicRecord, validateDocument, validateMatterRecord } from "@sonicfield/masa-validator";
import { resolveReadablePath } from "./root-policy.js";

const MAX_JSON_BYTES = 16 * 1024 * 1024;

export interface McpOperationResult {
  status: "completed" | "failed" | "refused";
  valid: boolean;
  diagnostics: readonly Diagnostic[];
  data?: unknown;
}

function failure(code: string, message: string, status: "failed" | "refused" = "failed"): McpOperationResult {
  return {
    status,
    valid: false,
    diagnostics: [
      {
        code,
        severity: "error",
        instancePath: "",
        schemaPath: "",
        message,
        remediation: "Correct the input or request a path within an approved local root."
      }
    ]
  };
}

/**
 * Convert an arbitrary error into a redacted tool failure. Only messages
 * from MASA-coded errors are forwarded; operating-system errors keep their
 * errno code but never their message, which embeds absolute resolved paths.
 */
function sanitizedFailure(error: unknown): McpOperationResult {
  const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "MASA_INPUT_INVALID";
  const message = error instanceof Error && code.startsWith("MASA_")
    ? error.message
    : "The input could not be read.";
  return failure(code, message, code === "MASA_PATH_ESCAPE" ? "refused" : "failed");
}

function inputError(message: string): Error {
  return Object.assign(new Error(message), { code: "MASA_INPUT_INVALID" });
}

async function loadRecord(input: string, roots: readonly string[]): Promise<MatterRecord> {
  const path = await resolveReadablePath(input, roots);
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_JSON_BYTES) {
      throw inputError("The record must be a regular JSON file no larger than 16 MiB.");
    }
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_JSON_BYTES) {
      throw inputError("The record must be a regular JSON file no larger than 16 MiB.");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw inputError("The record file is not valid UTF-8.");
    }
    return parseJsonStrict(text) as MatterRecord;
  } finally {
    await handle.close();
  }
}

export async function validateTarget(input: string, roots: readonly string[]): Promise<McpOperationResult> {
  try {
    const path = await resolveReadablePath(input, roots);
    const metadata = await stat(path);
    if (metadata.isDirectory() || extname(path).toLowerCase() === ".zip") {
      const inspection = await inspectBundle(path);
      return {
        status: "completed",
        valid: inspection.valid,
        diagnostics: inspection.diagnostics,
        data: { format: inspection.format, entries: inspection.entries.length }
      };
    }
    const record = await loadRecord(path, roots);
    const validation = validateMatterRecord(record);
    return {
      status: "completed",
      valid: validation.valid,
      diagnostics: validation.diagnostics,
      data: validation.valid ? summarizeRecord(record) : undefined
    };
  } catch (error) {
    return sanitizedFailure(error);
  }
}

export async function inspectTarget(input: string, roots: readonly string[]): Promise<McpOperationResult> {
  const result = await validateTarget(input, roots);
  return result;
}

export async function traceLineageTarget(
  input: string,
  entityId: string,
  roots: readonly string[],
  options: { readonly direction?: LineageDirection; readonly maxDepth?: number } = {}
): Promise<McpOperationResult> {
  try {
    const record = await loadRecord(input, roots);
    const validation = validateMatterRecord(record);
    if (!validation.valid) {
      return { status: "completed", valid: false, diagnostics: validation.diagnostics };
    }
    const trace = traceLineage(record, entityId, options);
    return {
      status: "completed",
      valid: true,
      diagnostics: [],
      data: trace
    };
  } catch (error) {
    return sanitizedFailure(error);
  }
}

export async function auditPublicTarget(input: string, roots: readonly string[]): Promise<McpOperationResult> {
  try {
    const record = await loadRecord(input, roots);
    const validation = validateMatterRecord(record);
    const audit = auditPublicRecord(record);
    const diagnostics = uniqueDiagnostics([...validation.diagnostics, ...audit.diagnostics]);
    return {
      status: "completed",
      valid: validation.valid && audit.valid,
      diagnostics,
      data: { audited: true }
    };
  } catch (error) {
    return sanitizedFailure(error);
  }
}

export const PROCESSING_OPERATION_TYPES = [
  "matter.granulate",
  "matter.extract",
  "matter.reduce",
  "matter.fragment",
  "matter.timestretch",
  "matter.pitchshift"
] as const;

type ProcessingOperationType = (typeof PROCESSING_OPERATION_TYPES)[number];

export interface PlanProcessingInput {
  readonly operationType: ProcessingOperationType;
  readonly parameters: Record<string, unknown>;
  readonly inputs: readonly string[];
  readonly path?: string;
  readonly determinism?: "require-deterministic" | "require-seeded" | "accept-nondeterministic";
  readonly maxOutputs?: number;
}

/**
 * Compose and validate one engine-neutral processing request. This performs
 * no signal processing and writes nothing; when a record path is supplied,
 * input references are resolved against that record's representations.
 */
export async function planProcessingTarget(
  input: PlanProcessingInput,
  roots: readonly string[]
): Promise<McpOperationResult> {
  try {
    const request = {
      requestType: "masa-processing-request",
      requestVersion: "0.1.0",
      masaVersion: "0.1.0",
      id: generateId(),
      createdAt: new Date().toISOString(),
      operationType: input.operationType,
      inputs: [...input.inputs],
      parameters: input.parameters,
      determinism: input.determinism ?? "accept-nondeterministic",
      policyRefs: [],
      outputContract: { roles: ["derivative"], maxOutputs: input.maxOutputs ?? 16 },
      extensions: {}
    };
    const validation = validateDocument("processingRequest", request);
    const diagnostics: Diagnostic[] = [...validation.diagnostics];

    if (input.path !== undefined) {
      const record = await loadRecord(input.path, roots);
      const index = indexRecord(record);
      input.inputs.forEach((reference, position) => {
        const entity = index.byId.get(reference);
        if (entity === undefined || entity.collection !== "representations") {
          diagnostics.push({
            code: "MASA_UNRESOLVED_REF",
            severity: "error",
            instancePath: `/inputs/${position}`,
            schemaPath: "",
            message: "A processing input does not resolve to a representation in the target record",
            remediation: "Reference an existing representation identifier from the target record."
          });
        }
      });
    }

    const valid = !diagnostics.some((item) => item.severity === "error");
    return {
      status: "completed",
      valid,
      diagnostics: uniqueDiagnostics(diagnostics),
      data: valid ? { request } : undefined
    };
  } catch (error) {
    return sanitizedFailure(error);
  }
}

function uniqueDiagnostics(values: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = [value.code, value.severity, value.instancePath, value.schemaPath ?? "", value.message].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
