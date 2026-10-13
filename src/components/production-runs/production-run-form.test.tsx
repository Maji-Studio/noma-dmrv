// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "11111111-1111-4111-8111-111111111111",
    facilities: [{ id: "11111111-1111-4111-8111-111111111111", timezone: "UTC" }],
  }),
}));
vi.mock("@/hooks/use-entities", () => ({ useEntityById: () => ({ data: undefined }) }));
vi.mock("@/components/forms/entity-select", () => ({
  EntitySelect: () => null,
  StorageLocationQuickAddDialog: () => null,
  useQuickAddDialog: () => ({ isOpen: false, open: vi.fn(), close: vi.fn() }),
}));
vi.mock("./production-run-feedstock-draw-row", () => ({ ProductionRunFeedstockDrawRow: () => null }));
vi.mock("./production-run-mix-bin-notice", () => ({ ProductionRunMixBinNotice: () => null }));
vi.mock("./production-readings-field", () => ({ ProductionReadingsField: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));

import { ProductionRunForm } from "./production-run-form";

const savedRun = {
  id: "55555555-5555-4555-8555-555555555555",
  version: 2,
  facilityId: "11111111-1111-4111-8111-111111111111",
  reactorId: "22222222-2222-4222-8222-222222222222",
  startTime: new Date("2026-07-15T08:00:00Z"),
  endTime: new Date("2026-07-15T12:00:00Z"),
  feedstockDraws: [{ storageLocationId: "33333333-3333-4333-8333-333333333333", wetMassKg: 100 }],
  feedstockMoisturePercent: 20,
  biocharOutputKg: 10,
  biocharMoisturePercent: 5,
  biocharStorageLocationId: "44444444-4444-4444-8444-444444444444",
} as unknown as ProductionRunWithRelations;

afterEach(cleanup);

describe("ProductionRunForm reopening", () => {
  it.each(["complete", "failed"] as const)("reopens a saved %s run without touching its end fields", async (status) => {
    const onSubmit = vi.fn();
    render(<ProductionRunForm productionRun={{ ...savedRun, status }} onSubmit={onSubmit} />);
    const endDate = document.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    const endTime = document.querySelector<HTMLInputElement>('input[name="endTime"]')!;
    expect(endDate.value).toBe("2026-07-15");
    expect(endTime.value).toBe("12:00");

    fireEvent.click(screen.getByRole("radio", { name: "Running" }));
    fireEvent.click(screen.getByRole("button", { name: "Update production run" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      status: "running", endTime: null, expectedVersion: savedRun.version,
    }));
    expect(endDate.value).toBe("2026-07-15");
    expect(endTime.value).toBe("12:00");
  });

  it("keeps the end-time field error for an already Running run", async () => {
    const onSubmit = vi.fn();
    render(<ProductionRunForm productionRun={{ ...savedRun, status: "running", endTime: null }} onSubmit={onSubmit} />);
    fireEvent.change(document.querySelector('input[name="endTime"]')!, { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Update production run" }));
    await screen.findByText("Choose Complete or clear the end time for a Running run.");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
