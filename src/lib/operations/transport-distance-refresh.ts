import { refreshDeliveryDistanceInTransaction, refreshFeedstockDistanceInTransaction } from "@/data-access/transport-distance-refresh";
import type { TransportDistanceDrift } from "@/data-access/transport-distance-drift";
import { resolveWriteActivityScopes } from "@/data-access/write-activity";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { refreshTransportDistanceSchema } from "@/schemas/transport-distance-refresh";
import type { Operation } from "./runner";

/** UI-only deliberate refreshes; neither operation is in the public registry. */
export const refreshFeedstockDistance: Operation<typeof refreshTransportDistanceSchema, TransportDistanceDrift> = {
  id: "refresh_feedstock_distance", input: refreshTransportDistanceSchema, supportsDryRun: false,
  describe: (input, output) => ({
    outcome: "updated", entityType: "feedstock", entityIds: [input.entityId],
    versionBefore: input.expectedVersion, versionAfter: output.expectedVersion,
    changedFields: ["transportDistanceKm", "transportDistanceSource"],
  }),
  execute: async ({ ctx, tx, activity, afterCommit }, input) => {
    const result = await refreshFeedstockDistanceInTransaction(ctx, tx, input);
    activity.link({ facilityId: result.facilityId });
    activity.scope(input.entityId, await resolveWriteActivityScopes(ctx, tx, "feedstock", input.entityId));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return result;
  },
};

export const refreshDeliveryDistance: Operation<typeof refreshTransportDistanceSchema, TransportDistanceDrift> = {
  id: "refresh_delivery_distance", input: refreshTransportDistanceSchema, supportsDryRun: false,
  describe: (input, output) => ({
    outcome: "updated", entityType: "delivery", entityIds: [input.entityId],
    versionBefore: input.expectedVersion, versionAfter: output.expectedVersion,
    changedFields: ["recordedDistanceKm", "recordedDistanceSource", "distanceSource"],
  }),
  execute: async ({ ctx, tx, activity, afterCommit }, input) => {
    const result = await refreshDeliveryDistanceInTransaction(ctx, tx, input);
    activity.link({ facilityId: result.facilityId });
    activity.scope(input.entityId, await resolveWriteActivityScopes(ctx, tx, "delivery", input.entityId));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return result;
  },
};
