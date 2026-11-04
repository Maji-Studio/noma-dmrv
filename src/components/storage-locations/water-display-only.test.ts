/**
 * Water is display-only: behavior here and a type fence on planner inputs.
 * eslint.config.mjs prevents direct imports of replay/parts outside display
 * readers and indirect server access through storage-location components.
 */
import { describe, expect, it } from "vitest";
import type { OutputStockLayer, OutputStockRun } from "@/lib/output-stock/planner";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { buildHistoryDays } from "./output-stock-history-days";
import { buildStockLevelSeries } from "./stock-level-series";

const ADDED_AT = "2026-10-14T09:00:00.000Z";
const DRAWN_AT = "2026-10-14T11:00:00.000Z";
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

/** The keys of a type that name a wet or water figure; `never` when it has none. */
type WaterKeys<T> = Extract<keyof T, `${string}${"wet" | "Wet" | "water" | "Water"}${string}`>;
// Compiles only while the guards' layers and their runs carry no wet or water figure.
const LAYERS_CARRY_NO_WATER: [WaterKeys<OutputStockLayer>, WaterKeys<OutputStockRun>] extends [never, never] ? true : false = true;

describe("water is display only", () => {
  it("leaves water out of the chart and the history when there is less wet mass than solids", () => {
    expect(buildStockLevelSeries(lessWetThanSolids).points.at(-1)).toMatchObject({ dryKg: 70, waterKg: null, wetKg: 50 });
    expect(buildStockLevelSeries(withWater).points.at(-1)).toMatchObject({ dryKg: 70, waterKg: 5, wetKg: 75 });
    const parts = (entries: OutputStockHistoryEntry[]) => buildHistoryDays(entries, "UTC")[0].rows[0].parts.map(part => part.label);
    expect(parts(lessWetThanSolids)).toEqual(["Dry biochar"]);
    expect(parts(withWater)).toEqual(["Dry biochar", "Water, estimated"]);
  });

  it("gives the withdrawal and overdraw guards layers with no wet or water figure", () => {
    expect(LAYERS_CARRY_NO_WATER).toBe(true);
  });
});
