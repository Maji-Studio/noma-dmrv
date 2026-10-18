// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const BIN = {
  id: "bin-1",
  code: "SL-01",
  name: "Forestry waste",
  remainingMass: { wetKg: 1_000, dryKg: 800, dryLabel: "dry feedstock" as const },
};

vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: [BIN], dataUpdatedAt: 0, isLoading: false, error: null }),
  useEntityById: () => ({ data: BIN, dataUpdatedAt: 0, isPending: false, isError: false, error: null }),
}));

const availability = vi.hoisted(() => ({ availableKg: 1_000.3 - 0.0004 as number | null }));
vi.mock("@/hooks/use-stock-availability", () => ({
  useStockAvailability: () => ({ data: availability }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));

import { ProductionRunFeedstockDrawRow } from "./production-run-feedstock-draw-row";

function renderRow(onWetMassChange: (value: number | null) => void) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductionRunFeedstockDrawRow
        index={0}
        facilityId="facility-1"
        storageLocationId={BIN.id}
        wetMassKg={100}
        selectedStorageLocationIds={[BIN.id]}
        onStorageLocationChange={() => undefined}
        onWetMassChange={onWetMassChange}
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

afterEach(cleanup);

describe("ProductionRunFeedstockDrawRow Add all", () => {
  it("draws the whole remaining stock, floored to the stored precision", () => {
    availability.availableKg = 1_000.3 - 0.0004;
    const onWetMassChange = vi.fn();
    renderRow(onWetMassChange);

    fireEvent.click(screen.getByRole("button", { name: "Add all" }));

    expect(onWetMassChange).toHaveBeenCalledWith(1_000.299);
  });

  it("is hidden when nothing is available", () => {
    availability.availableKg = 0;
    renderRow(vi.fn());

    expect(screen.queryByRole("button", { name: "Add all" })).toBeNull();
  });
});
