import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createPublicProjection } from "./public-projection.js";
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

    const projection = createPublicProjection(source as unknown as MatterRecord);
    const serialized = stableStringify(projection.record);

    expect(serialized).not.toContain("/Users/somebody/private/master.wav");
    expect(projection.report.redactions.some(({ category }) => category === "unsafe_locator")).toBe(true);
  });
});
