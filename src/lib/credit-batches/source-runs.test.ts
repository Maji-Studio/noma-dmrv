import { describe, expect, it } from "vitest";
import { drawnSourceRunIds, sharedSourceRunIds } from "./source-runs";

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
