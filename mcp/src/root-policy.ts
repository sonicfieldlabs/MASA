import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";

export class RootPolicyError extends Error {
  readonly code = "MASA_PATH_ESCAPE";

  constructor(message: string) {
    super(message);
    this.name = "RootPolicyError";
  }
}

function contains(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export async function configuredRoots(
  environmentValue = process.env.MASA_ALLOWED_ROOTS,
  workingDirectory = process.cwd()
): Promise<string[]> {
  // A set-but-empty variable is a configuration error and fails loudly;
  // only an absent variable falls back to the process working directory.
  const requested = environmentValue === undefined
    ? [workingDirectory]
    : environmentValue.split(delimiter).filter((entry) => entry.length > 0);
  if (requested.length === 0) {
    throw new RootPolicyError("No local root is configured.");
  }

  const roots = await Promise.all(
    requested.map(async (entry) => {
      const canonical = await realpath(resolve(workingDirectory, entry));
      const metadata = await stat(canonical);
      if (!metadata.isDirectory()) {
        throw new RootPolicyError("An allowed root is not a directory.");
      }
      return canonical;
    })
  );
  return [...new Set(roots)].sort();
}

export async function resolveReadablePath(
  input: string,
  roots: readonly string[],
  workingDirectory = process.cwd()
): Promise<string> {
  if (input.includes("\0") || /^\w+:\/\//u.test(input) || input.startsWith("file:")) {
    throw new RootPolicyError("Only local filesystem paths are accepted.");
  }
  const requested = resolve(workingDirectory, input);
  const canonical = await realpath(requested);
  if (!roots.some((root) => contains(root, canonical))) {
    throw new RootPolicyError("The requested path is outside the configured roots.");
  }
  return canonical;
}

