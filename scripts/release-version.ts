import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_DIRECTORIES = [
  "",
  "packages/core",
  "packages/validator",
  "packages/bundle",
  "cli",
  "mcp",
] as const;

/**
 * Deterministic timestamp for the current reference-tooling release. Keep it
 * explicit so generation never depends on the wall clock or developer locale.
 */
export const REFERENCE_IMPLEMENTATION_GENERATED_AT = "2026-08-09T00:00:00.000Z";

/**
 * Read the reference-tooling release from package metadata and fail generation
 * if any packable workspace has drifted from it.
 */
export async function referenceImplementationVersion(): Promise<string> {
  const packages = await Promise.all(
    PACKAGE_DIRECTORIES.map(async (directory) => {
      const path = join(ROOT, directory, "package.json");
      const document = JSON.parse(await readFile(path, "utf8")) as { name?: unknown; version?: unknown };
      if (
        typeof document.name !== "string" ||
        typeof document.version !== "string" ||
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(document.version)
      ) {
        throw new Error(`${directory || "."}/package.json has invalid release metadata.`);
      }
      return { directory: directory || ".", name: document.name, version: document.version };
    }),
  );
  const expected = packages[0]!.version;
  const mismatched = packages.filter(({ version }) => version !== expected);
  if (mismatched.length > 0) {
    throw new Error(
      `MASA reference package versions must match ${expected}: ${mismatched
        .map(({ directory, version }) => `${directory}=${version}`)
        .join(", ")}`,
    );
  }
  return expected;
}
