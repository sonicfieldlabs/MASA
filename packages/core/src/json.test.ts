import { describe, expect, it } from "vitest";

import { parseJsonStrict, stableStringify, StrictJsonError } from "./json.js";

describe("parseJsonStrict", () => {
  it("preserves valid nested JSON in null-prototype dictionaries", () => {
    const parsed = parseJsonStrict<{ a: { b: number }; list: boolean[] }>(
      '{"a":{"b":2},"list":[true,false]}',
    );

    expect(parsed.a.b).toBe(2);
    expect(parsed.list).toEqual([true, false]);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
  });

  it("rejects duplicate decoded keys", () => {
    expect(() => parseJsonStrict('{"name":1,"na\\u006de":2}')).toThrowError(StrictJsonError);
    try {
      parseJsonStrict('{"name":1,"na\\u006de":2}');
    } catch (error) {
      expect(error).toMatchObject({ code: "MASA_JSON_DUPLICATE_KEY", instancePath: "/name" });
    }
  });

  it("rejects prototype keys", () => {
    expect(() => parseJsonStrict('{"__proto__":{}}')).toThrowError(
      expect.objectContaining({ code: "MASA_JSON_DANGEROUS_KEY" }),
    );
  });

  it("bounds nesting depth with a stable diagnostic instead of a stack overflow", () => {
    const nested = `${"[".repeat(600)}${"]".repeat(600)}`;
    expect(() => parseJsonStrict(nested)).toThrowError(
      expect.objectContaining({ code: "MASA_JSON_DEPTH" }),
    );

    const withinBounds = `${"[".repeat(500)}${"]".repeat(500)}`;
    expect(parseJsonStrict(withinBounds)).toEqual(JSON.parse(withinBounds));
  });

  it("rejects numbers that overflow to infinity", () => {
    expect(() => parseJsonStrict('{"v":1e999}')).toThrowError(
      expect.objectContaining({ code: "MASA_JSON_SYNTAX" }),
    );
  });
});

describe("stableStringify", () => {
  it("sorts keys recursively and preserves array order", () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] })).toBe(
      '{"a":{"b":3,"y":2},"list":[2,1],"z":1}',
    );
  });

  it("rejects values outside JSON", () => {
    expect(() => stableStringify({ value: Number.NaN })).toThrow(/MASA_JSON_NON_FINITE/);
  });
});
