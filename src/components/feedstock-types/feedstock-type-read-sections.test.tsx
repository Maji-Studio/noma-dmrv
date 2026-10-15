import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeedstockType } from "@/db/schema";
import { feedstockTypeSheetSections } from "./feedstock-type-read-sections";

const linked = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Wood chips",
  code: "FT-001",
  category: "forestry",
  usage: "pyrolysis",
  archivedAt: null,
  registryUrl: null,
  description: null,
  isometricFeedstockTypeId: "ftt_1",
} as unknown as FeedstockType;

function isometricField(feedstockType: FeedstockType, isProduction: boolean) {
  const field = feedstockTypeSheetSections(feedstockType, null, true, isProduction)[0].fields.find(
    (f) => f.label === "Isometric feedstock type",
  );
  return field?.value;
}

describe("feedstockTypeSheetSections Isometric link", () => {
  it("links a saved linked record to Certify in a new tab", () => {
    const html = renderToStaticMarkup(<>{isometricField(linked, true)}</>);
    expect(html).toContain("ftt_1");
    expect(html).toContain('href="https://to.isometric.com/certify/ftt_1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders no link on sandbox", () => {
    const html = renderToStaticMarkup(<>{isometricField(linked, false)}</>);
    expect(html).toContain("ftt_1");
    expect(html).not.toContain("<a");
  });

  it("shows no value for an unlinked record", () => {
    expect(isometricField({ ...linked, isometricFeedstockTypeId: null }, true)).toBeNull();
  });
});

describe("feedstockTypeSheetSections certification marker", () => {
  it.each([
    { hasIsometricCertifier: false, usage: "pyrolysis", certifyRequired: false },
    { hasIsometricCertifier: true, usage: "pyrolysis", certifyRequired: true },
    { hasIsometricCertifier: true, usage: "blend", certifyRequired: false },
  ] as const)(
    "sets certifyRequired to $certifyRequired for $usage with Isometric certifier $hasIsometricCertifier",
    ({ hasIsometricCertifier, usage, certifyRequired }) => {
      const field = feedstockTypeSheetSections(
        { ...linked, usage, isometricFeedstockTypeId: null },
        null,
        hasIsometricCertifier,
      )[0].fields.find((field) => field.label === "Isometric feedstock type");

      expect(field?.certifyRequired).toBe(certifyRequired);
    },
  );
});
