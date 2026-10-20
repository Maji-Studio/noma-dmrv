// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOutputStockBalance } from "@/hooks/use-output-stock";
import { ProductionRunMixBinNotice } from "./production-run-mix-bin-notice";

vi.mock("@/hooks/use-output-stock", () => ({
  useOutputStockBalance: vi.fn(() => ({ data: undefined })),
}));

const PROPS = {
  binId: "bin-id",
  facilityId: "facility-id",
  startDate: "2026-10-18",
  endDate: "",
  endTime: "17:00",
  timeZone: "Africa/Dar_es_Salaam",
  complete: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductionRunMixBinNotice", () => {
  it("checks a completed run at its facility-local end on the start date when the end date is empty", () => {
    render(<ProductionRunMixBinNotice {...PROPS} />);
    expect(useOutputStockBalance).toHaveBeenLastCalledWith(
      { storageLocationId: "bin-id", facilityId: "facility-id" },
      "2026-10-18T14:00:00.000Z",
    );
  });

  it.each([
    { complete: false },
    { endTime: "" },
    { startDate: "2026-03-08", endTime: "02:30", timeZone: "America/New_York" },
  ])("does not query an unfinished or refused end (%j)", (overrides) => {
    render(<ProductionRunMixBinNotice {...PROPS} {...overrides} />);
    expect(useOutputStockBalance).toHaveBeenLastCalledWith(null, undefined);
  });
});
