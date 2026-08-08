export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const DANGEROUS_KEY = "__proto__";

/**
 * Bound scanner recursion so hostile deeply nested input produces a stable
 * diagnostic instead of exhausting the call stack in any later phase.
 */
const MAX_NESTING_DEPTH = 512;

export class StrictJsonError extends SyntaxError {
  readonly code:
    | "MASA_JSON_SYNTAX"
    | "MASA_JSON_DUPLICATE_KEY"
    | "MASA_JSON_DANGEROUS_KEY"
    | "MASA_JSON_DEPTH";
  readonly offset: number;
  readonly instancePath: string;

  constructor(
    code: StrictJsonError["code"],
    message: string,
    offset: number,
    instancePath: string,
  ) {
    super(message);
    this.name = "StrictJsonError";
    this.code = code;
    this.offset = offset;
    this.instancePath = instancePath;
  }
}

/**
 * Parse strict JSON while rejecting duplicate keys before JSON.parse can erase
 * evidence of them. The returned object graph uses null-prototype dictionaries,
 * limiting prototype pollution if extension data is inspected later.
 */
export function parseJsonStrict<T = unknown>(text: string): T {
  const scanner = new StrictJsonScanner(text);
  scanner.scan();

  try {
    const parsed = JSON.parse(text) as unknown;
    return toSafeJsonGraph(parsed) as T;
  } catch {
    throw new StrictJsonError("MASA_JSON_SYNTAX", "Input is not valid JSON", scanner.offset, "");
  }
}

/** Serialize JSON deterministically by sorting object keys at every depth. */
export function stableStringify(value: unknown, space?: number): string {
  const normalized = normalizeJson(value, new Set<object>(), "");
  const indentation = space === undefined ? undefined : Math.max(0, Math.min(10, Math.trunc(space)));
  return JSON.stringify(normalized, undefined, indentation);
}

export function cloneJson<T>(value: T): T {
  return normalizeJson(value, new Set<object>(), "") as T;
}

function normalizeJson(value: unknown, ancestors: Set<object>, pointer: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`MASA_JSON_NON_FINITE at ${pointer || "/"}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== "object") {
    throw new TypeError(`MASA_JSON_UNSUPPORTED_VALUE at ${pointer || "/"}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`MASA_JSON_CYCLE at ${pointer || "/"}`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => normalizeJson(item, ancestors, `${pointer}/${index}`));
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`MASA_JSON_NON_PLAIN_OBJECT at ${pointer || "/"}`);
    }

    const output: { [key: string]: JsonValue } = Object.create(null) as {
      [key: string]: JsonValue;
    };
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = normalizeJson(
        (value as Record<string, unknown>)[key],
        ancestors,
        `${pointer}/${escapeJsonPointerSegment(key)}`,
      );
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function toSafeJsonGraph(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toSafeJsonGraph);
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value)) {
      output[key] = toSafeJsonGraph(child);
    }
    return output;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new StrictJsonError(
      "MASA_JSON_SYNTAX",
      "A JSON number overflows the representable finite range",
      0,
      "",
    );
  }
  return value;
}

class StrictJsonScanner {
  private index = 0;
  private depth = 0;

  constructor(private readonly text: string) {}

  get offset(): number {
    return this.index;
  }

  private enterContainer(pointer: string): void {
    this.depth += 1;
    if (this.depth > MAX_NESTING_DEPTH) {
      throw new StrictJsonError(
        "MASA_JSON_DEPTH",
        `JSON nesting exceeds the supported depth of ${MAX_NESTING_DEPTH}`,
        this.index,
        pointer,
      );
    }
  }

  private leaveContainer(): void {
    this.depth -= 1;
  }

  scan(): void {
    this.skipWhitespace();
    this.scanValue("");
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      this.syntax("Unexpected content after the JSON value", "");
    }
  }

  private scanValue(pointer: string): void {
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === "{") {
      this.scanObject(pointer);
      return;
    }
    if (character === "[") {
      this.scanArray(pointer);
      return;
    }
    if (character === '"') {
      this.scanString(pointer);
      return;
    }
    if (character === "t") {
      this.scanLiteral("true", pointer);
      return;
    }
    if (character === "f") {
      this.scanLiteral("false", pointer);
      return;
    }
    if (character === "n") {
      this.scanLiteral("null", pointer);
      return;
    }
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      this.scanNumber(pointer);
      return;
    }
    this.syntax("Expected a JSON value", pointer);
  }

  private scanObject(pointer: string): void {
    this.enterContainer(pointer);
    try {
      this.scanObjectBody(pointer);
    } finally {
      this.leaveContainer();
    }
  }

  private scanObjectBody(pointer: string): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return;
    }

    const keys = new Set<string>();
    while (this.index < this.text.length) {
      if (this.text[this.index] !== '"') {
        this.syntax("Expected an object key", pointer);
      }
      const keyOffset = this.index;
      const key = this.scanString(pointer);
      const keyPointer = `${pointer}/${escapeJsonPointerSegment(key)}`;
      if (keys.has(key)) {
        throw new StrictJsonError(
          "MASA_JSON_DUPLICATE_KEY",
          "JSON object contains a duplicate member name",
          keyOffset,
          keyPointer,
        );
      }
      if (key === DANGEROUS_KEY) {
        throw new StrictJsonError(
          "MASA_JSON_DANGEROUS_KEY",
          "JSON object contains a prohibited prototype key",
          keyOffset,
          keyPointer,
        );
      }
      keys.add(key);

      this.skipWhitespace();
      this.expect(":", keyPointer);
      this.scanValue(keyPointer);
      this.skipWhitespace();
      const separator = this.text[this.index];
      if (separator === "}") {
        this.index += 1;
        return;
      }
      this.expect(",", pointer);
      this.skipWhitespace();
    }
    this.syntax("Unterminated JSON object", pointer);
  }

  private scanArray(pointer: string): void {
    this.enterContainer(pointer);
    try {
      this.scanArrayBody(pointer);
    } finally {
      this.leaveContainer();
    }
  }

  private scanArrayBody(pointer: string): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return;
    }

    let itemIndex = 0;
    while (this.index < this.text.length) {
      this.scanValue(`${pointer}/${itemIndex}`);
      itemIndex += 1;
      this.skipWhitespace();
      const separator = this.text[this.index];
      if (separator === "]") {
        this.index += 1;
        return;
      }
      this.expect(",", pointer);
      this.skipWhitespace();
    }
    this.syntax("Unterminated JSON array", pointer);
  }

  private scanString(pointer: string): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text.charCodeAt(this.index);
      if (character === 0x22) {
        this.index += 1;
        const raw = this.text.slice(start, this.index);
        try {
          return JSON.parse(raw) as string;
        } catch {
          this.syntax("Invalid JSON string", pointer);
        }
      }
      if (character < 0x20) {
        this.syntax("Unescaped control character in JSON string", pointer);
      }
      if (character === 0x5c) {
        this.index += 1;
        const escape = this.text[this.index];
        if (escape === "u") {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[A-Fa-f0-9]{4}$/.test(hex)) {
            this.syntax("Invalid Unicode escape in JSON string", pointer);
          }
          this.index += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          this.syntax("Invalid escape in JSON string", pointer);
        }
      }
      this.index += 1;
    }
    this.syntax("Unterminated JSON string", pointer);
  }

  private scanNumber(pointer: string): void {
    const remainder = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
    if (match === null) {
      this.syntax("Invalid JSON number", pointer);
    }
    this.index += match[0].length;
  }

  private scanLiteral(literal: "false" | "null" | "true", pointer: string): void {
    if (!this.text.startsWith(literal, this.index)) {
      this.syntax("Invalid JSON literal", pointer);
    }
    this.index += literal.length;
  }

  private expect(expected: string, pointer: string): void {
    if (this.text[this.index] !== expected) {
      this.syntax(`Expected '${expected}'`, pointer);
    }
    this.index += 1;
  }

  private skipWhitespace(): void {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r" ||
      this.text[this.index] === "\t"
    ) {
      this.index += 1;
    }
  }

  private syntax(message: string, pointer: string): never {
    throw new StrictJsonError("MASA_JSON_SYNTAX", message, this.index, pointer);
  }
}

export function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
