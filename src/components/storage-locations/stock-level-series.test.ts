import { describe, expect, it } from "vitest";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { buildStockLevelSeries } from "./stock-level-series";

const START = "2026-10-01T10:00:00.000Z";
function entry(overrides: Partial<OutputStockHistoryEntry>): OutputStockHistoryEntry {
  return { id: "intake", kind: "intake", occurredAt: START, recordedAt: START, actorName: null, reason: "", wetMassKg: 100,
    moisturePercent: 20, dryMassKg: -80, beforeDryKg: 0, afterDryKg: 80, correctsMovementId: null, deliveryId: null,
    allocations: [], wetDeltaKg: 100, solidsDeltaKg: 80, ...overrides };
}

describe("stock level series", () => {
  it("uses recorded wet deltas rather than resetting stock to a departure reading", () => {
    const result = buildStockLevelSeries([entry({}), entry({ id: "loss", kind: "loss", occurredAt: "2026-10-02T10:00:00.000Z",
      wetMassKg: 10, moisturePercent: 50, dryMassKg: 5, wetDeltaKg: -10, solidsDeltaKg: -5 })]);
    expect(result.points.at(-1)).toMatchObject({ dryKg: 75, waterKg: 15, ingredientsKg: 0 });
  });
  it("keeps product ingredient solids separate from estimated water", () => {
    const result = buildStockLevelSeries([entry({ dryMassKg: -60, solidsDeltaKg: 80 })]);
    expect(result.points.at(-1)).toMatchObject({ dryKg: 60, ingredientsKg: 20, waterKg: 20 });
  });
  it("replays a count once, then its reversal and replacement, ignoring explanatory moisture rows", () => {
    const result = buildStockLevelSeries([entry({}),
      entry({ id: "count", kind: "count", dryMassKg: 10, wetDeltaKg: -20, solidsDeltaKg: -10 }),
      entry({ id: "reading", kind: "moisture_update", dryMassKg: 0, wetDeltaKg: -20 }),
      entry({ id: "undo", kind: "reversal", correctsMovementId: "count", dryMassKg: -10, wetDeltaKg: 20, solidsDeltaKg: 10 }),
      entry({ id: "replacement", kind: "replacement", eventKind: "count", correctsMovementId: "count", dryMassKg: 5, wetDeltaKg: -10, solidsDeltaKg: -5 }),
    ]);
    expect(result.points).toHaveLength(5);
    expect(result.points.at(-1)).toMatchObject({ dryKg: 75, waterKg: 15, label: "Stock count" });
  });
  it("leaves water unknown without a saved basis and records mode switches without changing mass", () => {
    const result = buildStockLevelSeries([entry({ wetDeltaKg: null }), entry({ kind: "merge" })]);
    expect(result.points.at(-1)?.waterKg).toBeNull();
    expect(result.modeChanges).toEqual([{ t: Date.parse(START), kind: "merge" }]);
  });
});
