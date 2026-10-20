/**
 * Water in the output history and chart is display only. With less wet mass
 * than solids both views leave water out (first test). No balance, guard,
 * preview or posting reads that water figure (second and third tests).
 *
 * What the guard tests prove, and how they would fail: the water figure exists
 * only in the replay (`stockWaterKg`, and the wet and solids of `replayStock`'s
 * states) in `@/lib/output-stock/stock-replay`. The scan fails as soon as any
 * module outside the display components imports that replay, which is the one
 * way a server guard, preview or posting path could reach the figure. The type
 * check fails to compile if the planner's layers, the only stock the
 * withdrawal and overdraw guards check a request against, gain a wet or water
 * field. Neither test can pass by construction: each reads the real sources.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { OutputStockLayer, OutputStockRun } from "@/lib/output-stock/planner";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { buildHistoryDays } from "./output-stock-history-days";
import { buildStockLevelSeries } from "./stock-level-series";

const ADDED_AT = "2026-10-14T09:00:00.000Z";
const DRAWN_AT = "2026-10-14T11:00:00.000Z";
const SRC = join(process.cwd(), "src");
/** Where the replay may be read: the bin's chart and history, which only display it. */
const DISPLAY_DIR = join("components", "storage-locations") + sep;
const REPLAY_MODULE = join("lib", "output-stock", "stock-replay.ts");
const REPLAY_IMPORT = /from\s+["'][^"']*\/stock-replay["']|import\(\s*["'][^"']*\/stock-replay["']\s*\)/;

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

/** Every non-test source file under `src`, relative to it. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name) ? [relative(SRC, path)] : [];
  });
}

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

  it("is read only by the display components: no guard, preview or posting path imports the replay", () => {
    const readers = sourceFiles(SRC).filter((file) => file !== REPLAY_MODULE && REPLAY_IMPORT.test(readFileSync(join(SRC, file), "utf8")));
    // The scan must find the known display readers, or it proves nothing.
    expect(readers).toContain(join(DISPLAY_DIR, "stock-level-series.ts"));
    expect(readers).toContain(join(DISPLAY_DIR, "output-stock-history-days.ts"));
    expect(readers.filter((file) => !file.startsWith(DISPLAY_DIR))).toEqual([]);
  });

  it("gives the withdrawal and overdraw guards layers with no wet or water figure", () => {
    expect(LAYERS_CARRY_NO_WATER).toBe(true);
  });
});
