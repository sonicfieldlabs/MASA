import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectDirectoryBundle } from "./directory.js";
import { asDiagnostic, resolveLimits, sortDiagnostics } from "./safety.js";
import {
  BundleOperationError,
  BundleValidationError,
  type BundleInspection,
  type BundleOptions,
  type PackBundleOptions,
  type UnpackBundleOptions
} from "./types.js";
import { inspectZipBundle, packDirectoryBundle, unpackZipBundle } from "./zip.js";

export {
  BundleOperationError,
  BundleValidationError,
  DEFAULT_BUNDLE_LIMITS
} from "./types.js";
export type {
  BundleEntryInspection,
  BundleFormat,
  BundleInspection,
  BundleLimits,
  BundleOptions,
  PackBundleOptions,
  UnpackBundleOptions
} from "./types.js";

export async function inspectBundle(
  source: string,
  options: BundleOptions = {}
): Promise<BundleInspection> {
  const limits = resolveLimits(options);
  try {
    const state = await lstat(resolve(source));
    if (state.isSymbolicLink()) {
      throw new BundleOperationError(
        "MASA_BUNDLE_SYMLINK",
        "A bundle source may not be a symbolic link."
      );
    }
    if (state.isDirectory()) {
      return await inspectDirectoryBundle(source, limits);
    }
    if (state.isFile()) {
      return await inspectZipBundle(source, limits);
    }
    throw new BundleOperationError(
      "MASA_BUNDLE_SOURCE_INVALID",
      "A bundle source must be one ordinary directory or ZIP file."
    );
  } catch (error) {
    return {
      valid: false,
      format: source.toLocaleLowerCase("en-US").endsWith(".zip") ? "zip" : "directory",
      entries: [],
      diagnostics: sortDiagnostics([asDiagnostic(error, "/source")]),
      totalUncompressedBytes: 0
    };
  }
}

export async function verifyBundle(
  source: string,
  options: BundleOptions = {}
): Promise<BundleInspection> {
  const inspected = await inspectBundle(source, options);
  if (!inspected.valid) {
    throw new BundleValidationError("MASA bundle verification failed.", inspected);
  }
  return inspected;
}

export async function packBundle(
  sourceDirectory: string,
  destinationZip: string,
  options: PackBundleOptions = {}
): Promise<BundleInspection> {
  const limits = resolveLimits(options);
  return await packDirectoryBundle(sourceDirectory, destinationZip, limits, options);
}

export async function unpackBundle(
  sourceZip: string,
  destinationDirectory: string,
  options: UnpackBundleOptions = {}
): Promise<BundleInspection> {
  const limits = resolveLimits(options);
  return await unpackZipBundle(sourceZip, destinationDirectory, limits);
}
