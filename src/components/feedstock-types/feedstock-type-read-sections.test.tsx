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
  const field = feedstockTypeSheetSections(feedstockType, null, isProduction)[0].fields.find(
    (f) => f.label === "Isometric feedstock ID",
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
