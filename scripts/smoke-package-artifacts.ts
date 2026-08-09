import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { MASA_PROTOCOL_VERSION } from "./canonical.js";
import { referenceImplementationVersion } from "./release-version.js";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pnpmExecutable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
const pnpmArguments = (arguments_: string[]): string[] =>
  process.platform === "win32" ? ["/d", "/c", "pnpm", ...arguments_] : arguments_;
const expectedLicense = (await readFile(join(root, "LICENSE"), "utf8")).trimEnd();
const implementationVersion = await referenceImplementationVersion();
const expectedHelpBanner = `MASA local CLI ${implementationVersion} (protocol ${MASA_PROTOCOL_VERSION})`;
const temporary = await mkdtemp(join(tmpdir(), "masa-packed-smoke-"));

const packages = [
  { directory: "packages/core", name: "@sonicfield/masa", archive: "masa.tgz" },
  { directory: "packages/validator", name: "@sonicfield/masa-validator", archive: "validator.tgz" },
  { directory: "packages/bundle", name: "@sonicfield/masa-bundle", archive: "bundle.tgz" },
  { directory: "cli", name: "@sonicfield/masa-cli", archive: "cli.tgz" },
  { directory: "mcp", name: "@sonicfield/masa-mcp", archive: "mcp.tgz" },
] as const;

try {
  const modules = join(temporary, "node_modules");
  for (const item of packages) {
    const archive = join(temporary, item.archive);
    await execute(pnpmExecutable, pnpmArguments(["pack", "--out", archive]), {
      cwd: join(root, item.directory),
      maxBuffer: 16 * 1024 * 1024,
    });
    const destination = join(modules, ...item.name.split("/"));
    await mkdir(destination, { recursive: true });
    await execute("tar", ["-xzf", archive, "-C", destination, "--strip-components=1"]);
    const packageDocument = await readFile(join(destination, "package.json"), "utf8");
    if (packageDocument.includes("workspace:")) {
      throw new Error(`${item.name} retained a workspace dependency in its pnpm-packed manifest.`);
    }
    const packedLicense = (await readFile(join(destination, "LICENSE"), "utf8")).trimEnd();
    if (packedLicense !== expectedLicense) {
      throw new Error(`${item.name} did not retain the canonical MIT license text.`);
    }
  }

  const externalDependencies = [
    ["ajv", "packages/validator/node_modules/ajv"],
    ["ajv-formats", "packages/validator/node_modules/ajv-formats"],
    ["yauzl", "packages/bundle/node_modules/yauzl"],
    ["yazl", "packages/bundle/node_modules/yazl"],
    ["zod", "mcp/node_modules/zod"],
    ["@modelcontextprotocol/sdk", "mcp/node_modules/@modelcontextprotocol/sdk"],
  ] as const;
  for (const [name, source] of externalDependencies) {
    const destination = join(modules, ...name.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await symlink(await realpath(join(root, source)), destination, "dir");
  }

  const smoke = `
    const core = await import("@sonicfield/masa");
    if (!core.protocolResources.some((item) => item.uri === ${JSON.stringify(`masa://spec/${MASA_PROTOCOL_VERSION}/core`)})) throw new Error("core resource missing");
    if (core.MASA_PROTOCOL_VERSION !== ${JSON.stringify(MASA_PROTOCOL_VERSION)}) throw new Error("protocol version missing");
    if (core.MASA_REFERENCE_IMPLEMENTATION_VERSION !== ${JSON.stringify(implementationVersion)}) throw new Error("implementation version missing");
    if (!core.referenceCapabilitySet.capabilities.some((item) => item.name === "matter.trace_lineage")) throw new Error("capability missing");
    if (!core.referenceCapabilitySet.capabilities.some((item) => item.name === "matter.plan_processing")) throw new Error("processing capability missing");
    const validator = await import("@sonicfield/masa-validator");
    if (!validator.getEmbeddedSchema("tools/trace-lineage-input")) throw new Error("schema resource missing");
    await import("@sonicfield/masa-bundle");
    const cli = await import("@sonicfield/masa-cli");
    const output = [];
    const errors = [];
    const io = { out: (value) => output.push(value), error: (value) => errors.push(value) };
    if (await cli.runCli(["schema", "show", "matter-record"], io) !== 0) throw new Error(errors.join("\\n"));
    if (await cli.runCli(["capabilities"], io) !== 0) throw new Error(errors.join("\\n"));
    const mcp = await import("@sonicfield/masa-mcp");
    const server = await mcp.createMasaServer();
    await server.close();
  `;
  await execute(process.execPath, ["--input-type=module", "--eval", smoke], {
    cwd: temporary,
    maxBuffer: 16 * 1024 * 1024,
  });

  // Installed bins run through package-manager symlinks. Execute the CLI
  // entry through a symlink to prove the ESM entry guard still fires there.
  const cliEntry = join(modules, "@sonicfield", "masa-cli", "dist", "index.js");
  const binDirectory = join(temporary, "bin");
  await mkdir(binDirectory, { recursive: true });
  const cliBinLink = join(binDirectory, "masa");
  await symlink(cliEntry, cliBinLink, "file");
  const helpRun = await execute(process.execPath, [cliBinLink, "help"], {
    cwd: temporary,
    maxBuffer: 1024 * 1024,
  });
  if (!helpRun.stdout.includes(expectedHelpBanner)) {
    throw new Error("The symlinked CLI bin produced no usage output; the ESM entry guard regressed.");
  }

  process.stdout.write("MASA packed runtime: five pnpm tarballs loaded in isolation; canonical licenses, embedded schemas, capabilities, symlinked bin execution, CLI, bundle, and MCP entrypoints passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
