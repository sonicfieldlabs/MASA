import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  parseJsonStrict,
  stableStringify,
  type MatterRecord,
  type OperationReceipt
} from "@sonicfield/masa";
import { afterEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import {
  inspectBundle,
  packBundle,
  unpackBundle,
  verifyBundle
} from "./index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const minimalRecordPath = join(
  repositoryRoot,
  "examples/0.1.0/valid/minimal-record.masa.json"
);
const transformationRecordPath = join(
  repositoryRoot,
  "examples/0.1.0/valid/transformation.masa.json"
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((value) => rm(value, { recursive: true, force: true }))
  );
});

describe("MASA bundle verification", () => {
  it("verifies an exactly covered directory bundle", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);

    const inspection = await inspectBundle(bundle);

    expect(inspection.valid).toBe(true);
    expect(inspection.format).toBe("directory");
    expect(inspection.diagnostics).toEqual([]);
    expect(inspection.entries.some((entry) => entry.path === "manifest.json")).toBe(true);
    await expect(verifyBundle(bundle)).resolves.toMatchObject({ valid: true });
  });

  it("rejects digest changes and unmanifested payloads", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    const recordPath = join(bundle, "records/minimal.masa.json");
    await writeFile(recordPath, Buffer.from("{}"));

    let inspection = await inspectBundle(bundle);
    expect(codes(inspection)).toContain("MASA_BUNDLE_SIZE_MISMATCH");
    expect(codes(inspection)).toContain("MASA_BUNDLE_DIGEST_MISMATCH");

    const fresh = await createBundleDirectory(root, "extra.masa");
    await mkdir(join(fresh, "assets"), { recursive: true });
    await writeFile(join(fresh, "assets/unlisted.bin"), Buffer.from("private"));
    inspection = await inspectBundle(fresh);
    expect(codes(inspection)).toContain("MASA_BUNDLE_COVERAGE_MISMATCH");
  });

  it("rejects duplicate JSON members in the manifest", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    await writeFile(
      join(bundle, "manifest.json"),
      Buffer.from('{"manifestType":"masa-bundle","manifestType":"masa-bundle"}\n')
    );

    const inspection = await inspectBundle(bundle);

    expect(inspection.valid).toBe(false);
    expect(codes(inspection)).toContain("MASA_JSON_DUPLICATE_KEY");
  });

  it("rejects symlinks even when their targets remain inside the bundle", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    await symlink("records/minimal.masa.json", join(bundle, "record-link.json"));

    const inspection = await inspectBundle(bundle);

    expect(inspection.valid).toBe(false);
    expect(codes(inspection)).toContain("MASA_BUNDLE_SYMLINK");
  });

  it("rejects attempts to raise normative limits without host authority", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);

    await expect(
      inspectBundle(bundle, { limits: { maxEntries: 10_001 } })
    ).rejects.toMatchObject({
      code: "MASA_BUNDLE_LIMIT_AUTHORITY_REQUIRED"
    });
  });
});

describe("deterministic ZIP packing and bounded unpacking", () => {
  it("produces deterministic bytes and verifies the packed ZIP", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    const first = join(root, "first.masa.zip");
    const second = join(root, "second.masa.zip");

    await packBundle(bundle, first);
    await packBundle(bundle, second);

    expect(await readFile(first)).toEqual(await readFile(second));
    await expect(verifyBundle(first)).resolves.toMatchObject({ valid: true, format: "zip" });
  });

  it("unpacks into a verified directory and never overwrites a destination", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    const archive = join(root, "source.masa.zip");
    const destination = join(root, "unpacked.masa");
    await packBundle(bundle, archive);

    const inspection = await unpackBundle(archive, destination);

    expect(inspection.valid).toBe(true);
    expect(await readdir(destination)).toContain("manifest.json");
    await expect(unpackBundle(archive, destination)).rejects.toMatchObject({
      code: "MASA_BUNDLE_DESTINATION_EXISTS"
    });
    expect(await readdir(destination)).toContain("records");
  });

  it("never overwrites an existing packed destination", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    const destination = join(root, "existing.masa.zip");
    const sentinel = Buffer.from("do-not-overwrite");
    await writeFile(destination, sentinel);

    await expect(packBundle(bundle, destination)).rejects.toMatchObject({
      code: "MASA_BUNDLE_DESTINATION_EXISTS"
    });
    expect(await readFile(destination)).toEqual(sentinel);
  });

  it("rejects a file whose folded name is the ancestor of another file", async () => {
    const root = await temporaryRoot();
    const foldedAncestorZip = join(root, "folded-ancestor.zip");
    await writeRawZip(foldedAncestorZip, [
      { path: "Records", data: Buffer.from("not a directory") },
      { path: "records/a.json", data: Buffer.from("{}") }
    ]);

    expect(codes(await inspectBundle(foldedAncestorZip))).toContain("MASA_BUNDLE_PATH_COLLISION");
  });

  it("accepts ancestor directory entries but rejects unmanifested empty directories", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);
    const zipWith = async (name: string, emptyDirectory: string): Promise<string> => {
      const zipPath = join(root, name);
      const zip = new yazl.ZipFile();
      const complete = pipeline(zip.outputStream, createWriteStream(zipPath, { flags: "wx" }));
      for (const relativePath of ["manifest.json", "records/minimal.masa.json"]) {
        zip.addBuffer(await readFile(join(bundle, ...relativePath.split("/"))), relativePath, {
          mtime: new Date("1980-01-01T00:00:00Z"),
          mode: 0o100644,
          compress: true,
          compressionLevel: 9,
          forceDosTimestamp: true
        });
      }
      zip.addEmptyDirectory(emptyDirectory, {
        mtime: new Date("1980-01-01T00:00:00Z"),
        mode: 0o040755
      });
      zip.end();
      await complete;
      return zipPath;
    };

    const ancestorEntry = await inspectBundle(await zipWith("ancestor-dir.zip", "records"));
    expect(ancestorEntry.valid).toBe(true);

    const strayEntry = await inspectBundle(await zipWith("stray-dir.zip", "stray"));
    expect(strayEntry.valid).toBe(false);
    expect(codes(strayEntry)).toContain("MASA_BUNDLE_UNMANIFESTED_ENTRY");
  });

  it("refuses to create the destination ZIP inside the source bundle", async () => {
    const root = await temporaryRoot();
    const bundle = await createBundleDirectory(root);

    await expect(packBundle(bundle, join(bundle, "self.masa.zip"))).rejects.toMatchObject({
      code: "MASA_BUNDLE_DESTINATION_INSIDE_SOURCE"
    });
  });

  it("rejects case collisions, symlink entries, and excessive expansion", async () => {
    const root = await temporaryRoot();
    const collisionZip = join(root, "collision.zip");
    await writeRawZip(collisionZip, [
      { path: "records/A.json", data: Buffer.from("{}") },
      { path: "records/a.json", data: Buffer.from("{}") }
    ]);
    expect(codes(await inspectBundle(collisionZip))).toContain("MASA_BUNDLE_PATH_COLLISION");

    const symlinkZip = join(root, "symlink.zip");
    await writeRawZip(symlinkZip, [
      { path: "records/link.json", data: Buffer.from("target"), mode: 0o120777 }
    ]);
    expect(codes(await inspectBundle(symlinkZip))).toContain("MASA_BUNDLE_SYMLINK");

    const expandedZip = join(root, "expanded.zip");
    await writeRawZip(expandedZip, [
      { path: "assets/expanded.bin", data: Buffer.alloc(256 * 1024) }
    ]);
    expect(codes(await inspectBundle(expandedZip))).toContain(
      "MASA_BUNDLE_COMPRESSION_RATIO"
    );
  });
});

describe("external event-log closure", () => {
  it("accepts one declared receipt and rejects undeclared receipts", async () => {
    const root = await temporaryRoot();
    const sourceText = await readFile(transformationRecordPath, "utf8");
    const embedded = parseJsonStrict<MatterRecord>(sourceText);
    const history = embedded.history as {
      readonly mode: "embedded";
      readonly events: readonly OperationReceipt[];
    };
    const receipt = history.events[0];
    expect(receipt).toBeDefined();
    const externalRecord = {
      ...embedded,
      history: {
        mode: "external",
        href: "events.ndjson",
        eventIds: [receipt!.id]
      }
    } as MatterRecord;
    const validBundle = await createBundleDirectory(root, "external.masa", {
      record: externalRecord,
      events: [receipt!]
    });

    expect((await inspectBundle(validBundle)).valid).toBe(true);

    const undeclaredRecord = {
      ...externalRecord,
      history: { mode: "external", href: "events.ndjson", eventIds: [] }
    } as MatterRecord;
    const invalidBundle = await createBundleDirectory(root, "undeclared.masa", {
      record: undeclaredRecord,
      events: [receipt!]
    });
    const invalid = await inspectBundle(invalidBundle);
    expect(invalid.valid).toBe(false);
    expect(codes(invalid)).toContain("MASA_BUNDLE_EVENT_UNDECLARED");
  });
});

async function temporaryRoot(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "masa-bundle-test-"));
  temporaryRoots.push(value);
  return value;
}

async function createBundleDirectory(
  root: string,
  name = "fixture.masa",
  options: {
    readonly record?: MatterRecord;
    readonly events?: readonly OperationReceipt[];
  } = {}
): Promise<string> {
  const bundle = join(root, name);
  const record =
    options.record ??
    parseJsonStrict<MatterRecord>(await readFile(minimalRecordPath, "utf8"));
  const recordPath = "records/minimal.masa.json";
  const recordBytes = Buffer.from(`${stableStringify(record, 2)}\n`);
  const files: Record<string, Buffer> = { [recordPath]: recordBytes };
  if (options.events !== undefined) {
    files["events.ndjson"] = Buffer.from(
      options.events.map((receipt) => stableStringify(receipt)).join("\n") + "\n"
    );
  }

  for (const [relativePath, bytes] of Object.entries(files)) {
    const output = join(bundle, ...relativePath.split("/"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
  }

  const manifestFiles = Object.entries(files)
    .map(([relativePath, bytes]) => ({
      path: relativePath,
      role: relativePath === "events.ndjson" ? "event-log" : "record",
      mediaType: relativePath === "events.ndjson" ? "application/x-ndjson" : "application/masa+json",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      disclosure: "private",
      ...(relativePath === recordPath ? { recordRef: record.id } : {})
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const manifest = {
    manifestType: "masa-bundle",
    manifestVersion: "0.1.0",
    masaVersion: "0.1.0",
    id: "urn:uuid:10000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-27T12:00:00Z",
    createdBy: record.createdBy,
    disclosure: "private",
    profiles: record.profiles,
    records: [{ id: record.id, path: recordPath }],
    files: manifestFiles,
    externalReferences: [],
    omissions: [],
    extensions: {}
  };
  await writeFile(join(bundle, "manifest.json"), Buffer.from(`${stableStringify(manifest, 2)}\n`));
  return bundle;
}

async function writeRawZip(
  destination: string,
  entries: readonly {
    readonly path: string;
    readonly data: Buffer;
    readonly mode?: number;
  }[]
): Promise<void> {
  const zip = new yazl.ZipFile();
  const complete = pipeline(zip.outputStream, createWriteStream(destination, { flags: "wx" }));
  for (const entry of entries) {
    zip.addBuffer(entry.data, entry.path, {
      mtime: new Date("1980-01-01T00:00:00Z"),
      mode: entry.mode ?? 0o100644,
      compress: true,
      compressionLevel: 9,
      forceDosTimestamp: true
    });
  }
  zip.end();
  await complete;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function codes(inspection: { readonly diagnostics: readonly { readonly code: string }[] }): string[] {
  return inspection.diagnostics.map((value) => value.code);
}
