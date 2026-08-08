import type { Diagnostic, DiagnosticSeverity } from "@sonicfield/masa";

export function diagnostic(
  code: string,
  instancePath: string,
  message: string,
  remediation: string,
  severity: DiagnosticSeverity = "error",
  schemaPath?: string,
): Diagnostic {
  return {
    code,
    severity,
    instancePath,
    message,
    remediation,
    ...(schemaPath === undefined ? {} : { schemaPath }),
  };
}
