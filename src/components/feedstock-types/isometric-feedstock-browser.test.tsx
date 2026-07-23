import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema";

const IMPORTED_ID = "feedstock_type_imported";
const AVAILABLE_ID = "feedstock_type_available";

const importedFeedstockType: FeedstockType = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-1",
  code: "FT-001",
  name: "Imported wood chips",
  category: "forestry",
  usage: "pyrolysis",
  description: null,
  registryUrl: null,
  isometricFeedstockTypeId: IMPORTED_ID,
  archivedAt: null,
  createdAt: new Date("2026-07-23T00:00:00Z"),
  updatedAt: new Date("2026-07-23T00:00:00Z"),
};

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: { mapping: { id: "mapping-1" } },
    isLoading: false,
    error: null,
  }),
  useIsometricFeedstockTypes: () => ({
    data: [
      {
        id: IMPORTED_ID,
        name: "Imported wood chips",
        supplier_reference_id: null,
      },
      {
        id: AVAILABLE_ID,
        name: "Available nutshells",
        supplier_reference_id: null,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-feedstock-types", () => ({
  useFeedstockTypeList: () => ({
    data: [importedFeedstockType],
    isLoading: false,
    error: null,
  }),
}));

import { IsometricFeedstockBrowser } from "./isometric-feedstock-browser";

describe("IsometricFeedstockBrowser", () => {
  it("disables catalogue entries that are already imported", () => {
    const html = renderToStaticMarkup(
      <IsometricFeedstockBrowser onSelect={vi.fn()} selectedId={null} />,
    );

    expect(html).toContain(
      `data-testid="isometric-feedstock-option-${IMPORTED_ID}" disabled=""`,
    );
    expect(html).toContain("Imported");
    expect(html).not.toContain(
      `data-testid="isometric-feedstock-option-${AVAILABLE_ID}" disabled=""`,
    );
  });
});
