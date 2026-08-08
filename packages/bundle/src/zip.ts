import { createWriteStream } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  unlink
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type {
  BundleManifest,
  Diagnostic
} from "@sonicfield/masa";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";
import {
  consumeReadable,
  NdjsonReceiptValidator,
  validateRecordBuffer,
  type ReceiptClosureView
} from "./content.js";
import {
  manifestFilePath,
  recordClosureView,
  verifyContentIntegrity,
  verifyExternalHistoryClosure,
  verifyManifestSemantics,
  verifyRecordReferences,
  inspectDirectoryBundle,
  type RecordClosureView
} from "./directory.js";
import {
  asDiagnostic,
  assertNoPathCollisions,
  assertSafeBundlePath,
  compareBundlePaths,
  diagnostic,
  parseAndValidateManifest,
  sha256Hex,
  sortDiagnostics,
  verifyManifestPaths,
  type ManifestFileView
} from "./safety.js";
import {
  BundleOperationError,
  BundleValidationError,
  type BundleEntryInspection,
  type BundleInspection,
  type BundleLimits,
  type PackBundleOptions
} from "./types.js";

const ZIP_UNIX_HOST = 3;
const ZIP_OS_X_HOST = 19;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;
const FIXED_ZIP_TIME = new Date("1980-01-01T00:00:00.000Z");

interface ZipEntryView {
  readonly path: string;
  readonly archivePath: string;
  readonly kind: "file" | "directory";
  readonly byteLength: number;
  readonly compressedByteLength: number;
  readonly index: number;
}

export async function inspectZipBundle(
  sourceZip: string,
  limits: BundleLimits
): Promise<BundleInspection> {
  const diagnostics: Diagnostic[] = [];
  let zipEntries: ZipEntryView[] = [];
  let totalUncompressedBytes = 0;

  try {
    await assertOrdinaryZipSource(sourceZip);
    const listed = await listZipEntries(sourceZip, limits);
    zipEntries = listed.entries;
    totalUncompressedBytes = listed.totalUncompressedBytes;
  } catch (error) {
    diagnostics.push(asDiagnostic(error, "/entries"));
    return zipInspection(undefined, zipEntries, diagnostics, totalUncompressedBytes);
  }

  const files = zipEntries.filter((entry) => entry.kind === "file");
  const manifestEntry = files.find((entry) => entry.path === "manifest.json");
  if (manifestEntry === undefined) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_MANIFEST_MISSING",
        "A MASA ZIP bundle must contain manifest.json at its root.",
        "/manifest"
      )
    );
    return zipInspection(undefined, zipEntries, diagnostics, totalUncompressedBytes);
  }
  if (manifestEntry.byteLength > limits.maxManifestBytes) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_MANIFEST_LIMIT",
        "manifest.json exceeds the configured byte limit.",
        "/manifest"
      )
    );
    return zipInspection(undefined, zipEntries, diagnostics, totalUncompressedBytes);
  }

  let manifestBuffer: Buffer;
  try {
    manifestBuffer = await readZipEntryBuffer(
      sourceZip,
      "manifest.json",
      limits.maxManifestBytes,
      "MASA_BUNDLE_MANIFEST_LIMIT"
    );
  } catch (error) {
    diagnostics.push(asDiagnostic(error, "/manifest"));
    return zipInspection(undefined, zipEntries, diagnostics, totalUncompressedBytes);
  }
  const manifestDigest = sha256Hex().update(manifestBuffer).digest("hex");
  const validatedManifest = parseAndValidateManifest(manifestBuffer);
  diagnostics.push(...validatedManifest.diagnostics);
  if (validatedManifest.diagnostics.some((value) => value.severity === "error")) {
    return zipInspection(undefined, zipEntries, diagnostics, totalUncompressedBytes);
  }

  const manifest = validatedManifest.manifest;
  const manifestFiles = validatedManifest.files;
  diagnostics.push(
    ...verifyManifestPaths(
      manifestFiles,
      files.map((entry) => entry.path),
      limits
    ),
    ...verifyManifestSemantics(manifest, manifestFiles),
    ...verifyDirectoryEntryCoverage(zipEntries, manifestFiles)
  );
  if (diagnostics.some((value) => value.severity === "error")) {
    return zipInspection(
      manifest,
      zipEntries,
      diagnostics,
      totalUncompressedBytes,
      manifestFiles
    );
  }

  try {
    const scanned = await scanZipContents(
      sourceZip,
      manifest,
      manifestFiles,
      manifestDigest,
      limits
    );
    diagnostics.push(...scanned.diagnostics);
    return {
      valid: !diagnostics.some((value) => value.severity === "error"),
      format: "zip",
      manifest,
      entries: scanned.entries,
      diagnostics: sortDiagnostics(diagnostics),
      totalUncompressedBytes
    };
  } catch (error) {
    diagnostics.push(asDiagnostic(error, "/entries"));
    return zipInspection(
      manifest,
      zipEntries,
      diagnostics,
      totalUncompressedBytes,
      manifestFiles
    );
  }
}

export async function packDirectoryBundle(
  sourceDirectory: string,
  destinationZip: string,
  limits: BundleLimits,
  options: PackBundleOptions = {}
): Promise<BundleInspection> {
  assertDestinationOutsideSource(sourceDirectory, destinationZip);
  const sourceInspection = await inspectDirectoryBundle(sourceDirectory, limits);
  if (!sourceInspection.valid) {
    throw new BundleValidationError("The source directory is not a valid MASA bundle.", sourceInspection);
  }

  const compressionLevel = options.compressionLevel ?? 9;
  if (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
    throw new BundleOperationError(
      "MASA_BUNDLE_COMPRESSION_LEVEL_INVALID",
      "ZIP compressionLevel must be an integer from 0 through 9."
    );
  }

  const destination = resolve(destinationZip);
  const parent = dirname(destination);
  await assertSafeDestinationParent(parent);
  await assertAbsent(destination);
  const temporary = join(parent, `.${destination.split("/").at(-1) ?? "bundle"}.${randomUUID()}.tmp`);

  try {
    const zip = new yazl.ZipFile();
    const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    const zipOutput = zip.outputStream as Readable;
    const outputComplete = pipeline(zipOutput, output);
    try {
      const files = sourceInspection.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path)
        .sort(compareBundlePaths);

      for (const archivePath of files) {
        const absolutePath = join(resolve(sourceDirectory), ...archivePath.split("/"));
        const current = await lstat(absolutePath);
        if (current.isSymbolicLink() || !current.isFile()) {
          throw new BundleOperationError(
            "MASA_BUNDLE_SOURCE_CHANGED",
            "A source entry changed after verification and packing was refused."
          );
        }
        zip.addFile(absolutePath, archivePath, {
          compress: compressionLevel !== 0,
          compressionLevel,
          mtime: FIXED_ZIP_TIME,
          mode: 0o100644,
          forceDosTimestamp: true
        });
      }
      zip.end();
      await outputComplete;
    } catch (error) {
      zipOutput.destroy(error instanceof Error ? error : new Error("ZIP packing failed"));
      await outputComplete.catch(() => undefined);
      throw error;
    }
    await chmod(temporary, 0o644);

    const packedInspection = await inspectZipBundle(temporary, limits);
    if (!packedInspection.valid) {
      throw new BundleValidationError(
        "The packed ZIP failed MASA verification and was not promoted.",
        packedInspection
      );
    }

    await assertAbsent(destination);
    await link(temporary, destination);
    await unlink(temporary);
    return packedInspection;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function unpackZipBundle(
  sourceZip: string,
  destinationDirectory: string,
  limits: BundleLimits
): Promise<BundleInspection> {
  const zipInspection = await inspectZipBundle(sourceZip, limits);
  if (!zipInspection.valid) {
    throw new BundleValidationError("The ZIP is not a valid MASA bundle.", zipInspection);
  }

  const destination = resolve(destinationDirectory);
  const parent = dirname(destination);
  await assertSafeDestinationParent(parent);
  await assertAbsent(destination);
  const temporary = await mkdtemp(join(parent, ".masa-unpack-"));
  let promoted = false;

  try {
    await extractZip(sourceZip, temporary, limits);
    const extractedInspection = await inspectDirectoryBundle(temporary, limits);
    if (!extractedInspection.valid) {
      throw new BundleValidationError(
        "The extracted directory failed MASA verification and was not promoted.",
        extractedInspection
      );
    }

    // Claim the destination name atomically before promoting, so a
    // concurrently created directory is refused instead of being replaced
    // by rename(2)'s empty-directory overwrite semantics.
    try {
      await mkdir(destination, { mode: 0o700 });
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        throw new BundleOperationError(
          "MASA_BUNDLE_DESTINATION_EXISTS",
          "Bundle operations never overwrite an existing destination."
        );
      }
      throw error;
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(destination, { recursive: false, force: true }).catch(() => undefined);
      throw error;
    }
    promoted = true;
    return extractedInspection;
  } finally {
    if (!promoted) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

async function assertOrdinaryZipSource(sourceZip: string): Promise<void> {
  const source = await lstat(resolve(sourceZip));
  if (source.isSymbolicLink() || !source.isFile()) {
    throw new BundleOperationError(
      "MASA_BUNDLE_SOURCE_NOT_FILE",
      "A compressed MASA bundle source must be one ordinary ZIP file."
    );
  }
}

async function listZipEntries(
  sourceZip: string,
  limits: BundleLimits
): Promise<{ readonly entries: ZipEntryView[]; readonly totalUncompressedBytes: number }> {
  const zip = await openZip(sourceZip);
  const entries: ZipEntryView[] = [];
  const allPaths: string[] = [];
  const filePaths: string[] = [];
  let totalUncompressedBytes = 0;

  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zip.close();
      rejectPromise(error);
    };

    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      try {
        if (entries.length >= limits.maxEntries) {
          throw new BundleOperationError(
            "MASA_BUNDLE_ENTRY_COUNT_LIMIT",
            "The ZIP exceeds the configured entry-count limit."
          );
        }
        const view = validateZipEntry(entry, entries.length, limits);
        entries.push(view);
        allPaths.push(view.path);
        if (view.kind === "file") filePaths.push(view.path);
        totalUncompressedBytes += view.byteLength;
        if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
          throw new BundleOperationError(
            "MASA_BUNDLE_TOTAL_LIMIT",
            "The ZIP exceeds the configured total uncompressed byte limit."
          );
        }
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.on("end", () => {
      if (settled) return;
      try {
        assertNoPathCollisions(allPaths, filePaths);
        settled = true;
        resolvePromise({ entries, totalUncompressedBytes });
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });
}

function validateZipEntry(entry: Entry, index: number, limits: BundleLimits): ZipEntryView {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new BundleOperationError(
      "MASA_BUNDLE_ENCRYPTED_ENTRY",
      "Encrypted ZIP entries are not permitted in MASA bundles."
    );
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new BundleOperationError(
      "MASA_BUNDLE_COMPRESSION_UNSUPPORTED",
      "Only stored and deflated ZIP entries are permitted."
    );
  }
  if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new BundleOperationError(
      "MASA_BUNDLE_ENTRY_LIMIT",
      "A ZIP entry exceeds the configured uncompressed byte limit."
    );
  }
  if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize)) {
    throw new BundleOperationError(
      "MASA_BUNDLE_ENTRY_SIZE_INVALID",
      "ZIP entry sizes must be safe non-negative integers."
    );
  }
  if (
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)
  ) {
    throw new BundleOperationError(
      "MASA_BUNDLE_COMPRESSION_RATIO",
      "A ZIP entry exceeds the configured expansion ratio."
    );
  }

  const directoryByName = entry.fileName.endsWith("/");
  const archivePath = entry.fileName;
  const value = directoryByName ? archivePath.slice(0, -1) : archivePath;
  assertSafeBundlePath(value, limits);

  const host = entry.versionMadeBy >>> 8;
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const unixType = unixMode & UNIX_TYPE_MASK;
  if ((host === ZIP_UNIX_HOST || host === ZIP_OS_X_HOST) && unixType !== 0) {
    if (unixType === UNIX_SYMLINK) {
      throw new BundleOperationError(
        "MASA_BUNDLE_SYMLINK",
        "Symbolic links are not permitted in MASA ZIP bundles."
      );
    }
    if (unixType !== UNIX_REGULAR_FILE && unixType !== UNIX_DIRECTORY) {
      throw new BundleOperationError(
        "MASA_BUNDLE_NON_REGULAR_FILE",
        "Sockets, devices, and other non-regular ZIP entries are forbidden."
      );
    }
    if (
      (directoryByName && unixType !== UNIX_DIRECTORY) ||
      (!directoryByName && unixType === UNIX_DIRECTORY)
    ) {
      throw new BundleOperationError(
        "MASA_BUNDLE_ENTRY_TYPE_MISMATCH",
        "A ZIP entry name and its declared file type disagree."
      );
    }
  }

  return {
    path: value,
    archivePath,
    kind: directoryByName ? "directory" : "file",
    byteLength: entry.uncompressedSize,
    compressedByteLength: entry.compressedSize,
    index
  };
}

async function scanZipContents(
  sourceZip: string,
  manifest: BundleManifest,
  manifestFiles: readonly ManifestFileView[],
  expectedManifestDigest: string,
  limits: BundleLimits
): Promise<{ readonly entries: readonly BundleEntryInspection[]; readonly diagnostics: readonly Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const entries: BundleEntryInspection[] = [];
  const manifestByPath = new Map(manifestFiles.map((entry) => [entry.path, entry]));
  const recordsByPath = new Map<string, RecordClosureView>();
  const eventReceipts: ReceiptClosureView[] = [];
  const zip = await openZip(sourceZip);
  const rescannedPaths: string[] = [];
  const rescannedFilePaths: string[] = [];
  let rescannedTotal = 0;
  let rescannedCount = 0;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zip.close();
      rejectPromise(error);
    };

    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        if (rescannedCount >= limits.maxEntries) {
          throw new BundleOperationError(
            "MASA_BUNDLE_ENTRY_COUNT_LIMIT",
            "The ZIP exceeds the configured entry-count limit."
          );
        }
        const rescanned = validateZipEntry(entry, rescannedCount, limits);
        rescannedCount += 1;
        rescannedPaths.push(rescanned.path);
        rescannedTotal += rescanned.byteLength;
        if (rescannedTotal > limits.maxTotalUncompressedBytes) {
          throw new BundleOperationError(
            "MASA_BUNDLE_TOTAL_LIMIT",
            "The ZIP exceeds the configured total uncompressed byte limit."
          );
        }
        const archivePath = rescanned.path;
        if (rescanned.kind === "directory") {
          entries.push({
            path: archivePath,
            kind: "directory",
            byteLength: 0,
            compressedByteLength: entry.compressedSize
          });
          zip.readEntry();
          return;
        }
        rescannedFilePaths.push(archivePath);

        const declared = manifestByPath.get(archivePath);
        const stream = await openZipEntryStream(zip, entry);
        const recordChunks: Buffer[] = [];
        const eventValidator = declared?.role === "event-log"
          ? new NdjsonReceiptValidator(limits, manifestFilePath(manifestFiles, archivePath))
          : undefined;
        const shouldBufferRecord = declared?.role === "record" && entry.uncompressedSize <= limits.maxJsonRecordBytes;
        if (declared?.role === "record" && !shouldBufferRecord) {
          diagnostics.push(
            diagnostic(
              "MASA_BUNDLE_RECORD_LIMIT",
              "A record entry exceeds the configured JSON record byte limit.",
              manifestFilePath(manifestFiles, archivePath)
            )
          );
        }
        const consumed = await consumeReadable(stream, limits.maxEntryUncompressedBytes, (chunk) => {
          eventValidator?.push(chunk);
          if (shouldBufferRecord) recordChunks.push(chunk);
        });
        eventValidator?.finish();
        if (eventValidator !== undefined) {
          diagnostics.push(...eventValidator.diagnostics);
          eventReceipts.push(...eventValidator.receipts);
        }

        if (archivePath === "manifest.json") {
          if (consumed.sha256 !== expectedManifestDigest) {
            throw new BundleOperationError(
              "MASA_BUNDLE_SOURCE_CHANGED",
              "The ZIP changed during verification."
            );
          }
        } else if (declared !== undefined) {
          verifyContentIntegrity(declared, consumed, diagnostics, manifestFiles);
          if (shouldBufferRecord) {
            const validation = validateRecordBuffer(
              Buffer.concat(recordChunks),
              manifestFilePath(manifestFiles, archivePath)
            );
            diagnostics.push(...validation.diagnostics);
            if (validation.record !== undefined) {
              recordsByPath.set(archivePath, recordClosureView(validation.record));
            }
          }
        }

        entries.push({
          path: archivePath,
          kind: "file",
          byteLength: consumed.byteLength,
          compressedByteLength: entry.compressedSize,
          sha256: consumed.sha256,
          ...(declared === undefined ? {} : { role: declared.role, mediaType: declared.mediaType })
        });
        zip.readEntry();
      })().catch(fail);
    });
    zip.on("end", () => {
      if (settled) return;
      try {
        assertNoPathCollisions(rescannedPaths, rescannedFilePaths);
        diagnostics.push(
          ...verifyManifestPaths(manifestFiles, rescannedFilePaths, limits),
          ...verifyRecordReferences(manifest, recordsByPath),
          ...verifyExternalHistoryClosure(manifest, recordsByPath, eventReceipts)
        );
        settled = true;
        resolvePromise();
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });

  return {
    entries: entries.sort((left, right) => compareBundlePaths(left.path, right.path)),
    diagnostics: sortDiagnostics(diagnostics)
  };
}

async function extractZip(sourceZip: string, temporaryRoot: string, limits: BundleLimits): Promise<void> {
  const zip = await openZip(sourceZip);
  const paths: string[] = [];
  const filePaths: string[] = [];
  let count = 0;
  let total = 0;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zip.close();
      rejectPromise(error);
    };

    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        if (count >= limits.maxEntries) {
          throw new BundleOperationError(
            "MASA_BUNDLE_ENTRY_COUNT_LIMIT",
            "The ZIP exceeds the configured entry-count limit."
          );
        }
        const validated = validateZipEntry(entry, count, limits);
        count += 1;
        paths.push(validated.path);
        total += validated.byteLength;
        if (total > limits.maxTotalUncompressedBytes) {
          throw new BundleOperationError(
            "MASA_BUNDLE_TOTAL_LIMIT",
            "The ZIP exceeds the configured total uncompressed byte limit."
          );
        }
        if (validated.kind === "directory") {
          zip.readEntry();
          return;
        }
        filePaths.push(validated.path);
        const destination = join(temporaryRoot, ...validated.path.split("/"));
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const output = await open(destination, "wx", 0o600);
        try {
          const stream = await openZipEntryStream(zip, entry);
          let byteLength = 0;
          for await (const value of stream) {
            const chunk = Buffer.isBuffer(value)
              ? value
              : typeof value === "string"
                ? Buffer.from(value)
                : Buffer.from(value as Uint8Array);
            byteLength += chunk.byteLength;
            if (byteLength > limits.maxEntryUncompressedBytes) {
              throw new BundleOperationError(
                "MASA_BUNDLE_ENTRY_LIMIT",
                "An extracted entry exceeds the configured uncompressed byte limit."
              );
            }
            let offset = 0;
            while (offset < chunk.byteLength) {
              const result = await output.write(
                chunk,
                offset,
                chunk.byteLength - offset
              );
              if (result.bytesWritten <= 0) {
                throw new BundleOperationError(
                  "MASA_BUNDLE_EXTRACTION_WRITE",
                  "An extracted entry could not be written completely."
                );
              }
              offset += result.bytesWritten;
            }
          }
          if (byteLength !== entry.uncompressedSize) {
            throw new BundleOperationError(
              "MASA_BUNDLE_SIZE_MISMATCH",
              "An extracted entry does not match its central-directory byte size."
            );
          }
        } finally {
          await output.close();
        }
        await chmod(destination, 0o644);
        zip.readEntry();
      })().catch(fail);
    });
    zip.on("end", () => {
      if (settled) return;
      try {
        assertNoPathCollisions(paths, filePaths);
        settled = true;
        resolvePromise();
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });
}

async function readZipEntryBuffer(
  sourceZip: string,
  targetPath: string,
  maxBytes: number,
  limitCode?: string
): Promise<Buffer> {
  const zip = await openZip(sourceZip);
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zip.close();
      rejectPromise(error);
    };
    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      if (entry.fileName !== targetPath) {
        zip.readEntry();
        return;
      }
      void (async () => {
        const chunks: Buffer[] = [];
        const stream = await openZipEntryStream(zip, entry);
        await consumeReadable(stream, maxBytes, (chunk) => {
          chunks.push(chunk);
        }, limitCode);
        settled = true;
        zip.close();
        resolvePromise(Buffer.concat(chunks));
      })().catch(fail);
    });
    zip.on("end", () => {
      if (!settled) {
        fail(
          new BundleOperationError(
            "MASA_BUNDLE_ENTRY_MISSING",
            "A required ZIP entry is missing."
          )
        );
      }
    });
    zip.readEntry();
  });
}

async function openZip(sourceZip: string): Promise<ZipFile> {
  return await new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(
      resolve(sourceZip),
      {
        autoClose: true,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true
      },
      (error, zip) => {
        if (error !== null) {
          rejectPromise(
            new BundleOperationError(
              "MASA_BUNDLE_ZIP_INVALID",
              "The compressed bundle is not a readable single-disk ZIP.",
              { cause: error }
            )
          );
          return;
        }
        if (zip === undefined) {
          rejectPromise(
            new BundleOperationError(
              "MASA_BUNDLE_ZIP_INVALID",
              "The compressed bundle could not be opened."
            )
          );
          return;
        }
        resolvePromise(zip);
      }
    );
  });
}

async function openZipEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return await new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null) {
        rejectPromise(
          new BundleOperationError(
            "MASA_BUNDLE_ZIP_ENTRY_INVALID",
            "A ZIP entry could not be decoded safely.",
            { cause: error }
          )
        );
        return;
      }
      if (stream === undefined) {
        rejectPromise(
          new BundleOperationError(
            "MASA_BUNDLE_ZIP_ENTRY_INVALID",
            "A ZIP entry did not produce a readable stream."
          )
        );
        return;
      }
      resolvePromise(stream);
    });
  });
}

async function assertSafeDestinationParent(parent: string): Promise<void> {
  const parentState = await lstat(parent);
  if (parentState.isSymbolicLink() || !parentState.isDirectory()) {
    throw new BundleOperationError(
      "MASA_BUNDLE_DESTINATION_PARENT_INVALID",
      "The destination parent must be an existing ordinary directory."
    );
  }
}

function assertDestinationOutsideSource(sourceDirectory: string, destinationZip: string): void {
  const sourceRoot = resolve(sourceDirectory);
  const destination = resolve(destinationZip);
  const relation = relative(sourceRoot, destination);
  const inside = relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
  if (inside) {
    throw new BundleOperationError(
      "MASA_BUNDLE_DESTINATION_INSIDE_SOURCE",
      "The destination ZIP may not be created inside the source bundle directory."
    );
  }
}

function verifyDirectoryEntryCoverage(
  zipEntries: readonly ZipEntryView[],
  manifestFiles: readonly ManifestFileView[]
): Diagnostic[] {
  const ancestors = new Set<string>();
  for (const file of manifestFiles) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      ancestors.add(segments.slice(0, index).join("/"));
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const entry of zipEntries) {
    if (entry.kind === "directory" && !ancestors.has(entry.path)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_UNMANIFESTED_ENTRY",
          "A ZIP directory entry does not correspond to any manifested file path.",
          "/entries"
        )
      );
    }
  }
  return diagnostics;
}

async function assertAbsent(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  throw new BundleOperationError(
    "MASA_BUNDLE_DESTINATION_EXISTS",
    "Bundle operations never overwrite an existing destination."
  );
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function zipInspection(
  manifest: BundleManifest | undefined,
  entries: readonly ZipEntryView[],
  diagnostics: readonly Diagnostic[],
  totalUncompressedBytes: number,
  manifestFiles: readonly ManifestFileView[] = []
): BundleInspection {
  const byPath = new Map(manifestFiles.map((file) => [file.path, file]));
  return {
    valid: !diagnostics.some((value) => value.severity === "error"),
    format: "zip",
    ...(manifest === undefined ? {} : { manifest }),
    entries: entries.map((entry) => {
      const declared = byPath.get(entry.path);
      return {
        path: entry.path,
        kind: entry.kind,
        byteLength: entry.byteLength,
        compressedByteLength: entry.compressedByteLength,
        ...(declared === undefined ? {} : { role: declared.role, mediaType: declared.mediaType })
      };
    }),
    diagnostics: sortDiagnostics(diagnostics),
    totalUncompressedBytes
  };
}
