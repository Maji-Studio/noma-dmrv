import { describe, expect, it } from "vitest";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { buildStockLevelSeries } from "./stock-level-series";

const START = "2026-10-01T10:00:00.000Z";
const PLACED_AT = "2026-09-12T12:00:00.000Z";
const EARLIER = "2026-09-13T12:00:00.000Z";
const ORIGINAL_TIME = "2026-09-14T12:00:00.000Z";
const LATER = "2026-09-15T12:00:00.000Z";
const STOCK_KG = 100;
const DRAW_KG = 80;
const REMAINING_KG = 20;
function entry(overrides: Partial<OutputStockHistoryEntry>): OutputStockHistoryEntry {
  return { id: "intake", kind: "intake", occurredAt: START, recordedAt: START, actorName: null, reason: "", wetMassKg: 100,
    moisturePercent: 20, dryMassKg: -80, beforeDryKg: 0, afterDryKg: 80, correctsMovementId: null, deliveryId: null,
    allocations: [], wetDeltaKg: 100, solidsDeltaKg: 80, ...overrides };
}

function dryEntry(overrides: Partial<OutputStockHistoryEntry>): OutputStockHistoryEntry {
  const dryMassKg = overrides.dryMassKg ?? DRAW_KG;
  return entry({ kind: "delivery", occurredAt: ORIGINAL_TIME, recordedAt: ORIGINAL_TIME,
    wetMassKg: Math.abs(dryMassKg), moisturePercent: 0, dryMassKg,
    wetDeltaKg: -dryMassKg, solidsDeltaKg: -dryMassKg, ...overrides });
}
const placement = dryEntry({ id: "product", kind: "intake", occurredAt: PLACED_AT, dryMassKg: -STOCK_KG });

describe("stock level series", () => {
  it("moves an 80 kg delivery earlier without an extra draw or false empty-bin point", () => {
    const { points } = buildStockLevelSeries([placement,
      dryEntry({ id: "delivery" }),
      dryEntry({ id: "undo", kind: "reversal", correctsMovementId: "delivery", dryMassKg: -DRAW_KG }),
      dryEntry({ id: "corrected", kind: "replacement", eventKind: "delivery", correctsMovementId: "delivery", occurredAt: EARLIER }),
    ]);
    expect(points.filter(point => point.label !== "Before").every(point => point.dryKg > 0)).toBe(true);
    expect(points.filter(point => point.t === Date.parse(EARLIER))).toMatchObject([{ dryKg: REMAINING_KG }]);
    expect(points.filter(point => point.t === Date.parse(ORIGINAL_TIME))).toEqual([]);
    expect(points.at(-1)).toMatchObject({ dryKg: REMAINING_KG, waterKg: 0, ingredientsKg: 0 });
  });
  it("keeps 100 kg until an 80 kg delivery moves from 13 to 15 September", () => {
    const { points } = buildStockLevelSeries([placement,
      dryEntry({ id: "delivery", occurredAt: EARLIER }),
      dryEntry({ id: "undo", kind: "reversal", correctsMovementId: "delivery", occurredAt: EARLIER, dryMassKg: -DRAW_KG }),
      dryEntry({ id: "corrected", kind: "replacement", eventKind: "delivery", correctsMovementId: "delivery", occurredAt: LATER }),
    ]);
    expect(points.map(({ t, dryKg }) => ({ t, dryKg }))).toEqual([
      { t: Date.parse(PLACED_AT), dryKg: 0 },
      { t: Date.parse(PLACED_AT), dryKg: STOCK_KG },
      { t: Date.parse(LATER), dryKg: REMAINING_KG },
    ]);
  });
  it("plots only the last replacement in a chain of two corrections", () => {
    const { points } = buildStockLevelSeries([
      dryEntry({ id: "last", kind: "replacement", eventKind: "delivery", correctsMovementId: "first", occurredAt: LATER }),
      dryEntry({ id: "undo-first", kind: "reversal", correctsMovementId: "first", occurredAt: EARLIER, dryMassKg: -DRAW_KG }),
      placement,
      dryEntry({ id: "first", kind: "replacement", eventKind: "delivery", correctsMovementId: "delivery", occurredAt: EARLIER }),
      dryEntry({ id: "delivery" }),
      dryEntry({ id: "undo", kind: "reversal", correctsMovementId: "delivery", dryMassKg: -DRAW_KG }),
    ]);
    expect(points.filter(point => point.t > Date.parse(PLACED_AT))).toMatchObject([
      { t: Date.parse(LATER), dryKg: REMAINING_KG, label: "Delivery" },
    ]);
  });
  it("removes a deleted delivery without needing a replacement", () => {
    const { points } = buildStockLevelSeries([placement,
      dryEntry({ id: "delivery" }),
      dryEntry({ id: "undo", kind: "reversal", correctsMovementId: "delivery", occurredAt: LATER, dryMassKg: -DRAW_KG }),
    ]);
    expect(points).toEqual(buildStockLevelSeries([placement]).points);
  });
  it("cancels Lost mass with its reversal at the new time without a false spike", () => {
    const { points } = buildStockLevelSeries([placement,
      dryEntry({ id: "loss", kind: "loss" }),
      dryEntry({ id: "undo", kind: "reversal", correctsMovementId: "loss", occurredAt: LATER, dryMassKg: -DRAW_KG }),
      dryEntry({ id: "corrected", kind: "replacement", eventKind: "loss", correctsMovementId: "loss", occurredAt: LATER }),
    ]);
    expect(points.filter(point => point.t > Date.parse(PLACED_AT))).toMatchObject([
      { t: Date.parse(LATER), dryKg: REMAINING_KG },
    ]);
  });
  it("cancels a deleted product placement using its synthetic reversal id", () => {
    expect(buildStockLevelSeries([placement,
      dryEntry({ id: "delete:placement", kind: "reversal", correctsMovementId: placement.id, dryMassKg: STOCK_KG }),
    ]).points).toEqual([]);
  });
  it("replays a reversal whose target is absent so its balance still counts", () => {
    const orphan = dryEntry({ id: "undo", kind: "reversal", correctsMovementId: "absent", dryMassKg: -DRAW_KG });
    expect(buildStockLevelSeries([orphan]).points.at(-1)).toMatchObject({ dryKg: DRAW_KG, waterKg: 0 });
  });
  it("uses recorded wet deltas rather than resetting stock to a departure reading", () => {
    const result = buildStockLevelSeries([entry({}), entry({ id: "loss", kind: "loss", occurredAt: "2026-10-02T10:00:00.000Z",
      wetMassKg: 10, moisturePercent: 50, dryMassKg: 5, wetDeltaKg: -10, solidsDeltaKg: -5 })]);
    expect(result.points.at(-1)).toMatchObject({ dryKg: 75, waterKg: 15, ingredientsKg: 0 });
  });
  it("keeps product ingredient solids separate from estimated water", () => {
    const result = buildStockLevelSeries([entry({ dryMassKg: -60, solidsDeltaKg: 80 })]);
    expect(result.points.at(-1)).toMatchObject({ dryKg: 60, ingredientsKg: 20, waterKg: 20 });
  });
  it("plots only the corrected count, ignoring explanatory moisture rows", () => {
    const result = buildStockLevelSeries([entry({}),
      entry({ id: "count", kind: "count", dryMassKg: 10, wetDeltaKg: -20, solidsDeltaKg: -10 }),
      entry({ id: "reading", kind: "moisture_update", dryMassKg: 0, wetDeltaKg: -20 }),
      entry({ id: "undo", kind: "reversal", correctsMovementId: "count", dryMassKg: -10, wetDeltaKg: 20, solidsDeltaKg: 10 }),
      entry({ id: "replacement", kind: "replacement", eventKind: "count", correctsMovementId: "count", dryMassKg: 5, wetDeltaKg: -10, solidsDeltaKg: -5 }),
    ]);
    expect(result.points).toHaveLength(3);
    expect(result.points.at(-1)).toMatchObject({ dryKg: 75, waterKg: 15, label: "Stock count" });
  });
  it("leaves water unknown without a saved basis and records mode switches without changing mass", () => {
    const result = buildStockLevelSeries([entry({ wetDeltaKg: null }), entry({ kind: "merge" })]);
    expect(result.points.at(-1)?.waterKg).toBeNull();
    expect(result.modeChanges).toEqual([{ t: Date.parse(START), kind: "merge" }]);
  });
});
