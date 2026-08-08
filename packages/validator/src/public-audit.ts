import type { Diagnostic, MatterRecord } from "@sonicfield/masa";
import {
  asJsonArray,
  indexRecord,
  isJsonObject,
  isPrivateHostname,
  readString,
  readStringArray,
  sortDiagnostics,
  walkJson,
} from "@sonicfield/masa";

import { diagnostic } from "./diagnostic.js";

const SECRET_KEY = /^(?:access[_-]?token|api[_-]?key|api[_-]?secret|authorization|client[_-]?secret|cookie|credentials?|environment|password|private[_-]?endpoint|provider[_-]?(?:config|settings)|secret|token)$/i;
const SECRET_VALUE = /(?:\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/;
const ABSOLUTE_PATH = /^(?:~\/|\/(?:Applications|Users|Volumes|data|etc|home|media|mnt|opt|private|root|run|srv|tmp|usr|var)(?:\/|$)|[A-Za-z]:[\\/]|\\\\)/;
const LOCATION_KEY = /^(?:lat|latitude|lon|lng|longitude)$/i;
const COORDINATE_STRING = /^[-+]?\d{1,3}(?:\.\d+)?$/;

export function auditPublicSafety(record: MatterRecord): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const raw = record as unknown as Record<string, unknown>;
  const publication = raw.publication;
  const approvedNamespaces = new Set(
    isJsonObject(publication)
      ? readStringArray(publication, "approvedExtensionNamespaces")
      : [],
  );

  if (raw.disclosure !== "public") {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_DISCLOSURE",
        "/disclosure",
        "A public projection is not marked public",
        "Create a new projection with disclosure set to public after policy approval",
      ),
    );
  }

  if (!isJsonObject(publication)) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_DISCLOSURE",
        "/publication",
        "A public projection has no Publication account",
        "Attach a reviewed Publication object with policy, correction, and revocation routes",
      ),
    );
  } else {
    auditPublication(raw, publication, diagnostics);
  }

  if (isJsonObject(raw.integrity) && raw.integrity.state === "known") {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_DISCLOSURE",
        "/integrity",
        "The public record carries an integrity value that may correlate private material",
        "Use a digest of the released projection or an explicit unavailable state instead of the private record digest",
      ),
    );
  }

  walkJson(raw, ({ value, instancePath, parent, key }) => {
    if (typeof key === "string" && SECRET_KEY.test(key)) {
      diagnostics.push(
        diagnostic(
          "MASA_PUBLIC_SECRET",
          instancePath,
          "A public projection contains a secret or provider-configuration field",
          "Remove the field and rebuild the projection from an explicit public allowlist",
        ),
      );
    }

    if (
      typeof key === "string" &&
      LOCATION_KEY.test(key) &&
      (typeof value === "number" || (typeof value === "string" && COORDINATE_STRING.test(value)))
    ) {
      diagnostics.push(
        diagnostic(
          "MASA_PUBLIC_PRECISE_LOCATION",
          instancePath,
          "A public projection contains precise coordinate data",
          "Remove or coarsen the location under the governing territorial and publication policy",
        ),
      );
    }

    if (key === "coordinates" && Array.isArray(value) && value.some((item) => typeof item === "number")) {
      diagnostics.push(
        diagnostic(
          "MASA_PUBLIC_PRECISE_LOCATION",
          instancePath,
          "A public projection contains a numeric coordinate sequence",
          "Replace coordinates with an authorized coarser scope or a withheld state",
        ),
      );
    }

    if (key === "extensions" && isJsonObject(value)) {
      for (const extensionKey of Object.keys(value)) {
        const separator = extensionKey.indexOf(":");
        const namespace = separator < 0 ? "" : `${extensionKey.slice(0, separator)}:`;
        if (!approvedNamespaces.has(namespace)) {
          diagnostics.push(
            diagnostic(
              "MASA_PUBLIC_EXTENSION",
              `${instancePath}/${extensionKey}`,
              "A public projection contains an extension namespace that was not approved",
              "Remove the extension or record exact namespace approval in the Publication object",
            ),
          );
        }
      }
    }

    if (typeof value === "string") {
      auditPublicString(value, instancePath, diagnostics);
    }

    if (
      isJsonObject(value) &&
      typeof value.disclosure === "string" &&
      value.disclosure !== "public" &&
      (typeof value.type === "string" || parent === raw)
    ) {
      diagnostics.push(
        diagnostic(
          "MASA_PUBLIC_DISCLOSURE",
          `${instancePath}/disclosure`,
          "A public projection contains a non-public typed entity",
          "Omit the entity or publish a separately approved public account",
        ),
      );
    }
  });

  return sortDiagnostics(diagnostics);
}

function auditPublication(
  record: Record<string, unknown>,
  publication: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void {
  if (readString(publication, "publicRecordId") !== readString(record, "id")) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_DISCLOSURE",
        "/publication/publicRecordId",
        "Publication identity does not match the public record",
        "Use the public projection identifier in both fields",
      ),
    );
  }
  if (readString(publication, "approvedBy") !== readString(record, "createdBy")) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_DISCLOSURE",
        "/publication/approvedBy",
        "The projected creator and publication approver are not aligned",
        "Identify an authorized public actor and preserve any distinct creator through explicit attribution",
      ),
    );
  }

  const evaluation = publication.policyEvaluation;
  if (!isJsonObject(evaluation) || readString(evaluation, "result") !== "permitted") {
    diagnostics.push(
      diagnostic(
        "MASA_POLICY_DENIED",
        "/publication/policyEvaluation/result",
        "Publication lacks a permitted policy evaluation",
        "Do not publish until an attributable active policy evaluation explicitly permits this target",
      ),
    );
    return;
  }
  const action = readString(evaluation, "action");
  if (action !== "publish" && action !== "matter.publish") {
    diagnostics.push(
      diagnostic(
        "MASA_POLICY_DENIED",
        "/publication/policyEvaluation/action",
        "The publication policy evaluation applies to another action",
        "Evaluate the publish action for this exact public projection",
      ),
    );
  }
  const recordId = readString(record, "id");
  if (recordId !== undefined && !readStringArray(evaluation, "targets").includes(recordId)) {
    diagnostics.push(
      diagnostic(
        "MASA_POLICY_DENIED",
        "/publication/policyEvaluation/targets",
        "The permitted evaluation does not target this public projection",
        "Add the public record identifier to an attributable publication evaluation",
      ),
    );
  }

  const policies = new Map(
    asJsonArray(record.policies)
      .filter(isJsonObject)
      .map((policy) => [readString(policy, "id"), policy] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[0] !== undefined),
  );
  const actionForRules = action === "matter.publish" ? "publish" : action;
  const evaluationTargets = new Set(readStringArray(evaluation, "targets"));
  // A prohibition also applies when it names an entity contained in the
  // projection, not only when it names the record identity itself.
  const containedIds = new Set(indexRecord(record as unknown as MatterRecord).byId.keys());
  const authorityRefs = new Set(readStringArray(evaluation, "authorityRefs"));
  const evaluatedAt = readString(evaluation, "evaluatedAt");
  let matchingPermission = false;
  readStringArray(evaluation, "policyRefs").forEach((policyRef, index) => {
    const policy = policies.get(policyRef);
    if (policy === undefined || policy.status !== "active" || policy.disclosure !== "public") {
      diagnostics.push(
        diagnostic(
          "MASA_POLICY_DENIED",
          `/publication/policyEvaluation/policyRefs/${index}`,
          "A publication policy is missing, inactive, or not public",
          "Include the active public policy account or refuse publication",
        ),
      );
      return;
    }
    const policyIndex = asJsonArray(record.policies).findIndex(
      (candidate) => readString(candidate, "id") === policyRef,
    );
    if (
      evaluatedAt !== undefined &&
      ((typeof policy.validFrom === "string" && Date.parse(evaluatedAt) < Date.parse(policy.validFrom)) ||
        (typeof policy.validUntil === "string" && Date.parse(evaluatedAt) > Date.parse(policy.validUntil)))
    ) {
      diagnostics.push(
        diagnostic(
          "MASA_POLICY_DENIED",
          `/publication/policyEvaluation/policyRefs/${index}`,
          "A publication evaluation falls outside the referenced policy validity interval",
          "Refuse publication or evaluate it under an active policy valid at the evaluation time",
        ),
      );
    }

    asJsonArray(policy.rules).forEach((rule, ruleIndex) => {
      if (!isJsonObject(rule)) return;
      const actions = new Set(readStringArray(rule, "actions"));
      const targets = new Set(readStringArray(rule, "targets"));
      const actionMatches =
        actionForRules !== undefined &&
        (actions.has(actionForRules) || actions.has("matter.publish"));
      if (!actionMatches) return;
      const targetsEvaluation = [...evaluationTargets].some((target) => targets.has(target));
      const targetsContainedEntity = [...targets].some((target) => containedIds.has(target));

      if (rule.effect === "prohibition" && (targetsEvaluation || targetsContainedEntity)) {
        diagnostics.push(
          diagnostic(
            "MASA_POLICY_DENIED",
            `/policies/${policyIndex}/rules/${ruleIndex}`,
            "A referenced policy explicitly prohibits publication of this target",
            "Refuse publication until an authorized policy revision resolves the prohibition",
          ),
        );
      }
      if (!targetsEvaluation) return;
      if (
        rule.effect === "permission" &&
        isJsonObject(rule.authorityBasis) &&
        rule.authorityBasis.state === "known"
      ) {
        matchingPermission = true;
        const ruleId = readString(rule, "id");
        if (ruleId !== undefined && !authorityRefs.has(ruleId)) {
          diagnostics.push(
            diagnostic(
              "MASA_POLICY_DENIED",
              "/publication/policyEvaluation/authorityRefs",
              "The publication evaluation omits its matching permission rule from authority references",
              "Reference the exact attributable permission rule used for this evaluation",
            ),
          );
        }
      }
    });
  });
  if (!matchingPermission) {
    diagnostics.push(
      diagnostic(
        "MASA_POLICY_DENIED",
        "/publication/policyEvaluation",
        "No referenced active public rule explicitly permits publication of this target",
        "Add an attributable permission with known authority for the exact publish action and target, or refuse publication",
      ),
    );
  }
}

function auditPublicString(value: string, instancePath: string, diagnostics: Diagnostic[]): void {
  if (ABSOLUTE_PATH.test(value) || value.startsWith("file:")) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_PATH",
        instancePath,
        "A public projection contains an absolute or personal filesystem locator",
        "Replace it with an authorized bundle-relative or public HTTPS locator",
      ),
    );
  }
  if (SECRET_VALUE.test(value)) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_SECRET",
        instancePath,
        "A public projection contains a value matching a credential pattern",
        "Remove and rotate the credential, then rebuild and re-audit the projection",
      ),
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.username !== "" || url.password !== "") {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_SECRET",
        instancePath,
        "A public URL contains embedded credentials",
        "Remove URL credentials and use a public locator without authentication material",
      ),
    );
  }
  if ([...url.searchParams.keys()].some((key) => /key|password|secret|signature|token/i.test(key))) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_SECRET",
        instancePath,
        "A public URL contains a credential-like query parameter",
        "Remove signed or credential-bearing query parameters from the public artifact",
      ),
    );
  }
  if (isPrivateHostname(url.hostname)) {
    diagnostics.push(
      diagnostic(
        "MASA_PUBLIC_PRIVATE_ENDPOINT",
        instancePath,
        "A public projection contains a loopback or private-network endpoint",
        "Remove the endpoint or replace it with an intentionally public service locator",
      ),
    );
  }
}
