import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readingState = vi.hoisted(() => ({
  readings: [] as Array<{
    id: string;
    timestamp: Date;
    temperatureC: number | null;
    pressureBar: number | null;
    dryerFrequencyHz: number | null;
    reactorFrequencyHz: number | null;
  }>,
}));

vi.mock("@/hooks/use-production-run-readings", () => ({
  useProductionRunReadings: () => ({
    data: readingState.readings,
    isLoading: false,
    error: null,
  }),
  useDeleteAllProductionRunReadings: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));

import { ProductionRunReadingTable } from "./production-run-reading-table";

beforeEach(() => {
  readingState.readings = [];
});

describe("ProductionRunReadingTable", () => {
  it("renders nothing when the run has no readings", () => {
    const html = renderToStaticMarkup(
      <ProductionRunReadingTable productionRunId="run-1" />,
    );

    expect(html).toBe("");
  });

  it("renders imported readings as a compact scrollable preview", () => {
    readingState.readings = [
      {
        id: "reading-1",
        timestamp: new Date("2026-07-21T08:00:00.000Z"),
        temperatureC: 550,
        pressureBar: 1.08,
        dryerFrequencyHz: 42,
        reactorFrequencyHz: 36,
      },
    ];

    const html = renderToStaticMarkup(
      <ProductionRunReadingTable productionRunId="run-1" compact />,
    );

    expect(html).toContain("Imported readings (1)");
    expect(html).toContain("max-h-[240px]");
    expect(html).toContain("550.0");
    expect(html).not.toContain("Production Reading Records");
  });
});
