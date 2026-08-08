import { escapeJsonPointerSegment } from "./json.js";

export interface JsonVisit {
  value: unknown;
  instancePath: string;
  parent: unknown;
  key: number | string | undefined;
}

export type JsonVisitor = (visit: JsonVisit) => void;

/** Walk a JSON-compatible graph in deterministic object-key order. */
export function walkJson(value: unknown, visitor: JsonVisitor): void {
  const ancestors = new Set<object>();

  function walk(current: unknown, instancePath: string, parent: unknown, key?: number | string): void {
    visitor({ value: current, instancePath, parent, key });

    if (current === null || typeof current !== "object") {
      return;
    }
    if (ancestors.has(current)) {
      throw new TypeError(`MASA_JSON_CYCLE at ${instancePath || "/"}`);
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        current.forEach((child, index) => walk(child, `${instancePath}/${index}`, current, index));
        return;
      }

      const object = current as Record<string, unknown>;
      for (const childKey of Object.keys(object).sort()) {
        walk(
          object[childKey],
          `${instancePath}/${escapeJsonPointerSegment(childKey)}`,
          current,
          childKey,
        );
      }
    } finally {
      ancestors.delete(current);
    }
  }

  walk(value, "", undefined);
}

export function collectJsonStrings(value: unknown): Array<{ instancePath: string; value: string }> {
  const strings: Array<{ instancePath: string; value: string }> = [];
  walkJson(value, (visit) => {
    if (typeof visit.value === "string") {
      strings.push({ instancePath: visit.instancePath, value: visit.value });
    }
  });
  return strings;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asJsonArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown, key: string): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

export function readStringArray(value: unknown, key: string): readonly string[] {
  if (!isJsonObject(value) || !Array.isArray(value[key])) {
    return [];
  }
  return (value[key] as unknown[]).filter((candidate): candidate is string => typeof candidate === "string");
}
