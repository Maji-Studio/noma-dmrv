import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema/feedstock";
import { FeedstockTypeForm } from "./feedstock-type-form";

vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: () => ({ data: { mapping: { provider: "isometric" } } }),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility-1" }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const savedType = { id: "type-1", name: "Wood chips", usage: "pyrolysis", category: "forestry", isometricFeedstockTypeId: null } as FeedstockType;

describe("FeedstockTypeForm certification marker", () => {
  it.each([
    { id: null, description: "Required for certification. Not provided." },
    { id: "fst_1", description: "Required for certification. Provided." },
  ])("reports the saved pyrolysis registry mapping ($id)", ({ id, description }) => {
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={{ ...savedType, isometricFeedstockTypeId: id }} />);
    expect(html).toContain("Isometric feedstock type");
    expect(html).toContain(description);
  });

  it("does not mark internal blend types", () => {
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={{ ...savedType, usage: "blend", category: "compost" }} />);
    expect(html).not.toContain("Required for certification");
  });

  it("keeps the create-mode marker neutral", () => {
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} defaultUsage="pyrolysis" />);
    expect(html).toContain("Required for certification");
    expect(html).not.toContain("Required for certification. Not provided.");
  });
});
