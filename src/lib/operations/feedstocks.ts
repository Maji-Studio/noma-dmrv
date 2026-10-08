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
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";

/** Names of the fields the request supplied; the target id and precondition are not changes. */
function changedFields(input: object): string[] {
  return Object.entries(input)
    .filter(([key, value]) => value !== undefined && key !== "expectedVersion" && key !== "feedstockId")
    .map(([key]) => key).sort();
}

export const logFeedstockDelivery: Operation<
  typeof createFeedstockSchema,
  CreateFeedstockResult
> = {
  id: "log_feedstock_delivery",
  describe: (input, output) => ({
    outcome: "created", entityType: "feedstock", entityIds: output.feedstocks.map((item) => item.id),
    versionBefore: null, versionAfter: output.feedstocks[0]?.version ?? null,
    changedFields: changedFields(input),
  }),
  input: createFeedstockSchema,
  supportsDryRun: true,
  execute: ({ ctx, tx }, data) =>
    withFeedstockErrors(() => createFeedstockInTransaction(ctx, tx, {
      ...data,
      transportDistanceSource: resolveDistanceSource(
        data.transportDistanceKm,
        data.transportDistanceSource,
      ),
    })),
};

export const updateFeedstock: Operation<typeof updateFeedstockSchema, FeedstockWithRelations> = {
  id: "update_feedstock",
  describe: (input, output) => ({
    outcome: "updated", entityType: "feedstock", entityIds: [output.id],
    versionBefore: input.expectedVersion, versionAfter: output.version,
    changedFields: changedFields(input),
  }),
  input: updateFeedstockSchema,
  supportsDryRun: true,
  execute: async ({ ctx, tx, afterCommit }, { feedstockId, transportDistanceKm, transportDistanceSource, ...updateData }) => {
    const result = await withFeedstockErrors(() => updateFeedstockInTransaction(ctx, tx, feedstockId, {
      ...updateData,
      transportDistanceKm,
      transportDistanceSource: resolveDistanceSource(transportDistanceKm, transportDistanceSource),
    }));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return result;
  },
};

export const deleteFeedstock: Operation<typeof deleteFeedstockSchema, void> = {
  id: "delete_feedstock",
  describe: (input) => ({
    outcome: "deleted", entityType: "feedstock", entityIds: [input.feedstockId],
    versionBefore: input.expectedVersion, versionAfter: null, changedFields: [],
  }),
  input: deleteFeedstockSchema,
  supportsDryRun: true,
  execute: async ({ ctx, tx, afterCommit }, { feedstockId, expectedVersion }) => {
    await withFeedstockErrors(() => deleteFeedstockInTransaction(ctx, tx, feedstockId, expectedVersion));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
