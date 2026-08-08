#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { protocolResources, referenceCapabilitySet, stableStringify } from "@sonicfield/masa";
import { getEmbeddedSchema } from "@sonicfield/masa-validator";
import { z } from "zod";
import {
  auditPublicTarget,
  inspectTarget,
  planProcessingTarget,
  PROCESSING_OPERATION_TYPES,
  traceLineageTarget,
  validateTarget
} from "./tools.js";
import { configuredRoots } from "./root-policy.js";

const diagnosticsShape = z.array(
  z.object({
    code: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    instancePath: z.string(),
    schemaPath: z.string(),
    message: z.string(),
    remediation: z.string()
  })
);

const outputShape = {
  status: z.enum(["completed", "failed", "refused"]),
  valid: z.boolean(),
  diagnostics: diagnosticsShape,
  data: z.unknown().optional()
};

function asToolResponse(result: Awaited<ReturnType<typeof validateTarget>>) {
  const normalized = {
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      schemaPath: diagnostic.schemaPath ?? ""
    }))
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(normalized) }],
    structuredContent: normalized
  };
}

export async function createMasaServer(): Promise<McpServer> {
  const roots = await configuredRoots();
  const server = new McpServer({ name: "masa-local", version: "0.1.0" });

  const matterRecordSchema = getEmbeddedSchema("matterRecord");
  if (matterRecordSchema === undefined) throw new Error("The embedded MatterRecord schema is absent.");
  const resources = [
    ...protocolResources,
    {
      name: "masa-record-schema",
      uri: "masa://schemas/0.1.0/matter-record",
      mimeType: "application/schema+json",
      text: stableStringify(matterRecordSchema, 2)
    },
    {
      name: "masa-capabilities",
      uri: "masa://capabilities",
      mimeType: "application/json",
      text: stableStringify(referenceCapabilitySet, 2)
    }
  ] as const;

  for (const { name, uri, mimeType, text } of resources) {
    server.registerResource(name, uri, { mimeType }, async (resourceUri) => ({
      contents: [
        {
          uri: resourceUri.href,
          mimeType,
          text
        }
      ]
    }));
  }

  server.registerTool(
    "matter.validate",
    {
      title: "Validate MASA artifact",
      description: "Validate one local MASA record or bundle inside a configured root without network access.",
      inputSchema: { path: z.string().min(1) },
      outputSchema: outputShape
    },
    async ({ path }) => asToolResponse(await validateTarget(path, roots))
  );

  server.registerTool(
    "matter.inspect",
    {
      title: "Inspect MASA artifact",
      description: "Return a bounded summary and diagnostics for a local MASA record or bundle.",
      inputSchema: { path: z.string().min(1) },
      outputSchema: outputShape
    },
    async ({ path }) => asToolResponse(await inspectTarget(path, roots))
  );

  server.registerTool(
    "matter.trace_lineage",
    {
      title: "Trace MASA lineage",
      description: "Return a bounded, direction-aware causal lineage subgraph for one entity in a validated local record.",
      inputSchema: {
        path: z.string().min(1),
        entityId: z.string().url().or(z.string().startsWith("urn:")),
        direction: z.enum(["ancestors", "descendants", "both"]).optional(),
        maxDepth: z.number().int().min(1).max(64).optional()
      },
      outputSchema: outputShape
    },
    async ({ path, entityId, direction, maxDepth }) =>
      asToolResponse(
        await traceLineageTarget(path, entityId, roots, {
          ...(direction === undefined ? {} : { direction }),
          ...(maxDepth === undefined ? {} : { maxDepth })
        })
      )
  );

  server.registerTool(
    "matter.audit_public_export",
    {
      title: "Audit public MASA projection",
      description: "Audit a proposed local public projection for protocol, policy, path, secret, and disclosure failures.",
      inputSchema: { path: z.string().min(1) },
      outputSchema: outputShape
    },
    async ({ path }) => asToolResponse(await auditPublicTarget(path, roots))
  );

  server.registerTool(
    "matter.plan_processing",
    {
      title: "Plan MASA processing request",
      description: "Compose and validate one engine-neutral sound-matter processing request (granulate, extract, reduce, fragment, timestretch, pitchshift) without performing any signal processing.",
      inputSchema: {
        operationType: z.enum(PROCESSING_OPERATION_TYPES),
        parameters: z.record(z.string(), z.unknown()),
        inputs: z.array(z.string().min(5)).min(1),
        path: z.string().min(1).optional(),
        determinism: z.enum(["require-deterministic", "require-seeded", "accept-nondeterministic"]).optional(),
        maxOutputs: z.number().int().min(1).max(10000).optional()
      },
      outputSchema: outputShape
    },
    async ({ operationType, parameters, inputs, path, determinism, maxOutputs }) =>
      asToolResponse(
        await planProcessingTarget(
          {
            operationType,
            parameters,
            inputs,
            ...(path === undefined ? {} : { path }),
            ...(determinism === undefined ? {} : { determinism }),
            ...(maxOutputs === undefined ? {} : { maxOutputs })
          },
          roots
        )
      )
  );

  return server;
}

export async function main(): Promise<void> {
  const server = await createMasaServer();
  await server.connect(new StdioServerTransport());
}

/**
 * Installed bins are symlinks into the package; Node realpaths the main
 * module but not argv[1], so both sides must be canonicalized before they
 * are compared. Otherwise the installed command silently starts nothing.
 */
function executedScriptHref(argvPath: string | undefined): string | undefined {
  if (!argvPath) return undefined;
  try {
    return pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return pathToFileURL(argvPath).href;
  }
}

const executedPath = executedScriptHref(process.argv[1]);
if (executedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`MASA MCP failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
