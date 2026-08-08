import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CAPABILITY_ID_PREFIX, IMPLEMENTATION_ID_PREFIX, SCHEMA_ID_PREFIX } from "./canonical.js";

const output = resolve(import.meta.dirname, "..", "capabilities", "0.1.0", "reference.json");
const resultSchema = `${SCHEMA_ID_PREFIX}tools/tool-result.schema.json`;

function capability(
  name: string,
  purpose: string,
  input: string,
  overrides: { profiles?: string[]; determinism?: string[] } = {}
) {
  return {
    id: `${CAPABILITY_ID_PREFIX}${name}`,
    type: "masa:Capability",
    name,
    purpose,
    supportedMasaVersions: ["0.1.0"],
    profiles: overrides.profiles ?? ["core"],
    inputSchema: { state: "known", uri: input },
    outputSchema: { state: "known", uri: resultSchema },
    resources: { local: ["configured-roots"], network: [], providers: [], hardware: [] },
    sideEffects: ["local-read"],
    authority: { required: true, source: "trusted-host", scopes: ["local-read"] },
    confirmation: "host-policy",
    riskFlags: {
      expose: false,
      publish: false,
      delete: false,
      overwrite: false,
      paidProvider: false,
      externalSystem: false,
      preciseLocation: false
    },
    receiptType: "masa:OperationReceipt",
    determinism: overrides.determinism ?? ["deterministic"],
    outcomes: ["completed", "failed", "refused", "not_performed"],
    limits: { maxRecordBytes: 16777216, network: false },
    extensions: {}
  };
}

const catalog = {
  capabilitySetType: "masa-capability-set",
  capabilitySetVersion: "0.1.0",
  masaVersion: "0.1.0",
  id: `${CAPABILITY_ID_PREFIX}reference`,
  implementation: {
    id: `${IMPLEMENTATION_ID_PREFIX}typescript-reference/0.1.0`,
    name: "MASA local TypeScript reference",
    version: "0.1.0"
  },
  generatedAt: "2026-07-27T00:00:00Z",
  capabilities: [
    capability(
      "matter.validate",
      "Validate one local MASA record or bundle inside a configured root without remote dereferencing.",
      `${SCHEMA_ID_PREFIX}tools/validate-input.schema.json`
    ),
    capability(
      "matter.inspect",
      "Return a bounded structural summary and diagnostics for one local MASA artifact.",
      `${SCHEMA_ID_PREFIX}tools/inspect-input.schema.json`
    ),
    capability(
      "matter.trace_lineage",
      "Return a bounded, direction-aware causal lineage subgraph for one entity in a validated local record.",
      `${SCHEMA_ID_PREFIX}tools/trace-lineage-input.schema.json`
    ),
    capability(
      "matter.audit_public_export",
      "Audit a proposed public projection for protocol, policy, path, secret, and disclosure failures.",
      `${SCHEMA_ID_PREFIX}tools/audit-public-input.schema.json`
    ),
    capability(
      "matter.plan_processing",
      "Compose and validate one engine-neutral sound-matter processing request without performing any signal processing.",
      `${SCHEMA_ID_PREFIX}tools/plan-processing-input.schema.json`,
      { profiles: ["core", "processing"], determinism: ["nondeterministic"] }
    )
  ],
  extensions: {}
};

await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
process.stdout.write("MASA reference capability catalog generated.\n");
