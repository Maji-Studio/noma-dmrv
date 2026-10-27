import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema/feedstock";
import { FeedstockTypeForm } from "./feedstock-type-form";

vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: () => ({ data: { mapping: { provider: "isometric" } } }),
  useIsometricFeedstockTypes: () => ({ data: [{ id: "fst_1", name: "Registry wood chips" }] }),
}));
const linkLock = vi.hoisted(() => ({
  data: undefined as undefined | { locked: boolean; removals: { id: string; code: string; facilityId: string }[] },
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));
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

beforeEach(() => {
  Object.assign(linkLock, {
    data: undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
});

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

  it("gives an unlinked saved pyrolysis type the Isometric source card with its edit description", () => {
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={savedType} />);
    expect(html).toContain("Link this type to its Isometric registry entry.");
    expect(html).toContain("The local type used by bins, deliveries and production runs.");
    expect(html).not.toContain("Link to Isometric</");
  });

  it("shows the registry name only, with no Linked to notice, while unlocked", () => {
    linkLock.data = { locked: false, removals: [] };
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={{ ...savedType, isometricFeedstockTypeId: "fst_1" }} />);
    expect(html).toContain("Registry wood chips");
    expect(html).not.toContain("fst_1");
    expect(html).not.toContain("Linked to Isometric");
    expect(html).toContain("Link this type to its Isometric registry entry.");
  });

  it("shows a locked link read-only with the Removal as a link and no source cards", () => {
    linkLock.data = { locked: true, removals: [{ id: "rem-1", code: "REM-001", facilityId: "facility-2" }] };
    const html = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={{ ...savedType, isometricFeedstockTypeId: "fst_1" }} />);
    expect(html).toContain("sent to Isometric with");
    expect(html).toContain("REM-001");
    expect(html).toContain("removal=rem-1");
    expect(html).toContain("facility=facility-2");
    expect(html).not.toContain("Link this type to its Isometric registry entry.");
  });

  it("offers no change while the lock read is pending or failed", () => {
    const linked = { ...savedType, isometricFeedstockTypeId: "fst_1" };
    linkLock.isPending = true;
    const pending = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={linked} />);
    expect(pending).toContain("Checking whether this record can change.");
    expect(pending).not.toContain("Link this type to its Isometric registry entry.");
    linkLock.isPending = false;
    linkLock.isError = true;
    const failed = renderToStaticMarkup(<FeedstockTypeForm onSubmit={vi.fn()} feedstockType={linked} />);
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("Link this type to its Isometric registry entry.");
  });
});
