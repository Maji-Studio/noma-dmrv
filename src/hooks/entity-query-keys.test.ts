import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ENTITY_DETAIL_STALE_TIME_MS,
  ENTITY_LIST_STALE_TIME_MS,
  entityKeys,
  invalidateStockEntityQueries,
  type StockMutationType,
} from "./entity-query-keys";

describe("entity query keys", () => {
  it("keeps the intentional list and detail freshness windows", () => {
    expect(ENTITY_LIST_STALE_TIME_MS).toBe(30_000);
    expect(ENTITY_DETAIL_STALE_TIME_MS).toBe(60_000);
    expect(entityKeys.list("storageLocation", "north", { type: "product_bin" }))
      .toEqual([
        "entities",
        "storageLocation",
        "north",
        { type: "product_bin" },
      ]);
    expect(entityKeys.detail("storageLocation", "bin-1")).toEqual([
      "entity",
      "storageLocation",
      "bin-1",
    ]);
  });

  it.each<[
    StockMutationType,
    Array<"storageLocation" | "biocharProduct" | "order">,
  ]>([
    ["feedstock", ["storageLocation"]],
    ["productionRun", ["storageLocation"]],
    ["biocharProduct", ["storageLocation", "biocharProduct"]],
    ["delivery", ["storageLocation", "biocharProduct", "order"]],
    ["order", ["order"]],
    ["binMovement", ["storageLocation"]],
  ])("invalidates list and detail stock captions after %s writes", (mutation, types) => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    invalidateStockEntityQueries(queryClient, mutation);

    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual(
      types.flatMap((entityType) => [
        { queryKey: entityKeys.listPrefix(entityType) },
        { queryKey: entityKeys.detailPrefix(entityType) },
      ]),
    );
  });
});
