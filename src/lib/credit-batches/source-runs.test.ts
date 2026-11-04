import { describe, expect, it } from "vitest";
import type { OutputStockLayer } from "@/lib/output-stock/planner";
import { drawnSourceRunIds, heldLayers, productSourceRunIds, sharedSourceRunIds, type DrawnLayer } from "./source-runs";

describe("drawnSourceRunIds", () => {
  it("keeps every run a draw takes dry biochar from, once, in first-seen order", () => {
    expect(drawnSourceRunIds([
      { runs: [{ productionRunId: "b", dryMassKg: 2 }, { productionRunId: "a", dryMassKg: 1 }] },
      { runs: [{ productionRunId: "a", dryMassKg: 3 }, { productionRunId: "c", dryMassKg: 0.001 }] },
    ])).toEqual(["b", "a", "c"]);
  });

  it("nets a run across layers and drops one with no dry biochar, like the saved delivery lineage", () => {
    expect(drawnSourceRunIds([
      { runs: [{ productionRunId: "a", dryMassKg: 0 }, { productionRunId: "b", dryMassKg: 1 }] },
      { runs: [{ productionRunId: "c", dryMassKg: 1 }] },
      { runs: [{ productionRunId: "c", dryMassKg: -1 }] },
    ])).toEqual(["b"]);
  });

  it("returns none for an empty bin", () => {
    expect(drawnSourceRunIds([])).toEqual([]);
  });
});

describe("sharedSourceRunIds", () => {
  it("keeps a share with wet or dry mass, like the saved application lineage", () => {
    expect(sharedSourceRunIds([
      { productionRunId: "a", wetMassKg: 1, dryMassKg: 0 },
      { productionRunId: "b", wetMassKg: 0, dryMassKg: 0 },
      { productionRunId: "c", wetMassKg: 0, dryMassKg: 0.5 },
      { productionRunId: "a", wetMassKg: 2, dryMassKg: 1 },
    ])).toEqual(["a", "c"]);
  });
});

describe("productSourceRunIds", () => {
  it("keeps every drawn run layer, a residual one with no dry gram included, like the saved product lineage", () => {
    const layers: DrawnLayer[] = [
      { layerId: "a", runs: [{ productionRunId: "a", dryMassKg: 0 }] },
      { layerId: "b", runs: [{ productionRunId: "b", dryMassKg: 4 }] },
      { layerId: "a", runs: [{ productionRunId: "a", dryMassKg: 0 }] },
    ];
    expect(productSourceRunIds(layers)).toEqual(["a", "b"]);
    expect(drawnSourceRunIds(layers)).toEqual(["b"]);
  });
});

describe("heldLayers", () => {
  const layer = (id: string, placedAt: string, dryKg: string, solidsNumerator: bigint): OutputStockLayer => ({
    id, placedAt, postingSequence: BigInt(1), establishedDryBiocharKg: "1", ingredientDrySolidsKg: "0",
    remainingDryBiocharKg: dryKg, remainingSolidsKg: { numerator: solidsNumerator, denominator: BigInt(10_000) }, runs: [],
  });
  const AT = "2026-09-12T12:00:00.000Z";

  it("keeps layers placed by then with dry biochar or residual solids left", () => {
    expect(heldLayers([
      layer("dry", "2026-09-09T12:00:00.000Z", "5", BigInt(50_000)),
      layer("residual", "2026-09-09T12:00:00.000Z", "0", BigInt(1)),
      layer("empty", "2026-09-09T12:00:00.000Z", "0", BigInt(0)),
      layer("later", "2026-09-13T12:00:00.000Z", "5", BigInt(50_000)),
    ], AT).map(held => held.id)).toEqual(["dry", "residual"]);
  });
});
