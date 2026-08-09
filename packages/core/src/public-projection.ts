import type { MatterRecord } from "./generated/index.js";
import { cloneJson, escapeJsonPointerSegment } from "./json.js";
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

const SECRET_CONFIGURATION_KEY = /^(?:accesskey|accesskeyid|accesstoken|apikey|apisecret|authorization|authkey|authtoken|awsaccesskeyid|awssecretaccesskey|bearertoken|clientsecret|connectionstring|cookie|credentials?|databaseurl|environment|idtoken|oauthsecret|oauthtoken|password|passphrase|privateendpoint|privatekey|providerconfig|providersettings|refreshtoken|secret|secretaccesskey|securitytoken|serviceaccountkey|sessiontoken|signingkey|token|webhooksecret|xamzsecuritytoken|xapikey|xgoogsecuritytoken)$/u;
const SECRET_CONFIGURATION_SUFFIX = /(?:accesskeyid|accesstoken|apikey|apisecret|authkey|authtoken|awssecretaccesskey|bearertoken|clientsecret|connectionstring|databaseurl|idtoken|oauthsecret|oauthtoken|password|passphrase|privatekey|refreshtoken|secretaccesskey|securitytoken|serviceaccountkey|sessiontoken|signingkey|webhooksecret)$/u;

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
  output.extensions = filterExtensionBag(
    source.extensions,
    approvedNamespaces,
    "/extensions",
    omissions,
    redactions,
  );

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
    const childPointer = `${pointer}/${escapeJsonPointerSegment(childKey)}`;
    if (childKey === "extensions") {
      output[childKey] = filterExtensionBag(
        value[childKey],
        approvedNamespaces,
        childPointer,
        omissions,
        redactions,
      );
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
  redactions: Array<Omit<ProjectionNotice, "reason">>,
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
        pointer: `${pointer}/${escapeJsonPointerSegment(extensionKey)}`,
        category: "unapproved_extension",
        reason: "Extension namespace was not approved for publication",
      });
      continue;
    }
    if (isSecretConfigurationKey(extensionKey)) {
      redactions.push({
        pointer: `${pointer}/${escapeJsonPointerSegment(extensionKey)}`,
        category: "provider_or_secret_configuration",
      });
      continue;
    }
    output[extensionKey] = sanitizeValue(
      extensionValue,
      `${pointer}/${escapeJsonPointerSegment(extensionKey)}`,
      approvedNamespaces,
      omissions,
      redactions,
    );
  }
  return output;
}

/** Identify configuration keys whose values must never enter a public projection. */
export function isSecretConfigurationKey(key: string): boolean {
  const normalized = normalizeConfigurationKey(key);
  const namespaceSeparator = key.lastIndexOf(":");
  const localName = normalizeConfigurationKey(
    namespaceSeparator < 0 ? key : key.slice(namespaceSeparator + 1),
  );
  return (
    SECRET_CONFIGURATION_KEY.test(normalized) ||
    SECRET_CONFIGURATION_KEY.test(localName) ||
    SECRET_CONFIGURATION_SUFFIX.test(localName)
  );
}

/** Identify URL parameter names that commonly carry credentials or signatures. */
export function isCredentialParameterKey(key: string): boolean {
  const normalized = normalizeConfigurationKey(key);
  return (
    isSecretConfigurationKey(key) ||
    /^(?:credential|googleaccessid|key|keypairid|oauthsignature|securitytoken|signature|sig|xamzcredential|xamzsecuritytoken|xamzsignature|xgoogcredential|xgoogsecuritytoken|xgoogsignature)$/u.test(
      normalized,
    )
  );
}

function isUnsafeLocator(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (isUnsafeFilesystemLocator(value)) {
    return true;
  }
  try {
    const url = new URL(value.trim());
    return (
      url.username !== "" ||
      url.password !== "" ||
      isNonPublicHostname(url.hostname) ||
      hasCredentialParameter(url)
    );
  } catch {
    return false;
  }
}

/** Identify local, absolute, or traversing filesystem locators. */
export function isUnsafeFilesystemLocator(value: string): boolean {
  const forms = [value.trim()];
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const decoded = decodeURIComponent(forms.at(-1)!);
      if (decoded === forms.at(-1)) break;
      forms.push(decoded);
    } catch {
      break;
    }
  }
  for (const normalized of forms) {
    if (
      /^(?:~[^\\/]*[\\/]|\/|[A-Za-z]:|\\\\)/u.test(normalized) ||
      normalized.includes("\\") ||
      normalized.split("/").includes("..")
    ) {
      return true;
    }
  }
  try {
    return new URL(forms[0]!).protocol.toLowerCase() === "file:";
  } catch {
    return false;
  }
}

/**
 * Conservative offline detection for literal non-public hosts shared by
 * projection and publication auditing. It covers loopback/private/link-local,
 * documentation, benchmarking, selected reserved, and common IPv4-in-IPv6
 * transition forms. A hostname that passes can still resolve to a non-public
 * address, so callers must enforce DNS and network policy at connection time.
 */
export function isNonPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/u, "");
  // Hostless URI schemes such as urn:uuid: have no network authority and are
  // not endpoint candidates. Filesystem URLs are classified separately.
  if (normalized.length === 0) return false;
  if (["example", "home.arpa", "invalid", "local", "localhost", "test"].some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  )) {
    return true;
  }

  const ipv6 = parseIpv6(normalized);
  if (ipv6 !== undefined) {
    const first = ipv6[0]!;
    const unspecified = ipv6.every((word) => word === 0);
    const loopback = ipv6.slice(0, 7).every((word) => word === 0) && ipv6[7] === 1;
    const linkLocal = (first & 0xffc0) === 0xfe80;
    const deprecatedSiteLocal = (first & 0xffc0) === 0xfec0;
    const uniqueLocal = (first & 0xfe00) === 0xfc00;
    const multicast = (first & 0xff00) === 0xff00;
    const ipv4Mapped = ipv6.slice(0, 5).every((word) => word === 0) && ipv6[5] === 0xffff;
    const localNat64 = ipv6[0] === 0x64 && ipv6[1] === 0xff9b && ipv6[2] === 1;
    const discardOnly =
      ipv6[0] === 0x100 && ipv6[1] === 0 && ipv6[2] === 0 && ipv6[3]! <= 1;
    const benchmark = ipv6[0] === 0x2001 && ipv6[1] === 0x2 && ipv6[2] === 0;
    const orchid = ipv6[0] === 0x2001 && (ipv6[1]! & 0xfff0) === 0x10;
    const specialPurposeIdentifier =
      ipv6[0] === 0x2001 &&
      ((ipv6[1]! & 0xfff0) === 0x20 || (ipv6[1]! & 0xfff0) === 0x30);
    const documentation =
      (ipv6[0] === 0x2001 && ipv6[1] === 0x0db8) ||
      (ipv6[0] === 0x3fff && (ipv6[1]! & 0xf000) === 0);
    const segmentRouting = ipv6[0] === 0x5f00;
    if (
      unspecified ||
      loopback ||
      linkLocal ||
      deprecatedSiteLocal ||
      uniqueLocal ||
      multicast ||
      localNat64 ||
      discardOnly ||
      benchmark ||
      orchid ||
      specialPurposeIdentifier ||
      documentation ||
      segmentRouting
    ) return true;
    if (ipv4Mapped) {
      return isNonPublicIpv4([
        ipv6[6]! >>> 8,
        ipv6[6]! & 0xff,
        ipv6[7]! >>> 8,
        ipv6[7]! & 0xff,
      ]);
    }
    const embeddedIpv4 = [
      ipv6[6]! >>> 8,
      ipv6[6]! & 0xff,
      ipv6[7]! >>> 8,
      ipv6[7]! & 0xff,
    ] as const;
    const wellKnownNat64 =
      ipv6[0] === 0x64 &&
      ipv6[1] === 0xff9b &&
      ipv6.slice(2, 6).every((word) => word === 0);
    const sixToFour = ipv6[0] === 0x2002;
    const isatap = ipv6[5] === 0x5efe;
    const ipv4Translated =
      ipv6.slice(0, 4).every((word) => word === 0) &&
      ipv6[4] === 0xffff &&
      ipv6[5] === 0;
    const ipv4Compatible = ipv6.slice(0, 6).every((word) => word === 0);
    if (wellKnownNat64 || isatap || ipv4Translated || ipv4Compatible) {
      return isNonPublicIpv4(embeddedIpv4);
    }
    if (sixToFour) {
      return isNonPublicIpv4([
        ipv6[1]! >>> 8,
        ipv6[1]! & 0xff,
        ipv6[2]! >>> 8,
        ipv6[2]! & 0xff,
      ]);
    }
    // IANA currently allocates general global-unicast space from 2000::/3.
    // Explicit transition forms above are evaluated by their embedded IPv4
    // address; other IPv6 space outside that allocation is non-public here.
    return (first & 0xe000) !== 0x2000;
  }

  const octets = parseIpv4(normalized);
  if (octets !== undefined) return isNonPublicIpv4(octets);
  return !normalized.includes(".");
}

/** @deprecated Use isNonPublicHostname; retained as a compatibility alias. */
export function isPrivateHostname(hostname: string): boolean {
  return isNonPublicHostname(hostname);
}

function hasCredentialParameter(url: URL): boolean {
  const parameterNames = [...url.searchParams.keys()];
  if (url.hash.length > 1) {
    parameterNames.push(...new URLSearchParams(url.hash.slice(1)).keys());
  }
  return parameterNames.some(isCredentialParameterKey);
}

function normalizeConfigurationKey(key: string): string {
  return key.normalize("NFKC").replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function parseIpv4(value: string): [number, number, number, number] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/u.test(part))) {
    return undefined;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) {
    return undefined;
  }
  return octets as [number, number, number, number];
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
  const [first = -1, second = -1, third = -1, fourth = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0 && fourth !== 9 && fourth !== 10) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6(value: string): number[] | undefined {
  if (!value.includes(":")) return undefined;

  let normalized = value;
  const dottedTail = /(?:^|:)([0-9]+(?:\.[0-9]+){3})$/u.exec(normalized)?.[1];
  if (dottedTail !== undefined) {
    const octets = parseIpv4(dottedTail);
    if (octets === undefined) return undefined;
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    normalized = `${normalized.slice(0, -dottedTail.length)}${high.toString(16)}:${low.toString(16)}`;
  }

  const compressed = normalized.includes("::");
  if (compressed && normalized.indexOf("::") !== normalized.lastIndexOf("::")) return undefined;
  const [leftText = "", rightText = ""] = compressed
    ? normalized.split("::")
    : [normalized, ""];
  const left = leftText === "" ? [] : leftText.split(":");
  const right = rightText === "" ? [] : rightText.split(":");
  if ([...left, ...right].some((word) => !/^[A-Fa-f0-9]{1,4}$/u.test(word))) return undefined;

  const missing = 8 - left.length - right.length;
  if ((compressed && missing < 1) || (!compressed && missing !== 0)) return undefined;
  return [
    ...left.map((word) => Number.parseInt(word, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((word) => Number.parseInt(word, 16)),
  ];
}
