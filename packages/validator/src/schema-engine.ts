import type { Diagnostic, ValidationResult } from "@sonicfield/masa";
import { hasErrorDiagnostics, sortDiagnostics } from "@sonicfield/masa";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { FormatsPlugin } from "ajv-formats";

import { diagnostic } from "./diagnostic.js";
import { embeddedSchemas } from "./generated/schemas.js";

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  coerceTypes: false,
  messages: true,
  removeAdditional: false,
  strict: true,
  strictRequired: false,
  strictTypes: false,
  useDefaults: false,
  validateFormats: true,
});

// ajv-formats is CommonJS and TypeScript's NodeNext interpretation exposes
// its default import as a module namespace. Node presents the callable module
// as the ESM default at runtime, so keep the interop normalization local.
const addFormats = addFormatsModule as unknown as FormatsPlugin;
addFormats(ajv, {
  formats: ["date-time", "duration", "hostname", "ipv4", "ipv6", "uri", "uri-reference", "uuid"],
  keywords: false,
});

for (const schema of embeddedSchemas) {
  ajv.addSchema(schema.document, schema.id);
}

export function validateStructure<T>(
  schemaId: string,
  value: unknown,
  code = "MASA_SCHEMA_INVALID",
): ValidationResult<T> {
  const validator = getValidator(schemaId);
  const structurallyValid = validator(value) as boolean;
  const diagnostics = structurallyValid
    ? []
    : sortDiagnostics((validator.errors ?? []).map((error) => schemaDiagnostic(error, code)));

  return {
    valid: !hasErrorDiagnostics(diagnostics),
    diagnostics,
    ...(structurallyValid ? { value: value as T } : {}),
  };
}

function getValidator(schemaId: string): ValidateFunction {
  const validator = ajv.getSchema(schemaId);
  if (validator === undefined) {
    throw new Error(`MASA_SCHEMA_NOT_EMBEDDED: ${schemaId}`);
  }
  return validator;
}

function schemaDiagnostic(error: ErrorObject, code: string): Diagnostic {
  return diagnostic(
    code,
    error.instancePath,
    structuralMessage(error.keyword),
    structuralRemediation(error.keyword),
    "error",
    error.schemaPath,
  );
}

function structuralMessage(keyword: string): string {
  switch (keyword) {
    case "additionalProperties":
      return "An object contains a property that is not defined by the schema";
    case "const":
      return "A value does not match the required protocol constant";
    case "contains":
      return "An array does not contain its required protocol member";
    case "enum":
      return "A value is outside the controlled protocol vocabulary";
    case "format":
      return "A string does not match the required format";
    case "pattern":
      return "A string does not match the required protocol pattern";
    case "required":
      return "A required property is missing";
    case "type":
      return "A value has the wrong JSON type";
    case "uniqueItems":
      return "An array contains duplicate members";
    default:
      return "A value does not satisfy the normative JSON Schema";
  }
}

function structuralRemediation(keyword: string): string {
  switch (keyword) {
    case "additionalProperties":
      return "Move extension data into a namespaced extensions entry or remove the unknown property";
    case "const":
      return "Use the exact versioned constant required by the declared MASA schema";
    case "contains":
      return "Add the required profile member or required typed entry to the array";
    case "enum":
      return "Use a value from the versioned MASA vocabulary or a permitted namespaced extension";
    case "format":
    case "pattern":
      return "Replace the string with one matching the versioned schema constraint";
    case "required":
      return "Add the required property with an explicit qualified state when the value is unknown or unavailable";
    case "type":
      return "Encode the value using the JSON type required by the versioned schema";
    case "uniqueItems":
      return "Remove duplicate array members while preserving distinct attributable accounts";
    default:
      return "Compare the instance with the exact versioned schema and correct the reported location";
  }
}
