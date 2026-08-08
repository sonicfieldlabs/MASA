import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const expectedLicense = (await readFile(join(root, "LICENSE"), "utf8")).trimEnd();
const packages = ["packages/core", "packages/validator", "packages/bundle", "cli", "mcp"];
const prohibitedPath = /(?:^|\/)(?:node_modules|src)(?:\/|$)|\.tsbuildinfo$|\.test\.(?:js|d\.ts)(?:\.map)?$/u;
const prohibitedArtifact = /\.(?:aiff?|flac|m4a|mp3|ogg|wav|wave|webm|mov|mp4|sqlite|db|env)$/iu;
// Any user home path is a personal-path leak, not only the current machine's.
const personalPath = /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/u;
const credentialValue = /(?:\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b)/u;

interface PackFile {
  path: string;
}

interface PackResult {
  files: PackFile[];
}

let inspected = 0;
for (const packagePath of packages) {
  const directory = join(root, packagePath);
  const packageJson = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
    private?: unknown;
    name?: unknown;
  };
  if (packageJson.private !== true) throw new Error(`${packagePath} must remain private in MASA 0.1.0.`);
  const { stdout } = await execute("pnpm", ["pack", "--dry-run", "--json"], {
    cwd: directory,
    maxBuffer: 16 * 1024 * 1024
  });
  const result = JSON.parse(stdout) as PackResult;
  const files = result.files ?? [];
  if (files.length === 0) throw new Error(`${packagePath} produced no packable files.`);
  if (!files.some(({ path }) => path === "LICENSE")) {
    throw new Error(`${packagePath} does not include LICENSE in its packed artifact.`);
  }

  for (const file of files) {
    if (prohibitedPath.test(file.path) || prohibitedArtifact.test(file.path)) {
      throw new Error(`${packagePath} would package prohibited artifact ${file.path}.`);
    }
    if (
      file.path !== "LICENSE" &&
      file.path !== "package.json" &&
      !/^README(?:\.|$)/u.test(file.path) &&
      !file.path.startsWith("dist/")
    ) {
      throw new Error(`${packagePath} would package an unexpected non-dist file ${file.path}.`);
    }
    if (
      file.path === "LICENSE" &&
      (await readFile(join(directory, file.path), "utf8")).trimEnd() !== expectedLicense
    ) {
      throw new Error(`${packagePath}/LICENSE does not match the repository MIT license.`);
    }
    if (/\.(?:js|map|d\.ts|json)$/u.test(file.path)) {
      const text = await readFile(join(directory, file.path), "utf8");
      if (personalPath.test(text)) throw new Error(`${packagePath}/${file.path} contains a personal absolute path.`);
      if (credentialValue.test(text)) throw new Error(`${packagePath}/${file.path} contains a credential-shaped value.`);
    }
    inspected += 1;
  }
}

process.stdout.write(`MASA package artifacts: ${inspected} files inspected; all five include the canonical MIT license and no tests, build metadata, media, personal paths, or credential-shaped values.\n`);
