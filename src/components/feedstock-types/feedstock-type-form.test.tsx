import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema/feedstock";
import { FeedstockTypeForm } from "./feedstock-type-form";

vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: () => ({ data: { mapping: { provider: "isometric" } } }),
  useIsometricFeedstockTypes: () => ({ data: [{ id: "fst_1", name: "Registry wood chips" }] }),
}));
const linkLock = vi.hoisted(() => ({ data: undefined as undefined | { locked: boolean; removals: { id: string; label?: string }[] } }));
vi.mock("@/hooks/use-feedstock-types", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-feedstock-types")>(),
  useFeedstockTypeLinkLock: () => linkLock,
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

  it("offers Link to Isometric on an unlinked saved pyrolysis type", () => {
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={savedType} />);
    expect(html).toContain("Link to Isometric");
  });

  it("shows the registry name beside the id and offers a change while unlocked", () => {
    linkLock.data = { locked: false, removals: [] };
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={{ ...savedType, isometricFeedstockTypeId: "fst_1" }} />);
    expect(html).toContain("Registry wood chips (fst_1)");
    expect(html).toContain("Change Isometric link");
  });

  it("shows a locked link read-only with the Removal as a link", () => {
    linkLock.data = { locked: true, removals: [{ id: "rem-1", label: "REM-001" }] };
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={{ ...savedType, isometricFeedstockTypeId: "fst_1" }} />);
    expect(html).toContain("were sent in");
    expect(html).toContain("REM-001");
    expect(html).toContain("removal=rem-1");
    expect(html).not.toContain("Change Isometric link");
    expect(html).not.toContain("Link to Isometric");
    linkLock.data = undefined;
  });
});
