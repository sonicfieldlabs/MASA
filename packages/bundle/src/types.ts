import type { BundleManifest, Diagnostic } from "@sonicfield/masa";

export interface BundleLimits {
  readonly maxEntries: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxManifestBytes: number;
  readonly maxJsonRecordBytes: number;
  readonly maxNdjsonLineBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxPathBytes: number;
}

export const DEFAULT_BUNDLE_LIMITS: Readonly<BundleLimits> = Object.freeze({
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxEntryUncompressedBytes: 512 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxJsonRecordBytes: 16 * 1024 * 1024,
  maxNdjsonLineBytes: 2 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxPathBytes: 1024
});

export interface BundleOptions {
  readonly limits?: Partial<BundleLimits>;
  /** Raising a normative default is a host authority decision. */
  readonly allowRaisedLimits?: boolean;
}

export interface PackBundleOptions extends BundleOptions {
  readonly compressionLevel?: number;
}

export type UnpackBundleOptions = BundleOptions;

export type BundleFormat = "directory" | "zip";

export interface BundleEntryInspection {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly byteLength: number;
  readonly compressedByteLength?: number;
  readonly sha256?: string;
  readonly role?: string;
  readonly mediaType?: string;
}

export interface BundleInspection {
  readonly valid: boolean;
  readonly format: BundleFormat;
  readonly manifest?: BundleManifest;
  readonly entries: readonly BundleEntryInspection[];
  readonly diagnostics: readonly Diagnostic[];
  readonly totalUncompressedBytes: number;
}

export class BundleValidationError extends Error {
  readonly inspection: BundleInspection;

  constructor(message: string, inspection: BundleInspection) {
    super(message);
    this.name = "BundleValidationError";
    this.inspection = inspection;
  }
}

export class BundleOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BundleOperationError";
    this.code = code;
  }
}
