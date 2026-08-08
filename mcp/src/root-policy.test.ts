import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { configuredRoots, resolveReadablePath, RootPolicyError } from "./root-policy.js";

describe("MCP root policy", () => {
  it("allows a real file inside a configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "masa-root-"));
    const target = join(root, "record.json");
    await writeFile(target, "{}", "utf8");
    const roots = await configuredRoots(root, root);
    await expect(resolveReadablePath(target, roots, root)).resolves.toBe(await realpath(target));
  });

  it("refuses traversal and a symlink escape", async () => {
    const parent = await mkdtemp(join(tmpdir(), "masa-roots-"));
    const root = join(parent, "allowed");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "private.json"), "{}", "utf8");
    await symlink(outside, join(root, "escape"));
    const roots = await configuredRoots(root, root);

    await expect(resolveReadablePath(join(root, "escape", "private.json"), roots, root)).rejects.toBeInstanceOf(
      RootPolicyError
    );
  });

  it("refuses URI inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "masa-root-"));
    const roots = await configuredRoots(root, root);
    await expect(resolveReadablePath("https://example.test/record.json", roots, root)).rejects.toBeInstanceOf(
      RootPolicyError
    );
  });

  it("fails loudly when the roots variable is set but empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "masa-root-"));
    await expect(configuredRoots("", root)).rejects.toBeInstanceOf(RootPolicyError);
    const fallback = await configuredRoots(undefined, root);
    expect(fallback).toHaveLength(1);
  });
});
