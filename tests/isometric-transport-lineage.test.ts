import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import { collectTransportEntityIds } from "@/lib/isometric/utils/transport-lineage";

function lineage(
  overrides: Partial<ChainOfCustodyData>,
): ChainOfCustodyData {
  return {
    facility: { id: "f", code: "F", name: "F" },
    application: {} as never,
    delivery: {} as never,
    order: null,
    biocharProduct: null,
    productionRun: null,
    reactor: null,
    feedstocks: [],
    warnings: [],
    ...overrides,
  } as ChainOfCustodyData;
}

function run(id: string, sampleIds: string[]): ProductionRunWithSamples {
  return {
    id,
    samples: sampleIds.map((sid) => ({ id: sid })),
  } as unknown as ProductionRunWithSamples;
}

describe("collectTransportEntityIds", () => {
  it("returns empty arrays when no lineages or runs are provided", () => {
    expect(collectTransportEntityIds([], [])).toEqual({
      feedstockIds: [],
      biocharProductIds: [],
      sampleIds: [],
    });
  });

  it("collects biochar product IDs across lineages, deduped", () => {
    const result = collectTransportEntityIds(
      [
        lineage({ biocharProduct: { id: "bp-1" } as never }),
        lineage({ biocharProduct: { id: "bp-2" } as never }),
        lineage({ biocharProduct: { id: "bp-1" } as never }), // dup
      ],
      [],
    );
    expect(result.biocharProductIds.sort()).toEqual(["bp-1", "bp-2"]);
  });

  it("collects feedstock IDs from each lineage's feedstocks[], deduped", () => {
    const result = collectTransportEntityIds(
      [
        lineage({
          feedstocks: [
            { id: "fs-a" } as never,
            { id: "fs-b" } as never,
          ],
        }),
        lineage({
          feedstocks: [{ id: "fs-b" } as never, { id: "fs-c" } as never],
        }),
      ],
      [],
    );
    expect(result.feedstockIds.sort()).toEqual(["fs-a", "fs-b", "fs-c"]);
  });

  it("collects sample IDs from every run, deduped", () => {
    const result = collectTransportEntityIds(
      [],
      [run("pr-1", ["s-1", "s-2"]), run("pr-2", ["s-2", "s-3"])],
    );
    expect(result.sampleIds.sort()).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("handles lineages with missing biocharProduct without throwing", () => {
    const result = collectTransportEntityIds(
      [lineage({ biocharProduct: null })],
      [],
    );
    expect(result.biocharProductIds).toEqual([]);
  });

  it("handles runs with no samples without producing entries", () => {
    const result = collectTransportEntityIds([], [run("pr-1", [])]);
    expect(result.sampleIds).toEqual([]);
  });
});
