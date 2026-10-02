import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const BIN = {
  id: "bin-1",
  code: "SL-01",
  name: "Forestry waste",
  remainingMass: { wetKg: 1_000, dryKg: 800, dryLabel: "dry feedstock" as const },
};

vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({
    data: [BIN],
    dataUpdatedAt: 0,
    isLoading: false,
    error: null,
  }),
  useEntityById: () => ({
    data: BIN,
    dataUpdatedAt: 0,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const availability = vi.hoisted(() => ({ availableKg: 1_000 as number | null }));
vi.mock("@/hooks/use-stock-availability", () => ({
  useStockAvailability: () => ({ data: availability }),
}));

vi.mock("@/components/storage-locations/storage-bin-actions", () => ({
  StorageBinActions: () => null,
}));

import { ProductionRunFeedstockDrawRow } from "./production-run-feedstock-draw-row";

function render(productionRunId?: string): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProductionRunFeedstockDrawRow
        index={0}
        facilityId="facility-1"
        productionRunId={productionRunId}
        storageLocationId={BIN.id}
        wetMassKg={1_000}
        selectedStorageLocationIds={[BIN.id]}
        onStorageLocationChange={() => undefined}
        onWetMassChange={() => undefined}
        onStorageLocationBlur={() => undefined}
        onWetMassBlur={() => undefined}
        storageLocationName="feedstockDraws.0.storageLocationId"
        wetMassName="feedstockDraws.0.wetMassKg"
        storageLocationRef={null}
        wetMassRef={null}
        onRemove={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("ProductionRunFeedstockDrawRow stock figure", () => {
  it("shows one figure on create: what is available in this bin", () => {
    availability.availableKg = 1_000;
    const html = render();

    expect(html).toContain("1,000 kg available in this bin");
    expect(html).not.toContain("Remaining now");
  });

  it("falls back to the bin's remaining stock when availability is unknown", () => {
    availability.availableKg = null;
    const html = render();

    expect(html).toContain("Remaining now: 1,000 kg wet, 800 kg dry feedstock");
    expect(html).not.toContain("available in this bin");
  });

  it("shows one figure on edit: what is available to this run", () => {
    // The run already draws 1,000 kg, so 2,000 kg is available to it while
    // the bin holds 1,000 kg now.
    availability.availableKg = 2_000;
    const html = render("run-1");

    expect(html).toContain("2,000 kg available to this run");
    expect(html).not.toContain("Remaining now");
  });
});
