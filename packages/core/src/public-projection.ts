import type { MatterRecord } from "./generated/index.js";
import { cloneJson } from "./json.js";
import { asJsonArray, isJsonObject, readString, readStringArray } from "./traversal.js";

const DISCLOSURE_COLLECTIONS = [
  "actors",
  "sources",
  "representations",
  "listeningPasses",
  "claims",
  "observations",
  "policies",
  "contexts",
] as const;

const EXPLICIT_COLLECTIONS = [
  "encounters",
  "apertures",
  "measurements",
  "regions",
  "mappings",
  "relations",
  "agentRuns",
  "capabilities",
] as const;

const PUBLIC_REPRESENTATION_ROLES = new Set([
  "derivative",
  "preview",
  "render",
  "data",
  "prompt",
  "score",
  "model-output",
  "performance-capture",
  "tombstone",
  "other",
]);

export interface PublicProjectionOptions {
  /** IDs for entities without a disclosure field that received explicit review. */
  includeEntityIds?: readonly string[];
  /** Further restrict the namespaces approved by the Publication object. */
  approvedExtensionNamespaces?: readonly string[];
  /** Profiles proven by the emitted projection. Defaults to core + publication. */
  profiles?: readonly string[];
}

export interface ProjectionNotice {
  pointer: string;
  category: string;
  reason: string;
}

export interface PublicProjectionReport {
  omissions: readonly ProjectionNotice[];
  redactions: readonly Omit<ProjectionNotice, "reason">[];
}

export interface PublicProjectionResult {
  /** A projection candidate. It is not public until auditPublicRecord passes. */
  record: MatterRecord;
  report: PublicProjectionReport;
}

export class PublicProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicProjectionError";
    this.code = code;
  }
}

/**
 * Construct a new allowlisted candidate rather than editing a private record.
 * The function is intentionally pure; callers must run the Publisher audit on
 * its result before writing or packing it.
 */
export function createPublicProjection(
  record: MatterRecord,
  options: PublicProjectionOptions = {},
): PublicProjectionResult {
  const source = cloneJson(record) as unknown as Record<string, unknown>;
  const publication = source.publication;
  if (!isJsonObject(publication)) {
    throw new PublicProjectionError(
      "MASA_PUBLICATION_REQUIRED",
      "A reviewed Publication object is required to create a public projection",
    );
  }

  const publicRecordId = readString(publication, "publicRecordId");
  const approvedAt = readString(publication, "approvedAt");
  const approvedBy = readString(publication, "approvedBy");
  if (publicRecordId === undefined || approvedAt === undefined || approvedBy === undefined) {
    throw new PublicProjectionError(
      "MASA_PUBLICATION_INCOMPLETE",
      "Publication identity, approval time, and approving actor are required",
    );
  }

  const publicationNamespaces = new Set(readStringArray(publication, "approvedExtensionNamespaces"));
  const requestedNamespaces = options.approvedExtensionNamespaces;
  const approvedNamespaces = new Set(
    requestedNamespaces === undefined
      ? publicationNamespaces
      : requestedNamespaces.filter((namespace) => publicationNamespaces.has(namespace)),
  );
  const explicitlyIncluded = new Set(options.includeEntityIds ?? []);
  const omissions: ProjectionNotice[] = [];
  const redactions: Array<Omit<ProjectionNotice, "reason">> = [];

  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ["$schema", "@context", "title", "description", "registers", "scales"] as const) {
    if (source[key] !== undefined) {
      output[key] = sanitizeValue(source[key], `/${key}`, approvedNamespaces, omissions, redactions);
    }
  }
  output.masaVersion = source.masaVersion;
  output.id = publicRecordId;
  output.type = "masa:MatterRecord";
  output.revision = 1;
  output.profiles = [...new Set(options.profiles ?? ["core", "publication"])];
  output.createdAt = approvedAt;
  output.createdBy = approvedBy;
  output.disclosure = "public";

  for (const collection of DISCLOSURE_COLLECTIONS) {
    output[collection] = asJsonArray(source[collection]).flatMap((entity, index) => {
      const pointer = `/${collection}/${index}`;
      if (!isJsonObject(entity) || entity.disclosure !== "public") {
        omissions.push({
          pointer,
          category: "non_public_disclosure",
          reason: "Entity was not explicitly marked public",
        });
        return [];
      }
      if (
        collection === "representations" &&
        (!PUBLIC_REPRESENTATION_ROLES.has(readString(entity, "role") ?? "") ||
          !["available", "partial", "deleted"].includes(readString(entity, "availability") ?? ""))
      ) {
        omissions.push({
          pointer,
          category: "representation_not_public_safe",
          reason: "Representation role or availability is not permitted in a public projection",
        });
        return [];
      }
      return [sanitizeValue(entity, pointer, approvedNamespaces, omissions, redactions)];
    });
  }

  for (const collection of EXPLICIT_COLLECTIONS) {
    output[collection] = asJsonArray(source[collection]).flatMap((entity, index) => {
      const pointer = `/${collection}/${index}`;
      const id = readString(entity, "id");
      if (id === undefined || !explicitlyIncluded.has(id)) {
        omissions.push({
          pointer,
          category: "not_explicitly_approved",
          reason: "Entity without a disclosure field requires explicit publication approval",
        });
        return [];
      }
      return [sanitizeValue(entity, pointer, approvedNamespaces, omissions, redactions)];
    });
  }

  output.integrity = {
    state: "not_applicable",
  };
  if (source.integrity !== undefined) {
    redactions.push({ pointer: "/integrity", category: "private_integrity_removed" });
  }
  if (isJsonObject(source.history) && source.history.mode === "embedded") {
    const publicationEvents = asJsonArray(source.history.events).flatMap((event, index) => {
      if (
        !isJsonObject(event) ||
        event.operationType !== "matter.publish" ||
        event.effectClass !== "publish" ||
        event.finalStatus !== "completed" ||
        event.reversibility !== "irreversible" ||
        !isJsonObject(event.policyEvaluation) ||
        event.policyEvaluation.result !== "permitted"
      ) {
        omissions.push({
          pointer: `/history/events/${index}`,
          category: "private_operation_history",
          reason: "Only a completed, permitted publication receipt enters the public projection",
        });
        return [];
      }
      return [
        sanitizeValue(
          event,
          `/history/events/${index}`,
          approvedNamespaces,
          omissions,
          redactions,
        ),
      ];
    });
    output.history = { mode: "embedded", events: publicationEvents };
  } else if (isJsonObject(source.history) && source.history.mode === "external") {
    output.history = sanitizeValue(
      source.history,
      "/history",
      approvedNamespaces,
      omissions,
      redactions,
    );
  } else {
    output.history = { mode: "embedded", events: [] };
    omissions.push({
      pointer: "/history",
      category: "publication_receipt_missing",
      reason: "The source record did not contain a projectable publication receipt",
    });
  }

  // Filter the record-level extension bag before snapshotting the embedded
  // omission and redaction lists, so extension omissions are reported inside
  // the published Publication object and not only in the returned report.
  output.extensions = filterExtensionBag(source.extensions, approvedNamespaces, "/extensions", omissions);

  const existingOmissions = asJsonArray(publication.omissions).filter(isJsonObject);
  const existingRedactions = asJsonArray(publication.redactions).filter(isJsonObject);
  const publicPublication = sanitizeValue(
    publication,
    "/publication",
    approvedNamespaces,
    omissions,
    redactions,
  ) as Record<string, unknown>;
  publicPublication.approvedExtensionNamespaces = [...approvedNamespaces].sort();
  publicPublication.omissions = [
    ...existingOmissions,
    ...omissions.map(({ pointer, category, reason }) => ({ pointer, category, reason })),
  ];
  publicPublication.redactions = [
    ...existingRedactions,
    ...redactions.map(({ pointer, category }) => ({ pointer, category })),
  ];
  output.publication = publicPublication;

  // The projection is a new record identified by publicRecordId. Rewrite
  // every reference to the private record identity (publish receipts'
  // recordId, policy targets, relations) so the private identifier never
  // survives into the public artifact and the candidate can pass its own
  // publication audit.
  const privateRecordId = readString(source, "id");
  const decorrelated =
    privateRecordId !== undefined && privateRecordId !== publicRecordId
      ? (rewriteRecordIdentity(output, privateRecordId, publicRecordId) as Record<string, unknown>)
      : output;

  return {
    record: decorrelated as unknown as MatterRecord,
    report: { omissions, redactions },
  };
}

function rewriteRecordIdentity(value: unknown, privateId: string, publicId: string): unknown {
  if (typeof value === "string") {
    return value === privateId ? publicId : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteRecordIdentity(item, privateId, publicId));
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    output[key] = rewriteRecordIdentity(value[key], privateId, publicId);
  }
  return output;
}

function sanitizeValue(
  value: unknown,
  pointer: string,
  approvedNamespaces: ReadonlySet<string>,
  omissions: ProjectionNotice[],
  redactions: Array<Omit<ProjectionNotice, "reason">>,
  key?: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeValue(item, `${pointer}/${index}`, approvedNamespaces, omissions, redactions),
    );
  }
  if (!isJsonObject(value)) {
    return value;
  }

  if (key === "locator" && value.state === "known" && isUnsafeLocator(value.value)) {
    redactions.push({ pointer, category: "unsafe_locator" });
    return {
      state: "unavailable",
      reason: "Locator excluded from public projection",
      reasonCode: "public_projection",
    };
  }

  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const childKey of Object.keys(value).sort()) {
    const childPointer = `${pointer}/${childKey}`;
    if (childKey === "extensions") {
      output[childKey] = filterExtensionBag(value[childKey], approvedNamespaces, childPointer, omissions);
      continue;
    }
    if (isSecretConfigurationKey(childKey)) {
      redactions.push({ pointer: childPointer, category: "provider_or_secret_configuration" });
      continue;
    }
    output[childKey] = sanitizeValue(
      value[childKey],
      childPointer,
      approvedNamespaces,
      omissions,
      redactions,
      childKey,
    );
  }
  return output;
}

function filterExtensionBag(
  value: unknown,
  approvedNamespaces: ReadonlySet<string>,
  pointer: string,
  omissions: ProjectionNotice[],
): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (!isJsonObject(value)) {
    return output;
  }
  for (const [extensionKey, extensionValue] of Object.entries(value)) {
    const separator = extensionKey.indexOf(":");
    const namespace = separator < 0 ? "" : `${extensionKey.slice(0, separator)}:`;
    if (!approvedNamespaces.has(namespace)) {
      omissions.push({
        pointer: `${pointer}/${extensionKey}`,
        category: "unapproved_extension",
        reason: "Extension namespace was not approved for publication",
      });
      continue;
    }
    output[extensionKey] = cloneJson(extensionValue);
  }
  return output;
}

function isSecretConfigurationKey(key: string): boolean {
  return /^(?:api[_-]?key|authorization|cookie|credential|environment|password|private[_-]?endpoint|provider[_-]?(?:config|settings)|secret|token)$/i.test(
    key,
  );
}

function isUnsafeLocator(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file:")) {
    return true;
  }
  try {
    const url = new URL(value);
    return (
      url.username !== "" ||
      url.password !== "" ||
      isPrivateHostname(url.hostname) ||
      [...url.searchParams.keys()].some((key) => /key|password|secret|token/i.test(key))
    );
  } catch {
    return value.includes("\\") || value.split("/").includes("..");
  }
}

/**
 * Loopback, link-local, unique-local, carrier-grade NAT, and private-range
 * detection shared by projection and publication auditing. This is defense
 * in depth for obvious private endpoints, not a complete network policy.
 */
export function isPrivateHostname(hostname: string): boolean {
  let normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  if (normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice("::ffff:".length);
  }
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
