import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  parseJsonStrict,
  StrictJsonError,
  type BundleManifest,
  type Diagnostic
} from "@sonicfield/masa";
import { validateBundleManifest } from "@sonicfield/masa-validator";
import {
  BundleOperationError,
  DEFAULT_BUNDLE_LIMITS,
  type BundleLimits,
  type BundleOptions
} from "./types.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const DRIVE_PREFIX = /^[A-Za-z]:/u;

export interface ManifestFileView {
  readonly path: string;
  readonly role: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly recordRef?: string;
}

export interface ValidatedManifest {
  readonly manifest: BundleManifest;
  readonly files: readonly ManifestFileView[];
  readonly diagnostics: readonly Diagnostic[];
}

export function diagnostic(
  code: string,
  message: string,
  instancePath = "",
  remediation = "Inspect the named bundle structure and create a corrected derivative without mutating the source."
): Diagnostic {
  return {
    code,
    severity: "error",
    instancePath,
    message,
    schemaPath: "",
    remediation
  };
}

export function sortDiagnostics(values: readonly Diagnostic[]): Diagnostic[] {
  return [...values].sort((left, right) =>
    [left.instancePath, left.code, left.message].join("\u0000").localeCompare(
      [right.instancePath, right.code, right.message].join("\u0000"),
      "en"
    )
  );
}

export function resolveLimits(options: BundleOptions = {}): BundleLimits {
  const requested = options.limits ?? {};
  const resolved: BundleLimits = {
    ...DEFAULT_BUNDLE_LIMITS,
    ...requested
  };

  for (const key of Object.keys(DEFAULT_BUNDLE_LIMITS) as (keyof BundleLimits)[]) {
    const value = resolved[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BundleOperationError(
        "MASA_BUNDLE_LIMIT_INVALID",
        "Bundle limits must be positive safe integers."
      );
    }
    if (value > DEFAULT_BUNDLE_LIMITS[key] && options.allowRaisedLimits !== true) {
      throw new BundleOperationError(
        "MASA_BUNDLE_LIMIT_AUTHORITY_REQUIRED",
        "Raising a normative bundle limit requires explicit host authority."
      );
    }
  }

  return resolved;
}

export function assertSafeBundlePath(value: string, limits: BundleLimits): void {
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > limits.maxPathBytes) {
    throw new BundleOperationError(
      "MASA_BUNDLE_PATH_INVALID",
      "A bundle path is empty or exceeds the configured UTF-8 byte limit."
    );
  }
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    DRIVE_PREFIX.test(value) ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new BundleOperationError(
      "MASA_BUNDLE_PATH_INVALID",
      "A bundle path contains a forbidden absolute, platform-specific, or control form."
    );
  }
  if (value.normalize("NFC") !== value) {
    throw new BundleOperationError(
      "MASA_BUNDLE_PATH_NOT_NFC",
      "Every bundle path must already be NFC-normalized."
    );
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new BundleOperationError(
      "MASA_BUNDLE_PATH_TRAVERSAL",
      "A bundle path contains an empty, current-directory, or parent-directory segment."
    );
  }
}

function collisionKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function compareBundlePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertNoPathCollisions(
  paths: readonly string[],
  filePaths: readonly string[] = paths
): void {
  const seen = new Set<string>();
  for (const value of paths) {
    const key = collisionKey(value);
    if (seen.has(key)) {
      throw new BundleOperationError(
        "MASA_BUNDLE_PATH_COLLISION",
        "The bundle contains duplicate, case-colliding, or Unicode-colliding paths."
      );
    }
    seen.add(key);
  }

  const files = new Set(filePaths.map(collisionKey));
  for (const value of filePaths) {
    const segments = value.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = collisionKey(segments.slice(0, index).join("/"));
      if (files.has(ancestor)) {
        throw new BundleOperationError(
          "MASA_BUNDLE_PATH_COLLISION",
          "A file path is also used as the parent of another file."
        );
      }
    }
  }
}

export function parseAndValidateManifest(buffer: Buffer): ValidatedManifest {
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    parsed = parseJsonStrict(text);
  } catch (error) {
    return {
      manifest: {} as BundleManifest,
      files: [],
      diagnostics: [
        strictJsonDiagnostic(
          error,
          "MASA_BUNDLE_MANIFEST_INVALID_JSON",
          "manifest.json must contain one duplicate-key-free UTF-8 JSON object.",
          "/manifest"
        )
      ]
    };
  }

  const result = validateBundleManifest(parsed);
  if (!result.valid || result.value === undefined) {
    return {
      manifest: {} as BundleManifest,
      files: [],
      diagnostics: result.diagnostics
    };
  }

  const candidate = result.value as BundleManifest & {
    readonly files: readonly ManifestFileView[];
  };
  return {
    manifest: result.value,
    files: candidate.files,
    diagnostics: result.diagnostics
  };
}

export function verifyManifestPaths(
  files: readonly ManifestFileView[],
  actualFilePaths: readonly string[],
  limits: BundleLimits
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declaredPaths: string[] = [];

  try {
    for (const file of files) {
      assertSafeBundlePath(file.path, limits);
      if (file.path === "manifest.json") {
        throw new BundleOperationError(
          "MASA_BUNDLE_MANIFEST_SELF_LISTED",
          "manifest.json must not list itself."
        );
      }
      declaredPaths.push(file.path);
    }
    assertNoPathCollisions(declaredPaths);
  } catch (error) {
    diagnostics.push(asDiagnostic(error, "/manifest/files"));
    return diagnostics;
  }

  const actual = [...actualFilePaths]
    .filter((value) => value !== "manifest.json")
    .sort(compareBundlePaths);
  const declared = [...declaredPaths].sort(compareBundlePaths);
  if (actual.length !== declared.length || actual.some((value, index) => value !== declared[index])) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_COVERAGE_MISMATCH",
        "The actual file set must exactly equal the manifest file set plus manifest.json.",
        "/manifest/files"
      )
    );
  }
  return diagnostics;
}

export function asDiagnostic(error: unknown, instancePath = ""): Diagnostic {
  if (error instanceof BundleOperationError) {
    return diagnostic(error.code, error.message, instancePath);
  }
  return diagnostic(
    "MASA_BUNDLE_IO_ERROR",
    "The bundle could not be read safely.",
    instancePath,
    "Confirm that the input exists, is readable, and is not changing during inspection."
  );
}

export function sha256Hex(): ReturnType<typeof createHash> {
  return createHash("sha256");
}

export function strictJsonDiagnostic(
  error: unknown,
  fallbackCode: string,
  message: string,
  instancePath: string
): Diagnostic {
  if (error instanceof StrictJsonError) {
    return diagnostic(error.code, message, `${instancePath}${error.instancePath}`);
  }
  return diagnostic(fallbackCode, message, instancePath);
}
