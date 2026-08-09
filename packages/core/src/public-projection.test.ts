import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createPublicProjection,
  isCredentialParameterKey,
  isNonPublicHostname,
  isUnsafeFilesystemLocator,
} from "./public-projection.js";
import { stableStringify } from "./json.js";
import type { MatterRecord } from "./generated/index.js";

const PUBLIC_ID = "urn:uuid:99999999-9999-4999-8999-999999999999";

function publicationFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL("../../../examples/0.1.0/valid/publication.masa.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

describe("createPublicProjection", () => {
  it("decorrelates a distinct public identity from the private record", () => {
    const source = publicationFixture();
    const privateId = source.id as string;
    (source.publication as Record<string, unknown>).publicRecordId = PUBLIC_ID;

    const projection = createPublicProjection(source as unknown as MatterRecord);
    const serialized = stableStringify(projection.record);

    expect(serialized).not.toContain(privateId);
    expect((projection.record as unknown as Record<string, unknown>).id).toBe(PUBLIC_ID);
    const history = (projection.record as unknown as { history: { events: Array<{ recordId: string }> } }).history;
    expect(history.events.length).toBeGreaterThan(0);
    for (const event of history.events) {
      expect(event.recordId).toBe(PUBLIC_ID);
    }
  });

  it("records unapproved extension omissions inside the published Publication object", () => {
    const source = publicationFixture();
    source.extensions = { "evil:private-notes": { secret: "not for the public" } };

    const projection = createPublicProjection(source as unknown as MatterRecord);
    const publication = (projection.record as unknown as {
      publication: { omissions: Array<{ pointer: string; category: string }> };
    }).publication;

    const embedded = publication.omissions.some(
      (omission) => omission.pointer === "/extensions/evil:private-notes" && omission.category === "unapproved_extension",
    );
    expect(embedded).toBe(true);
    expect(stableStringify(projection.record)).not.toContain("not for the public");
    expect(
      projection.report.omissions.some((omission) => omission.pointer === "/extensions/evil:private-notes"),
    ).toBe(true);
  });

  it("redacts unsafe locators and secret configuration keys", () => {
    const source = publicationFixture();
    const representations = source.representations as Array<Record<string, unknown>>;
    representations[0]!.locator = { state: "known", value: "/Users/somebody/private/master.wav" };
    representations[0]!.extensions = {
      "example:provider": {
        accessToken: "synthetic-access-token",
        privateKey: "synthetic-private-key",
      },
    };
    (source.publication as Record<string, unknown>).approvedExtensionNamespaces = ["example:"];

    const projection = createPublicProjection(source as unknown as MatterRecord);
    const serialized = stableStringify(projection.record);

    expect(serialized).not.toContain("/Users/somebody/private/master.wav");
    expect(serialized).not.toContain("synthetic-access-token");
    expect(serialized).not.toContain("synthetic-private-key");
    expect(projection.report.redactions.some(({ category }) => category === "unsafe_locator")).toBe(true);
    expect(
      projection.report.redactions.filter(({ category }) => category === "provider_or_secret_configuration"),
    ).toHaveLength(2);
  });

  it("uses valid JSON Pointers for redactions inside approved extensions", () => {
    const source = publicationFixture();
    const representations = source.representations as Array<Record<string, unknown>>;
    representations[0]!.extensions = {
      "example:apiKey": "synthetic-namespaced-secret",
      "example:provider": {
        "foo/bar~baz": {
          openaiApiKey: "synthetic-prefixed-secret",
          token: "synthetic-token",
          "x-amz-security-token": "synthetic-session-credential",
        },
      },
    };
    (source.publication as Record<string, unknown>).approvedExtensionNamespaces = ["example:"];

    const projection = createPublicProjection(source as unknown as MatterRecord);

    expect(projection.report.redactions).toContainEqual({
      pointer: "/representations/0/extensions/example:provider/foo~1bar~0baz/token",
      category: "provider_or_secret_configuration",
    });
    expect(stableStringify(projection.record)).not.toContain("synthetic-token");
    expect(stableStringify(projection.record)).not.toContain("synthetic-session-credential");
    expect(stableStringify(projection.record)).not.toContain("synthetic-namespaced-secret");
    expect(stableStringify(projection.record)).not.toContain("synthetic-prefixed-secret");
  });

  it("recognizes private hostnames across canonical URL forms", () => {
    for (const hostname of [
      "localhost.",
      "device.local.",
      "fixture.test",
      "[::]",
      "[::1]",
      "[fe9a::1]",
      "[fd00::1]",
      "[fec0::1]",
      "[::127.0.0.1]",
      "[::ffff:7f00:1]",
      "[::ffff:c0a8:1]",
    ]) {
      expect(isNonPublicHostname(hostname), hostname).toBe(true);
    }
    for (const hostname of [
      "192.0.2.1",
      "198.18.0.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "[2001:db8::1]",
      "[3fff::1]",
      "[ff02::1]",
      "[64:ff9b:1::1]",
      "[64:ff9b::c0a8:1]",
      "[2002:c0a8:0101::1]",
      "[400::1]",
      "[2001:10::1]",
      "[2001:20::1]",
      "[2001:30::1]",
      "intranet",
    ]) {
      expect(isNonPublicHostname(hostname), hostname).toBe(true);
    }
    expect(isNonPublicHostname("192.0.0.9")).toBe(false);
    expect(isNonPublicHostname("[::ffff:0808:0808]")).toBe(false);
    expect(isNonPublicHostname("[64:ff9b::0808:0808]")).toBe(false);
    expect(isNonPublicHostname("[2002:0808:0808::1]")).toBe(false);
    expect(isNonPublicHostname("[2001:3::1]")).toBe(false);
    expect(isNonPublicHostname("example.org")).toBe(false);
    expect(isCredentialParameterKey("x-amz-signature")).toBe(true);
    expect(isCredentialParameterKey("X-Amz-Security-Token")).toBe(true);
    expect(isCredentialParameterKey("key")).toBe(true);
    expect(isCredentialParameterKey("monkey")).toBe(false);
    for (const locator of [
      "FILE:///Users/alice/private.wav",
      "  file:///Users/alice/private.wav",
      "../private/master.wav",
      "..\\private\\master.wav",
      "%2e%2e%2fprivate.wav",
      "%2e%2e%5cprivate.wav",
      "%252e%252e%252fprivate.wav",
      "~alice/private.wav",
      "C:private.wav",
    ]) {
      expect(isUnsafeFilesystemLocator(locator), locator).toBe(true);
    }
    expect(isUnsafeFilesystemLocator("media/preview.wav")).toBe(false);
  });
});
