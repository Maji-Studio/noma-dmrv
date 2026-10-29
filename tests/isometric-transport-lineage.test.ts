import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
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

describe("collectTransportEntityIds", () => {
  it("returns empty arrays when no lineages are provided", () => {
    expect(collectTransportEntityIds([])).toEqual({
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
    );
    expect(result.biocharProductIds.sort()).toEqual(["bp-1", "bp-2"]);
  });

  it("collects feedstock IDs from each lineage's feedstocks[], deduped", () => {
    const result = collectTransportEntityIds(
      [
        lineage({
          feedstocks: [
            { id: "fs-a", ownsTransport: true } as never,
            { id: "fs-b", ownsTransport: true } as never,
          ],
        }),
        lineage({
          feedstocks: [{ id: "fs-b", ownsTransport: true } as never, { id: "fs-c", ownsTransport: true } as never],
        }),
      ],
    );
    expect(result.feedstockIds.sort()).toEqual(["fs-a", "fs-b", "fs-c"]);
  });

  it("excludes earlier-run feedstocks without changing delivery scope", () => {
    const result = collectTransportEntityIds([lineage({
      feedstocks: [{ id: "earlier", ownsTransport: false } as never, { id: "owned", ownsTransport: true } as never],
      biocharProduct: { id: "product" } as never,
    })]);
    expect(result).toEqual({ feedstockIds: ["owned"], biocharProductIds: ["product"], sampleIds: [] });
  });

  it("handles lineages with missing biocharProduct without throwing", () => {
    const result = collectTransportEntityIds(
      [lineage({ biocharProduct: null })],
    );
    expect(result.biocharProductIds).toEqual([]);
  });

  it("keeps sample transport IDs empty", () => {
    const result = collectTransportEntityIds([]);
    expect(result.sampleIds).toEqual([]);
  });
});
