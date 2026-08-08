export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A stable, value-redacted diagnostic. Messages describe the rule but never
 * interpolate the rejected value, which may be private or secret material.
 */
export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  instancePath: string;
  message: string;
  remediation: string;
  schemaPath?: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  diagnostics: Diagnostic[];
  value?: T;
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.instancePath.localeCompare(right.instancePath, "en") ||
    left.code.localeCompare(right.code, "en") ||
    (left.schemaPath ?? "").localeCompare(right.schemaPath ?? "", "en") ||
    left.message.localeCompare(right.message, "en")
  );
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
}

export function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
