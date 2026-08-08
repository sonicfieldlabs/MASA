import { createReadStream } from "node:fs";
import {
  lstat,
  readdir,
  realpath
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  BundleManifest,
  Diagnostic,
  MatterRecord
} from "@sonicfield/masa";
import {
  consumeReadable,
  NdjsonReceiptValidator,
  readFileBounded,
  validateRecordBuffer,
  type ReceiptClosureView
} from "./content.js";
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
import type {
  BundleEntryInspection,
  BundleInspection,
  BundleLimits
} from "./types.js";
import { BundleOperationError } from "./types.js";

interface DirectoryEntry {
  readonly path: string;
  readonly absolutePath: string;
  readonly kind: "file" | "directory";
  readonly byteLength: number;
}

/**
 * The bounded slice of a validated record retained for cross-file closure
 * checks, so inspection memory does not scale with full record contents.
 */
export interface RecordClosureView {
  readonly id: string;
  readonly externalHistory?: {
    readonly href: string;
    readonly eventIds: readonly string[];
  };
}

export function recordClosureView(record: MatterRecord): RecordClosureView {
  const history = record.history as
    | { readonly mode: "embedded" }
    | { readonly mode: "external"; readonly href: string; readonly eventIds: readonly string[] };
  if (history.mode === "external") {
    return { id: record.id, externalHistory: { href: history.href, eventIds: history.eventIds } };
  }
  return { id: record.id };
}

export async function inspectDirectoryBundle(
  sourceDirectory: string,
  limits: BundleLimits
): Promise<BundleInspection> {
  const diagnostics: Diagnostic[] = [];
  let entries: DirectoryEntry[] = [];
  let totalUncompressedBytes = 0;

  try {
    const walked = await walkDirectory(sourceDirectory, limits);
    entries = walked.entries;
    totalUncompressedBytes = walked.totalUncompressedBytes;
  } catch (error) {
    diagnostics.push(asDiagnostic(error, "/entries"));
    return inspection(undefined, entries, diagnostics, totalUncompressedBytes);
  }

  const files = entries.filter((entry) => entry.kind === "file");
  const manifestEntry = files.find((entry) => entry.path === "manifest.json");
  if (manifestEntry === undefined) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_MANIFEST_MISSING",
        "A MASA bundle directory must contain manifest.json at its root.",
        "/manifest"
      )
    );
    return inspection(undefined, entries, diagnostics, totalUncompressedBytes);
  }
  if (manifestEntry.byteLength > limits.maxManifestBytes) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_MANIFEST_LIMIT",
        "manifest.json exceeds the configured byte limit.",
        "/manifest"
      )
    );
    return inspection(undefined, entries, diagnostics, totalUncompressedBytes);
  }

  let manifestBuffer: Buffer;
  try {
    manifestBuffer = await readFileBounded(
      manifestEntry.absolutePath,
      limits.maxManifestBytes
    );
  } catch (error) {
    diagnostics.push(asDiagnostic(error, "/manifest"));
    return inspection(undefined, entries, diagnostics, totalUncompressedBytes);
  }
  const manifestDigest = sha256Hex().update(manifestBuffer).digest("hex");
  const validatedManifest = parseAndValidateManifest(manifestBuffer);
  diagnostics.push(...validatedManifest.diagnostics);
  if (validatedManifest.diagnostics.some((value) => value.severity === "error")) {
    return inspection(undefined, entries, diagnostics, totalUncompressedBytes);
  }

  const manifest = validatedManifest.manifest;
  const manifestFiles = validatedManifest.files;
  diagnostics.push(
    ...verifyManifestPaths(
      manifestFiles,
      files.map((entry) => entry.path),
      limits
    ),
    ...verifyManifestSemantics(manifest, manifestFiles)
  );
  if (diagnostics.some((value) => value.severity === "error")) {
    return inspection(manifest, entries, diagnostics, totalUncompressedBytes, manifestFiles);
  }

  const manifestByPath = new Map(manifestFiles.map((entry) => [entry.path, entry]));
  const recordsByPath = new Map<string, RecordClosureView>();
  const eventReceipts: ReceiptClosureView[] = [];
  const mutableInspectionEntries: BundleEntryInspection[] = [];

  for (const entry of files) {
    const declared = manifestByPath.get(entry.path);
    let sha256: string | undefined;
    if (entry.path !== "manifest.json" && declared === undefined) {
      continue;
    }
    try {
      if (declared?.role === "record" && entry.byteLength > limits.maxJsonRecordBytes) {
        diagnostics.push(
          diagnostic(
            "MASA_BUNDLE_RECORD_LIMIT",
            "A record entry exceeds the configured JSON record byte limit.",
            manifestFilePath(manifestFiles, entry.path)
          )
        );
      }

      const eventValidator = declared?.role === "event-log"
        ? new NdjsonReceiptValidator(limits, manifestFilePath(manifestFiles, entry.path))
        : undefined;
      const consumed = await consumeReadable(
        createReadStream(entry.absolutePath),
        limits.maxEntryUncompressedBytes,
        eventValidator === undefined ? undefined : (chunk) => eventValidator.push(chunk)
      );
      sha256 = consumed.sha256;
      eventValidator?.finish();
      if (eventValidator !== undefined) {
        diagnostics.push(...eventValidator.diagnostics);
        eventReceipts.push(...eventValidator.receipts);
      }

      if (entry.path === "manifest.json" && consumed.sha256 !== manifestDigest) {
        diagnostics.push(
          diagnostic(
            "MASA_BUNDLE_SOURCE_CHANGED",
            "manifest.json changed between validation and digest verification.",
            "/manifest"
          )
        );
      }

      if (declared !== undefined) {
        verifyContentIntegrity(declared, consumed, diagnostics, manifestFiles);
      }

      if (declared?.role === "record" && entry.byteLength <= limits.maxJsonRecordBytes) {
        const recordBuffer = await readFileBounded(
          entry.absolutePath,
          limits.maxJsonRecordBytes
        );
        const validation = validateRecordBuffer(
          recordBuffer,
          manifestFilePath(manifestFiles, entry.path)
        );
        diagnostics.push(...validation.diagnostics);
        if (validation.record !== undefined) {
          recordsByPath.set(entry.path, recordClosureView(validation.record));
        }
      }
    } catch (error) {
      diagnostics.push(asDiagnostic(error, manifestFilePath(manifestFiles, entry.path)));
    }

    mutableInspectionEntries.push({
      path: entry.path,
      kind: "file",
      byteLength: entry.byteLength,
      ...(sha256 === undefined ? {} : { sha256 }),
      ...(declared === undefined ? {} : { role: declared.role, mediaType: declared.mediaType })
    });
  }

  for (const entry of entries.filter((value) => value.kind === "directory")) {
    mutableInspectionEntries.push({
      path: entry.path,
      kind: "directory",
      byteLength: 0
    });
  }
  diagnostics.push(
    ...verifyRecordReferences(manifest, recordsByPath),
    ...verifyExternalHistoryClosure(manifest, recordsByPath, eventReceipts)
  );

  return {
    valid: !diagnostics.some((value) => value.severity === "error"),
    format: "directory",
    manifest,
    entries: mutableInspectionEntries.sort((left, right) => compareBundlePaths(left.path, right.path)),
    diagnostics: sortDiagnostics(diagnostics),
    totalUncompressedBytes
  };
}

async function walkDirectory(
  sourceDirectory: string,
  limits: BundleLimits
): Promise<{ readonly entries: DirectoryEntry[]; readonly totalUncompressedBytes: number }> {
  const root = resolve(sourceDirectory);
  const rootLstat = await lstat(root);
  if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) {
    throw new BundleOperationError(
      "MASA_BUNDLE_SOURCE_NOT_DIRECTORY",
      "The bundle source must be one ordinary directory."
    );
  }
  const canonicalRoot = await realpath(root);
  const entries: DirectoryEntry[] = [];
  const allPaths: string[] = [];
  const filePaths: string[] = [];
  let totalUncompressedBytes = 0;

  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareBundlePaths(left.name, right.name));
    for (const child of children) {
      if (entries.length >= limits.maxEntries) {
        throw new BundleOperationError(
          "MASA_BUNDLE_ENTRY_COUNT_LIMIT",
          "The directory exceeds the configured entry-count limit."
        );
      }
      const absolutePath = join(directory, child.name);
      const entryLstat = await lstat(absolutePath);
      const relativePath = relative(canonicalRoot, absolutePath).split(sep).join("/");
      assertSafeBundlePath(relativePath, limits);
      allPaths.push(relativePath);

      if (entryLstat.isSymbolicLink()) {
        throw new BundleOperationError(
          "MASA_BUNDLE_SYMLINK",
          "Symbolic links are not permitted in MASA bundles."
        );
      }
      if (entryLstat.isDirectory()) {
        entries.push({ path: relativePath, absolutePath, kind: "directory", byteLength: 0 });
        await visit(absolutePath);
        continue;
      }
      if (!entryLstat.isFile()) {
        throw new BundleOperationError(
          "MASA_BUNDLE_NON_REGULAR_FILE",
          "Only ordinary files and directories are permitted in a MASA bundle."
        );
      }
      if (entryLstat.size > limits.maxEntryUncompressedBytes) {
        throw new BundleOperationError(
          "MASA_BUNDLE_ENTRY_LIMIT",
          "An included file exceeds the configured uncompressed byte limit."
        );
      }
      totalUncompressedBytes += entryLstat.size;
      if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
        throw new BundleOperationError(
          "MASA_BUNDLE_TOTAL_LIMIT",
          "The directory exceeds the configured total uncompressed byte limit."
        );
      }
      filePaths.push(relativePath);
      entries.push({
        path: relativePath,
        absolutePath,
        kind: "file",
        byteLength: entryLstat.size
      });
    }
  }

  await visit(canonicalRoot);
  assertNoPathCollisions(allPaths, filePaths);
  return { entries, totalUncompressedBytes };
}

export function verifyManifestSemantics(
  manifest: BundleManifest,
  files: readonly ManifestFileView[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const view = manifest as BundleManifest & {
    readonly records: readonly { readonly id: string; readonly path: string }[];
    readonly files: readonly { readonly role: string }[];
  };
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const recordIds = new Set<string>();
  const recordPaths = new Set<string>();

  for (const [index, record] of view.records.entries()) {
    if (recordIds.has(record.id) || recordPaths.has(record.path)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_RECORD_REFERENCE_DUPLICATE",
          "Manifest record identifiers and paths must be unique.",
          `/records/${index}`
        )
      );
    }
    recordIds.add(record.id);
    recordPaths.add(record.path);
    const file = filesByPath.get(record.path);
    if (file?.role !== "record") {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_RECORD_REFERENCE_INVALID",
          "Every manifest record reference must resolve to a file with role record.",
          `/records/${index}/path`
        )
      );
    }
    const recordRef = file?.recordRef;
    if (recordRef !== undefined && recordRef !== record.id) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_RECORD_REFERENCE_MISMATCH",
          "A record file recordRef must equal the manifest record identifier.",
          `/records/${index}`
        )
      );
    }
  }

  for (const [index, file] of files.entries()) {
    if (file.role === "record" && !recordPaths.has(file.path)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_RECORD_UNREFERENCED",
          "Every file with role record must appear in the manifest records list.",
          `/files/${index}`
        )
      );
    }
    if (file.role === "event-log" && file.path !== "events.ndjson") {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_PATH_INVALID",
          "The Core event log path is events.ndjson.",
          `/files/${index}/path`
        )
      );
    }
  }
  if (files.filter((file) => file.role === "event-log").length > 1) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_EVENT_LOG_DUPLICATE",
        "A MASA 0.1.0 bundle may contain at most one Core event log.",
        "/files"
      )
    );
  }
  return diagnostics;
}

export function verifyContentIntegrity(
  declared: ManifestFileView,
  consumed: { readonly byteLength: number; readonly sha256: string },
  diagnostics: Diagnostic[],
  files: readonly ManifestFileView[]
): void {
  const path = manifestFilePath(files, declared.path);
  if (consumed.byteLength !== declared.byteLength) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_SIZE_MISMATCH",
        "An included file does not match its declared byteLength.",
        path
      )
    );
  }
  if (consumed.sha256.toLowerCase() !== declared.sha256.toLowerCase()) {
    diagnostics.push(
      diagnostic(
        "MASA_BUNDLE_DIGEST_MISMATCH",
        "An included file does not match its declared SHA-256 digest.",
        path
      )
    );
  }
}

export function verifyRecordReferences(
  manifest: BundleManifest,
  recordsByPath: ReadonlyMap<string, RecordClosureView>
): Diagnostic[] {
  const view = manifest as BundleManifest & {
    readonly records: readonly { readonly id: string; readonly path: string }[];
  };
  const diagnostics: Diagnostic[] = [];
  for (const [index, reference] of view.records.entries()) {
    const actual = recordsByPath.get(reference.path);
    if (actual !== undefined && actual.id !== reference.id) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_RECORD_ID_MISMATCH",
          "A record document identifier does not match its manifest record reference.",
          `/records/${index}`
        )
      );
    }
  }
  return diagnostics;
}

export function verifyExternalHistoryClosure(
  manifest: BundleManifest,
  recordsByPath: ReadonlyMap<string, RecordClosureView>,
  receipts: readonly ReceiptClosureView[]
): Diagnostic[] {
  const view = manifest as BundleManifest & {
    readonly records: readonly { readonly id: string; readonly path: string }[];
  };
  const diagnostics: Diagnostic[] = [];
  const includedRecordIds = new Set(view.records.map((record) => record.id));
  const receiptIndexes = new Map<string, number[]>();
  const receiptById = new Map<string, ReceiptClosureView>();
  const hasEventLog = view.files.some((file) => file.role === "event-log");

  for (const [index, receipt] of receipts.entries()) {
    const indexes = receiptIndexes.get(receipt.id) ?? [];
    indexes.push(index);
    receiptIndexes.set(receipt.id, indexes);
    receiptById.set(receipt.id, receipt);
    if (!includedRecordIds.has(receipt.recordId)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_RECORD_UNRESOLVED",
          "Every external receipt recordId must resolve to an included manifest record.",
          `/events/${index}/recordId`
        )
      );
    }
  }

  const declarations = new Map<string, { readonly recordId: string; readonly recordIndex: number }>();
  for (const [recordIndex, reference] of view.records.entries()) {
    const record = recordsByPath.get(reference.path);
    const history = record?.externalHistory;
    if (history === undefined) continue;
    if (!hasEventLog) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_LOG_MISSING",
          "A record with external history requires the declared events.ndjson file.",
          `/records/${recordIndex}/history`
        )
      );
    }
    if (history.href !== "events.ndjson") {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_PATH_INVALID",
          "External Core history must reference events.ndjson.",
          `/records/${recordIndex}/history/href`
        )
      );
    }
    for (const [eventIndex, eventId] of history.eventIds.entries()) {
      const existing = declarations.get(eventId);
      if (existing !== undefined) {
        diagnostics.push(
          diagnostic(
            "MASA_BUNDLE_EVENT_DECLARATION_DUPLICATE",
            "An external receipt identifier may be declared by only one included record.",
            `/records/${recordIndex}/history/eventIds/${eventIndex}`
          )
        );
      } else {
        declarations.set(eventId, { recordId: reference.id, recordIndex });
      }
      const occurrences = receiptIndexes.get(eventId)?.length ?? 0;
      if (occurrences !== 1) {
        diagnostics.push(
          diagnostic(
            "MASA_BUNDLE_EVENT_CLOSURE",
            "Every declared external receipt identifier must appear exactly once in events.ndjson.",
            `/records/${recordIndex}/history/eventIds/${eventIndex}`
          )
        );
      }
      const receipt = receiptById.get(eventId);
      if (receipt !== undefined && receipt.recordId !== reference.id) {
        diagnostics.push(
          diagnostic(
            "MASA_BUNDLE_EVENT_RECORD_MISMATCH",
            "An external receipt recordId must match the record that declares the receipt.",
            `/records/${recordIndex}/history/eventIds/${eventIndex}`
          )
        );
      }
    }
  }

  for (const [index, receipt] of receipts.entries()) {
    if (!declarations.has(receipt.id)) {
      diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_UNDECLARED",
          "Every events.ndjson receipt must be declared by exactly one included record history.",
          `/events/${index}`
        )
      );
    }
  }
  return diagnostics;
}

export function manifestFilePath(files: readonly ManifestFileView[], path: string): string {
  const index = files.findIndex((file) => file.path === path);
  return index < 0 ? "/files" : `/files/${index}`;
}

function inspection(
  manifest: BundleManifest | undefined,
  entries: readonly DirectoryEntry[],
  diagnostics: readonly Diagnostic[],
  totalUncompressedBytes: number,
  manifestFiles: readonly ManifestFileView[] = []
): BundleInspection {
  const byPath = new Map(manifestFiles.map((file) => [file.path, file]));
  return {
    valid: !diagnostics.some((value) => value.severity === "error"),
    format: "directory",
    ...(manifest === undefined ? {} : { manifest }),
    entries: entries.map((entry) => {
      const declared = byPath.get(entry.path);
      return {
        path: entry.path,
        kind: entry.kind,
        byteLength: entry.byteLength,
        ...(declared === undefined ? {} : { role: declared.role, mediaType: declared.mediaType })
      };
    }),
    diagnostics: sortDiagnostics(diagnostics),
    totalUncompressedBytes
  };
}
