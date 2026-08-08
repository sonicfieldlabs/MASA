import type {
  BundleManifest,
  Capability,
  CapabilitySet,
  Diagnostic,
  MatterRecord,
  OperationReceipt,
  ValidationResult,
} from "@sonicfield/masa";
import {
  asJsonArray,
  cloneJson,
  hasErrorDiagnostics,
  isJsonObject,
  readString,
  sortDiagnostics,
} from "@sonicfield/masa";

import { diagnostic } from "./diagnostic.js";
import { embeddedSchemas, findEmbeddedSchema, SCHEMA_IDS } from "./generated/schemas.js";
import { auditPublicSafety } from "./public-audit.js";
import { validateStructure } from "./schema-engine.js";
import { auditEventReceiptSemantics, auditMatterRecordSemantics } from "./semantics.js";

export { SCHEMA_IDS } from "./generated/schemas.js";
export { auditPublicSafety } from "./public-audit.js";
export { auditEventReceiptSemantics, auditMatterRecordSemantics } from "./semantics.js";

const PROFILE_SCHEMA_IDS: Readonly<Record<string, string>> = {
  core: SCHEMA_IDS.profileCore,
  audio: SCHEMA_IDS.profileAudio,
  listening: SCHEMA_IDS.profileListening,
  analysis: SCHEMA_IDS.profileAnalysis,
  transformation: SCHEMA_IDS.profileTransformation,
  generation: SCHEMA_IDS.profileGeneration,
  processing: SCHEMA_IDS.profileProcessing,
  mapping: SCHEMA_IDS.profileMapping,
  agent: SCHEMA_IDS.profileAgent,
  publication: SCHEMA_IDS.profilePublication,
};

export interface EmbeddedSchemaDescriptor {
  readonly fileName: string;
  readonly id: string;
}

/** List the offline schemas carried by the package without exposing mutable validator state. */
export function listEmbeddedSchemas(): EmbeddedSchemaDescriptor[] {
  return embeddedSchemas.map(({ fileName, id }) => ({ fileName, id }));
}

/** Return an isolated copy of one embedded schema by generated key or absolute schema ID. */
export function getEmbeddedSchema(nameOrId: string): Record<string, unknown> | undefined {
  const id = Object.prototype.hasOwnProperty.call(SCHEMA_IDS, nameOrId)
    ? (SCHEMA_IDS as Readonly<Record<string, string>>)[nameOrId]
    : nameOrId;
  if (id === undefined) return undefined;
  const normalizedFileName = nameOrId.endsWith(".schema.json")
    ? nameOrId
    : `${nameOrId}.schema.json`;
  const schema = findEmbeddedSchema(id) ?? embeddedSchemas.find(
    ({ fileName }) => fileName === normalizedFileName,
  );
  return schema === undefined ? undefined : cloneJson(schema.document);
}

export function validateMatterRecord(value: unknown): ValidationResult<MatterRecord> {
  const structural = validateStructure<MatterRecord>(SCHEMA_IDS.matterRecord, value);
  if (!structural.valid || structural.value === undefined) {
    return withVersionDiagnostic(structural, value);
  }

  const diagnostics: Diagnostic[] = [];
  const raw = structural.value as unknown as Record<string, unknown>;
  for (const profile of asJsonArray(raw.profiles)) {
    if (typeof profile !== "string") {
      continue;
    }
    const schemaId = Object.hasOwn(PROFILE_SCHEMA_IDS, profile)
      ? PROFILE_SCHEMA_IDS[profile]
      : undefined;
    if (schemaId === undefined) {
      diagnostics.push(
        diagnostic(
          "MASA_PROFILE_MISMATCH",
          "/profiles",
          "The record declares a profile unsupported by this protocol version",
          "Use a profile defined by MASA 0.1.0 or migrate the record through an attributable operation",
        ),
      );
      continue;
    }
    diagnostics.push(
      ...validateStructure<MatterRecord>(schemaId, value, "MASA_PROFILE_MISMATCH").diagnostics,
    );
  }
  diagnostics.push(...auditMatterRecordSemantics(structural.value));
  return result(structural.value, diagnostics);
}

export function validateOperationReceipt(value: unknown): ValidationResult<OperationReceipt> {
  const structural = validateStructure<OperationReceipt>(SCHEMA_IDS.event, value);
  if (!structural.valid || structural.value === undefined) {
    return structural;
  }
  return result(structural.value, auditEventReceiptSemantics(structural.value));
}

export function validateBundleManifest(value: unknown): ValidationResult<BundleManifest> {
  const structural = validateStructure<BundleManifest>(SCHEMA_IDS.manifest, value);
  if (!structural.valid || structural.value === undefined) {
    return withVersionDiagnostic(structural, value);
  }
  return result(structural.value, auditManifestSemantics(structural.value));
}

export function validateCapability(value: unknown): ValidationResult<Capability> {
  return validateStructure<Capability>(SCHEMA_IDS.capability, value);
}

export function validateCapabilitySet(value: unknown): ValidationResult<CapabilitySet> {
  return validateStructure<CapabilitySet>(SCHEMA_IDS.capabilitySet, value);
}

export function validateDocument<T = unknown>(
  schemaNameOrId: string,
  value: unknown,
): ValidationResult<T> {
  const schemaId = Object.prototype.hasOwnProperty.call(SCHEMA_IDS, schemaNameOrId)
    ? (SCHEMA_IDS as Readonly<Record<string, string>>)[schemaNameOrId]
    : schemaNameOrId;
  if (schemaId === undefined) {
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "MASA_SCHEMA_UNKNOWN",
          "",
          "The requested embedded schema is unknown",
          "Use a key from SCHEMA_IDS or the exact $id of an embedded MASA 0.1.0 schema",
        ),
      ],
    };
  }
  try {
    return validateStructure<T>(schemaId, value);
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "MASA_SCHEMA_UNKNOWN",
          "",
          "The requested embedded schema is unknown",
          "Use a key from SCHEMA_IDS or the exact $id of an embedded MASA 0.1.0 schema",
        ),
      ],
    };
  }
}

/** Structural + semantic + publication-safety validation for an emitted record. */
export function auditPublicRecord(value: unknown): ValidationResult<MatterRecord> {
  const structural = validateStructure<MatterRecord>(SCHEMA_IDS.publicRecord, value);
  if (!structural.valid || structural.value === undefined) {
    return withVersionDiagnostic(structural, value);
  }
  return result(structural.value, [
    ...auditMatterRecordSemantics(structural.value),
    ...auditPublicSafety(structural.value),
  ]);
}

function auditManifestSemantics(manifest: BundleManifest): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const raw = manifest as unknown as Record<string, unknown>;
  const recordIds = new Set<string>();
  const recordPaths = new Set<string>();
  const filePaths = new Set<string>();

  asJsonArray(raw.records).forEach((record, index) => {
    const id = readString(record, "id");
    const path = readString(record, "path");
    if (id !== undefined && recordIds.has(id)) {
      diagnostics.push(
        diagnostic(
          "MASA_DUPLICATE_ID",
          `/records/${index}/id`,
          "A bundle manifest repeats a record identifier",
          "Retain one record entry per identifier or assign the distinct record a new identifier",
        ),
      );
    }
    if (id !== undefined) {
      recordIds.add(id);
    }
    if (path !== undefined && recordPaths.has(path)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_DUPLICATE_PATH",
          `/records/${index}/path`,
          "A bundle manifest repeats a record path",
          "Assign each record one unique normalized bundle-relative path",
        ),
      );
    }
    if (path !== undefined) {
      recordPaths.add(path);
    }
  });

  asJsonArray(raw.files).forEach((file, index) => {
    const path = readString(file, "path");
    if (path === "manifest.json") {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_MANIFEST_SELF_REFERENCE",
          `/files/${index}/path`,
          "The bundle manifest lists itself as a content entry",
          "Remove manifest.json from files; the manifest cannot safely contain its own digest",
        ),
      );
    }
    if (path !== undefined && filePaths.has(path)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_DUPLICATE_PATH",
          `/files/${index}/path`,
          "A bundle file path appears more than once",
          "Reject duplicate ZIP entries and keep one manifest entry for each normalized path",
        ),
      );
    }
    if (path !== undefined) {
      filePaths.add(path);
    }
    const recordRef = readString(file, "recordRef");
    if (recordRef !== undefined && !recordIds.has(recordRef)) {
      diagnostics.push(
        diagnostic(
          "MASA_UNRESOLVED_REF",
          `/files/${index}/recordRef`,
          "A file entry references a record absent from the manifest",
          "Add the record entry or remove the incorrect recordRef",
        ),
      );
    }
  });

  for (const recordPath of [...recordPaths].sort()) {
    const file = asJsonArray(raw.files).find(
      (candidate) => readString(candidate, "path") === recordPath && readString(candidate, "role") === "record",
    );
    if (file === undefined) {
      diagnostics.push(
        diagnostic(
          "MASA_UNRESOLVED_REF",
          "/records",
          "A declared record path has no corresponding record file entry",
          "Add a files entry with role record, size, digest, media type, and disclosure",
        ),
      );
    }
  }
  return sortDiagnostics(diagnostics);
}

function withVersionDiagnostic<T>(
  validation: ValidationResult<T>,
  value: unknown,
): ValidationResult<T> {
  if (!isJsonObject(value) || value.masaVersion === undefined || value.masaVersion === "0.1.0") {
    return validation;
  }
  return {
    valid: false,
    diagnostics: sortDiagnostics([
      ...validation.diagnostics,
      diagnostic(
        "MASA_UNSUPPORTED_VERSION",
        "/masaVersion",
        "The document declares a MASA version unsupported by this validator",
        "Use the validator for the exact declared version or run an attributable migration",
      ),
    ]),
  };
}

function result<T>(value: T, diagnostics: readonly Diagnostic[]): ValidationResult<T> {
  const sorted = dedupeDiagnostics(sortDiagnostics(diagnostics));
  const valid = !hasErrorDiagnostics(sorted);
  return {
    valid,
    diagnostics: sorted,
    ...(valid ? { value } : {}),
  };
}

/** Drop byte-identical diagnostics produced by overlapping audit phases. */
function dedupeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = [item.code, item.severity, item.instancePath, item.schemaPath ?? "", item.message].join("\x00");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
