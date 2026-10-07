import {
  createFeedstockInTransaction,
  updateFeedstockInTransaction,
  deleteFeedstockInTransaction,
  type FeedstockWithRelations,
  type CreateFeedstockResult,
} from "@/data-access/feedstocks";
import { resolveDistanceSource } from "@/schemas/distance-source";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { createFeedstockSchema, updateFeedstockSchema, deleteFeedstockSchema } from "@/schemas/feedstocks";
import type { Operation } from "./runner";

export const logFeedstockDelivery: Operation<
  typeof createFeedstockSchema,
  CreateFeedstockResult
> = {
  id: "log_feedstock_delivery",
  input: createFeedstockSchema,
  supportsDryRun: true,
  execute: ({ ctx, tx }, data) =>
    createFeedstockInTransaction(ctx, tx, {
      ...data,
      transportDistanceSource: resolveDistanceSource(
        data.transportDistanceKm,
        data.transportDistanceSource,
      ),
    }),
};

export const updateFeedstock: Operation<typeof updateFeedstockSchema, FeedstockWithRelations> = {
  id: "update_feedstock",
  input: updateFeedstockSchema,
  supportsDryRun: true,
  execute: async ({ ctx, tx, afterCommit }, { feedstockId, transportDistanceKm, transportDistanceSource, ...updateData }) => {
    const result = await updateFeedstockInTransaction(ctx, tx, feedstockId, {
      ...updateData,
      transportDistanceKm,
      transportDistanceSource: resolveDistanceSource(transportDistanceKm, transportDistanceSource),
    });
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return result;
  },
};

export const deleteFeedstock: Operation<typeof deleteFeedstockSchema, void> = {
  id: "delete_feedstock",
  input: deleteFeedstockSchema,
  supportsDryRun: true,
  execute: async ({ ctx, tx, afterCommit }, { feedstockId, expectedVersion }) => {
    await deleteFeedstockInTransaction(ctx, tx, feedstockId, expectedVersion);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
