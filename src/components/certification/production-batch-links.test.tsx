import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRemovalProductionBatches } from "@/hooks/use-certification";
import { ProductionBatchLinks } from "./production-batch-links";

vi.mock("@/hooks/use-certification", () => ({
  useRemovalProductionBatches: vi.fn(),
}));

const BASE_BATCH = {
  creditBatchId: "00000000-0000-4000-8000-000000000001",
  creditBatchCode: "CB-2026-001",
  externalProductionBatchId: "ptb_1KZ90J63TSBX9M2P",
  externalProjectId: "prj_1K9YJ33RKSBX9FFF",
  externalFacilityId: "fcl_1KST05ZW3SBXZCM7",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ProductionBatchLinks", () => {
  it("links each registered identity using its mapping snapshots", () => {
    vi.mocked(useRemovalProductionBatches).mockReturnValue({
      data: [BASE_BATCH],
    } as never);

    const html = renderToStaticMarkup(
      <ProductionBatchLinks
        removalId="00000000-0000-4000-8000-000000000002"
        isProduction={false}
        enabled
      />,
    );

    expect(html).toContain("Isometric production batches (1)");
    expect(html).toContain("CB-2026-001 · ptb_1KZ90J63TSBX9M2P");
    expect(html).toContain("<a");
    expect(html).toContain(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities/fcl_1KST05ZW3SBXZCM7/production-batches/ptb_1KZ90J63TSBX9M2P",
    );
    expect(html).toContain("View on Isometric ↗");
  });

  it("keeps the identity visible without an anchor for a legacy row", () => {
    vi.mocked(useRemovalProductionBatches).mockReturnValue({
      data: [
        {
          ...BASE_BATCH,
          externalProjectId: null,
          externalFacilityId: null,
        },
      ],
    } as never);

    const html = renderToStaticMarkup(
      <ProductionBatchLinks
        removalId="00000000-0000-4000-8000-000000000002"
        isProduction={false}
        enabled
      />,
    );

    expect(html).toContain("CB-2026-001 · ptb_1KZ90J63TSBX9M2P");
    expect(html).not.toContain("<a");
  });
});
