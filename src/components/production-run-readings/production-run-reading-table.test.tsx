import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const originalTimeZone = process.env.TZ;

beforeEach(() => {
  readingState.readings = [];
});

afterEach(() => {
  process.env.TZ = originalTimeZone;
});

describe("ProductionRunReadingTable", () => {
  it("renders nothing when the run has no readings", () => {
    const html = renderToStaticMarkup(
      <ProductionRunReadingTable productionRunId="run-1" timeZone="UTC" />,
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
      <ProductionRunReadingTable
        productionRunId="run-1"
        timeZone="UTC"
        compact
      />,
    );

    expect(html).toContain("Imported readings (1)");
    expect(html).toContain("max-h-[240px]");
    expect(html).toContain("550.0");
    expect(html).not.toContain("Production Reading Records");
  });

  it("renders readings in the facility zone, not the browser zone", () => {
    process.env.TZ = "Europe/Zurich";
    readingState.readings = [
      {
        id: "reading-1",
        timestamp: new Date("2026-07-17T05:00:00.000Z"),
        temperatureC: 550,
        pressureBar: 1.08,
        dryerFrequencyHz: null,
        reactorFrequencyHz: null,
      },
    ];

    const html = renderToStaticMarkup(
      <ProductionRunReadingTable
        productionRunId="run-1"
        timeZone="Africa/Dar_es_Salaam"
      />,
    );

    expect(html).toContain("Time (Africa/Dar es Salaam)");
    expect(html).toContain("2026-07-17 08:00 +03:00");
    expect(html).not.toContain("2026-07-17 07:00");
  });

  it("shows the changing offset across a facility DST boundary", () => {
    process.env.TZ = "Europe/Zurich";
    readingState.readings = [
      {
        id: "reading-before",
        timestamp: new Date("2026-03-08T06:30:00.000Z"),
        temperatureC: 500,
        pressureBar: 1,
        dryerFrequencyHz: null,
        reactorFrequencyHz: null,
      },
      {
        id: "reading-after",
        timestamp: new Date("2026-03-08T07:30:00.000Z"),
        temperatureC: 510,
        pressureBar: 1,
        dryerFrequencyHz: null,
        reactorFrequencyHz: null,
      },
    ];

    const html = renderToStaticMarkup(
      <ProductionRunReadingTable
        productionRunId="run-1"
        timeZone="America/New_York"
      />,
    );

    expect(html).toContain("2026-03-08 01:30 -05:00");
    expect(html).toContain("2026-03-08 03:30 -04:00");
  });
});
