import { describe, expect, it } from "vitest";
import { formatMassKg } from "@/lib/format-utils";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { stockWaterKg } from "@/lib/output-stock/stock-replay";
import { buildHistoryDays, entrySentence } from "./output-stock-history-days";

const TZ = "UTC";
const DAY_ONE = "2026-10-14";
const DAY_TWO = "2026-10-15";

function entry(values: Partial<OutputStockHistoryEntry> & Pick<OutputStockHistoryEntry, "id" | "kind">): OutputStockHistoryEntry {
  return { occurredAt: `${DAY_ONE}T09:00:00.000Z`, recordedAt: `${DAY_ONE}T09:00:00.000Z`, actorName: "Asha", reason: "", wetMassKg: null,
    moisturePercent: 20, dryMassKg: 0, beforeDryKg: 0, afterDryKg: 0, correctsMovementId: null, deliveryId: null, allocations: [], ...values };
}

/** A product placed in the bin: 500 kg wet, 240 kg dry biochar, 150 kg compost solids. */
const placed = entry({ id: "p1", kind: "intake", wetMassKg: 500, dryMassKg: -240, wetDeltaKg: 500, solidsDeltaKg: 390,
  ingredientSolidsDeltas: [{ name: "Compost", solidsKg: 150 }], allocations: [{ layerId: "p1", code: "BP-001", wetMassKg: 500, dryMassKg: 240, runs: [] }] });
/** A delivery the next day taking 100 kg wet: 48 kg dry biochar, 30 kg compost solids. */
const delivered = entry({ id: "d1", kind: "delivery", eventKind: "delivery", occurredAt: `${DAY_TWO}T14:20:00.000Z`, recordedAt: `${DAY_TWO}T14:20:00.000Z`,
  wetMassKg: 100, dryMassKg: 48, wetDeltaKg: -100, solidsDeltaKg: -78, ingredientSolidsDeltas: [{ name: "Compost", solidsKg: -30 }] });

describe("buildHistoryDays", () => {
  it("groups entries by facility day, newest first, with the stock at each day's end", () => {
    const days = buildHistoryDays([placed, delivered], TZ);
    expect(days.map(day => day.day)).toEqual(["Oct 15, 2026", "Oct 14, 2026"]);
    expect(days[0].end).toMatchObject({ wetKg: 400, dryKg: 192, solidsKg: 312 });
    expect(days[1].end).toMatchObject({ wetKg: 500, dryKg: 240 });
  });

  it("orders a day's rows newest first and replays a back-dated entry on its own day", () => {
    const late = entry({ id: "l1", kind: "loss", eventKind: "loss", occurredAt: `${DAY_ONE}T18:00:00.000Z`, recordedAt: `${DAY_TWO}T20:00:00.000Z`,
      wetMassKg: 10, dryMassKg: 5, wetDeltaKg: -10, solidsDeltaKg: -8 });
    const days = buildHistoryDays([placed, delivered, late], TZ);
    expect(days[1].rows.map(row => row.entry.id)).toEqual(["l1", "p1"]);
    expect(days[1].end.wetKg).toBe(490);
    expect(days[0].end.wetKg).toBe(390);
  });

  it("works out what changed per part, with water as wet less solids and wet mass as the total", () => {
    const [today] = buildHistoryDays([placed, delivered], TZ);
    const row = today.rows[0];
    expect(row.parts).toEqual([
      { label: "Dry biochar", changeKg: -48, afterKg: 192 },
      { label: "Compost solids", changeKg: -30, afterKg: 120 },
      { label: "Water, estimated", changeKg: -22, afterKg: 88, estimated: true },
    ]);
    expect(row.wet).toEqual({ changeKg: -100, afterKg: 400 });
  });

  it("leaves out a part the entry did not change and a water figure with no honest value", () => {
    const biochar = entry({ id: "b1", kind: "intake", wetMassKg: 100, dryMassKg: -80, wetDeltaKg: 100, solidsDeltaKg: 80, occurredAt: `${DAY_TWO}T10:00:00.000Z` });
    const wetter = entry({ id: "w1", kind: "delivery", wetMassKg: 50, dryMassKg: 10, wetDeltaKg: -50, solidsDeltaKg: -10, occurredAt: `${DAY_TWO}T11:00:00.000Z` });
    const [day] = buildHistoryDays([biochar, wetter], TZ);
    // Taking more wet mass than the records hold leaves less wet stock than solids: no water figure.
    expect(day.rows[0].parts.map(part => part.label)).toEqual(["Dry biochar"]);
    expect(day.rows[1].parts.map(part => part.label)).toEqual(["Dry biochar", "Water, estimated"]);
    expect(stockWaterKg({ solidsKg: 80, wetKg: 20 })).toBeNull();
  });

  it("keeps a replaced entry struck as Replaced, folds its reversal, and lets the correction count", () => {
    const loss = entry({ id: "l1", kind: "loss", eventKind: "loss", occurredAt: `${DAY_TWO}T08:00:00.000Z`, wetMassKg: 120, dryMassKg: 70, wetDeltaKg: -120, solidsDeltaKg: -70, reason: "Spilled" });
    const reversal = entry({ id: "r1", kind: "reversal", correctsMovementId: "l1", occurredAt: loss.occurredAt, recordedAt: `${DAY_TWO}T16:00:00.000Z`, dryMassKg: -70, wetDeltaKg: 120, solidsDeltaKg: 70 });
    const fixed = entry({ id: "f1", kind: "replacement", eventKind: "loss", correctsMovementId: "l1", occurredAt: loss.occurredAt, recordedAt: `${DAY_TWO}T16:00:00.000Z`,
      wetMassKg: 60, dryMassKg: 35, wetDeltaKg: -60, solidsDeltaKg: -35, reason: "Scale misread" });
    const [day] = buildHistoryDays([placed, loss, reversal, fixed], TZ);
    expect(day.rows.map(row => [row.entry.id, row.status])).toEqual([["f1", "counts"], ["l1", "replaced"]]);
    const [correction, original] = day.rows;
    expect(original.replacedBy?.id).toBe("f1");
    expect(original.parts).toEqual([]);
    expect(correction.replaces?.id).toBe("l1");
    expect(correction.wet).toEqual({ changeKg: -60, afterKg: 440 });
    expect(day.end.wetKg).toBe(440);
    expect(entrySentence(correction, formatMassKg)).toBe("Corrected lost mass: 60 kg wet mass");
    expect(entrySentence(original, formatMassKg)).toBe("Lost 120 kg wet mass");
  });

  it("marks an entry reversed without a replacement as Reversed", () => {
    const reversal = entry({ id: "p1:placement", kind: "reversal", correctsMovementId: "p1", recordedAt: `${DAY_TWO}T09:00:00.000Z`, dryMassKg: 240, wetDeltaKg: -500, solidsDeltaKg: -390 });
    const [day] = buildHistoryDays([placed, reversal], TZ);
    expect(day.rows.map(row => [row.entry.id, row.status])).toEqual([["p1", "reversed"]]);
    expect(day.end).toMatchObject({ dryKg: 0, wetKg: 0 });
  });

  it("folds a reading's moisture row into its movement and keeps one movement on show with every figure", () => {
    const moisture = entry({ id: "d1:moisture", kind: "moisture_update", measuredByMovementId: "d1", occurredAt: delivered.occurredAt, wetDeltaKg: -100 });
    const days = buildHistoryDays([placed, delivered, moisture], TZ, "d1");
    expect(days).toHaveLength(1);
    expect(days[0].rows.map(row => row.entry.id)).toEqual(["d1"]);
    expect(days[0].rows[0].moistureEntry?.id).toBe("d1:moisture");
    // The folded row moves no stock: the delivery is counted once.
    expect(days[0].end.wetKg).toBe(400);
  });
});
