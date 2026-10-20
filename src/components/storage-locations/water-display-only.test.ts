/**
 * Water in the output history and chart is display only. With less wet mass
 * than solids both views leave water out, and the withdrawal and overdraw
 * guards give the same result as when the same stock shows a water figure:
 * they check solids against the bin's layers, which carry no water.
 */
import { describe, expect, it } from "vitest";
import { InsufficientSolidsError, planOutputStock, type OutputStockLayer, type OutputStockRequest } from "@/lib/output-stock/planner";
import { replayStock } from "@/lib/output-stock/stock-replay";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { buildHistoryDays } from "./output-stock-history-days";
import { buildStockLevelSeries } from "./stock-level-series";

const ADDED_AT = "2026-10-14T09:00:00.000Z";
const DRAWN_AT = "2026-10-14T11:00:00.000Z";
const WITHDRAW_AT = "2026-10-14T12:00:00.000Z";

function entry(values: Partial<OutputStockHistoryEntry> & Pick<OutputStockHistoryEntry, "id" | "kind">): OutputStockHistoryEntry {
  return { occurredAt: ADDED_AT, recordedAt: ADDED_AT, actorName: null, reason: "", wetMassKg: null, moisturePercent: 20, dryMassKg: 0,
    beforeDryKg: 0, afterDryKg: 0, correctsMovementId: null, deliveryId: null, allocations: [], ...values };
}

/** A run of 100 kg wet at 20% moisture: 80 kg dry biochar. */
const run = entry({ id: "run", kind: "intake", wetMassKg: 100, dryMassKg: -80, wetDeltaKg: 100, solidsDeltaKg: 80 });
/** A delivery taking 10 kg dry biochar, with the wet change its preview froze. */
const delivery = (wetDeltaKg: number) => entry({ id: "delivery", kind: "delivery", eventKind: "delivery", occurredAt: DRAWN_AT, recordedAt: DRAWN_AT,
  wetMassKg: -wetDeltaKg, dryMassKg: 10, wetDeltaKg, solidsDeltaKg: -10 });

/** 50 kg wet under 70 kg solids: no honest water figure. */
const lessWetThanSolids = [run, delivery(-50)];
/** The same dry biochar and solids with 75 kg wet: 5 kg water. */
const withWater = [run, delivery(-25)];

/** The bin's one layer as the guards read it: the run's dry biochar, 10 kg of it drawn. Nothing here carries water. */
function layerAfter(entries: OutputStockHistoryEntry[]): OutputStockLayer {
  const remaining = String(replayStock(entries).at(-1)!.after.dryKg);
  return { id: "run", placedAt: ADDED_AT, postingSequence: BigInt(1), establishedDryBiocharKg: "80", ingredientDrySolidsKg: "0",
    remainingDryBiocharKg: remaining, runs: [{ productionRunId: "run", establishedDryKg: "80", remainingDryKg: remaining }] };
}

function guard(entries: OutputStockHistoryEntry[], request: OutputStockRequest) {
  try {
    const plan = planOutputStock([layerAfter(entries)], WITHDRAW_AT, request);
    return { drawnDryKg: plan.drawnDryKg, expectedSolidsKg: plan.expectedSolidsKg };
  } catch (error) {
    if (error instanceof InsufficientSolidsError) return { refused: error.message, availableSolidsKg: error.availableSolidsKg, requestedSolidsKg: error.requestedSolidsKg };
    throw error;
  }
}

describe("water is display only", () => {
  it("leaves water out of the chart and the history when there is less wet mass than solids", () => {
    expect(buildStockLevelSeries(lessWetThanSolids).points.at(-1)).toMatchObject({ dryKg: 70, waterKg: null, wetKg: 50 });
    expect(buildStockLevelSeries(withWater).points.at(-1)).toMatchObject({ dryKg: 70, waterKg: 5, wetKg: 75 });
    const parts = (entries: OutputStockHistoryEntry[]) => buildHistoryDays(entries, "UTC")[0].rows[0].parts.map(part => part.label);
    expect(parts(lessWetThanSolids)).toEqual(["Dry biochar"]);
    expect(parts(withWater)).toEqual(["Dry biochar", "Water, estimated"]);
  });

  it("gives the withdrawal and overdraw guards the same result with and without the water row", () => {
    const fits: OutputStockRequest = { kind: "wet", wetKg: "70", moisturePercent: "0" };
    const overdraws: OutputStockRequest = { kind: "wet", wetKg: "80", moisturePercent: "10" };
    expect(guard(lessWetThanSolids, fits)).toEqual(guard(withWater, fits));
    expect(guard(lessWetThanSolids, fits)).toMatchObject({ drawnDryKg: "70.000" });
    expect(guard(lessWetThanSolids, overdraws)).toEqual(guard(withWater, overdraws));
    // 80 kg wet at 10% is 72 kg solids against the 70 kg held, whichever wet figure the history shows.
    expect(guard(lessWetThanSolids, overdraws)).toMatchObject({ refused: "Insufficient exact dry solids" });
  });
});
