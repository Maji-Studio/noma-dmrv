import type { QueryClient } from "@tanstack/react-query";
import type { EntityType } from "@/components/forms/entity-select/types";

export const entityKeys = {
  lists: () => ["entities"] as const,
  listPrefix: (entityType: EntityType) =>
    [...entityKeys.lists(), entityType] as const,
  list: (
    entityType: EntityType,
    search?: string,
    filterBy?: Record<string, string>,
  ) => [...entityKeys.listPrefix(entityType), search, filterBy] as const,
  details: () => ["entity"] as const,
  detailPrefix: (entityType: EntityType) =>
    [...entityKeys.details(), entityType] as const,
  detail: (entityType: EntityType, id: string | undefined) =>
    [...entityKeys.detailPrefix(entityType), id] as const,
};

export const ENTITY_LIST_STALE_TIME_MS = 30_000;
export const ENTITY_DETAIL_STALE_TIME_MS = 60_000;

const stockEntityDependencies = {
  feedstock: ["storageLocation"],
  productionRun: ["storageLocation"],
  biocharProduct: ["storageLocation", "biocharProduct"],
  delivery: ["storageLocation", "biocharProduct", "order"],
  order: ["order"],
  binMovement: ["storageLocation"],
} as const satisfies Record<string, readonly EntityType[]>;

export type StockMutationType = keyof typeof stockEntityDependencies;

/** Refresh EntitySelect stock captions after a successful inventory mutation. */
export function invalidateStockEntityQueries(
  queryClient: QueryClient,
  mutationType: StockMutationType,
) {
  for (const entityType of stockEntityDependencies[mutationType]) {
    void queryClient.invalidateQueries({
      queryKey: entityKeys.listPrefix(entityType),
    });
    void queryClient.invalidateQueries({
      queryKey: entityKeys.detailPrefix(entityType),
    });
  }
}
