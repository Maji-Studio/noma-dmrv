import { describe, expect, it } from "vitest";
import type { DashboardStation, DashboardStationKey } from "./dashboard-stations";
import { buildDashboardStructuralGaps } from "./dashboard-structural-gaps";
import { withCrossCuttingAttention } from "./dashboard-station-attention";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const KEYS: DashboardStationKey[] = ["suppliers", "feedstock", "production", "products", "deliveries", "applications"];
const NO_BATCHES = { interrupted: 0, notSubmitted: 0 };

function stations(overrides: Partial<Record<DashboardStationKey, Partial<DashboardStation>>> = {}): DashboardStation[] {
  return KEYS.map((key) => ({
    key, name: key, total: 1, totalLabel: "", attention: 0, reasons: [], href: "#", ...overrides[key],
  }));
}

const byKey = (list: DashboardStation[]) => Object.fromEntries(list.map((station) => [station.key, station]));

describe("withCrossCuttingAttention", () => {
  it("lights the station each GPS gap belongs to", () => {
    const gaps = buildDashboardStructuralGaps({
      missingFeedstockGps: 2,
      missingFeedstockGpsSupplierId: "supplier-1",
      feedstockRouteGpsGaps: 7,
      feedstockRouteGpsTargetId: "feedstock-1",
      biocharRouteGpsGaps: 3,
      biocharRouteGpsTargetId: "product-1",
    }, FACILITY_ID);

    const result = byKey(withCrossCuttingAttention(stations(), gaps, NO_BATCHES, FACILITY_ID));

    // Each lights the station whose form fixes it, and its reason links to that form.
    expect(result.suppliers).toMatchObject({ attention: 2, reasons: [{ state: "warning", text: "2 feedstocks without supplier GPS", href: gaps[0]?.href }] });
    expect(result.feedstock).toMatchObject({ attention: 7, reasons: [{ state: "warning", text: "7 routes missing GPS", href: gaps[1]?.href }] });
    expect(result.products).toMatchObject({ attention: 3, reasons: [{ state: "warning", text: "3 routes missing GPS", href: gaps[2]?.href }] });
    expect(gaps[2]?.href).toContain("/biochar-products?");
    expect(result.deliveries?.attention).toBe(0);
  });

  it("puts credit batch rows on Production after its own problems and before running runs", () => {
    const result = byKey(withCrossCuttingAttention(
      stations({
        production: {
          attention: 2,
          reasons: [
            { state: "warning", text: "2 runs missing mass data" },
            { state: "in-progress", text: "1 running now", source: "runningRuns" },
          ],
        },
      }),
      [],
      { interrupted: 1, notSubmitted: 3 },
      FACILITY_ID,
    ));

    const batches = `/credit-batches?facility=${FACILITY_ID}`;
    expect(result.production?.attention).toBe(6);
    expect(result.production?.reasons).toEqual([
      { state: "error", text: "1 submission interrupted", href: `/removals?facility=${FACILITY_ID}` },
      { state: "warning", text: "2 runs missing mass data" },
      { state: "warning", text: "3 credit batches not submitted", href: batches },
      { state: "in-progress", text: "1 running now", source: "runningRuns" },
    ]);
  });

  it("leaves stations untouched when nothing cross-cutting is open", () => {
    const input = stations();
    expect(withCrossCuttingAttention(input, [], NO_BATCHES, FACILITY_ID)).toEqual(input);
  });
});
