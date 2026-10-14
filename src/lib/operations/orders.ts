import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createOrderInTransaction, updateOrderInTransaction, deleteOrderInTransaction } from "@/data-access/orders";
import { getOrganizationDefaults } from "@/data-access/organization-settings";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { lockBiocharTransportRouteTopology } from "@/data-access/transport-legs";
import { orders, type Order } from "@/db/schema";
import { recordOrderInput, updateOrderInput, deleteOrderInput, type RecordOrderInput, type UpdateOrderInput } from "@/schemas/order-input";
import type { OperationEffect } from "@/lib/operation-effect";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
const NOT_CHANGES = new Set(["orderId", "expectedVersion"]);
function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}

export const describeRecordedOrder = (input: RecordOrderInput, output: Pick<Order, "id" | "version">): OperationEffect => ({ outcome: "created", entityType: "order", entityIds: [output.id],
    versionBefore: null, versionAfter: output.version, changedFields: changedFields(input) });
export const describeUpdatedOrder = (input: UpdateOrderInput, output: Pick<Order, "id" | "version">): OperationEffect => ({ outcome: "updated", entityType: "order", entityIds: [output.id],
    versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input) });

export const recordOrder: Operation<typeof recordOrderInput, Order> = {
  id: "record_order", input: recordOrderInput, supportsDryRun: true,
  describe: describeRecordedOrder,
  execute: async ({ ctx, tx }, input) => {
    // Resolve live defaults after the runner's idempotency replay, on its connection.
    const packaging = input.packaging ?? (await getOrganizationDefaults(ctx, tx)).defaultPackaging;
    await lockBiocharTransportRouteTopology(ctx, tx);
    return withAutoCodes(ctx, tx, "OR", orders, orders.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createOrderInTransaction(ctx, savepoint, { ...input, packaging, code }), CODE_CONFLICT_MESSAGES.order);
  },
};

export const updateOrder: Operation<typeof updateOrderInput, Order> = {
  id: "update_order", input: updateOrderInput, supportsDryRun: true,
  describe: describeUpdatedOrder,
  execute: ({ ctx, tx }, input) => updateOrderInTransaction(ctx, tx, input),
};

export const deleteOrder: Operation<typeof deleteOrderInput, void> = {
  id: "delete_order", input: deleteOrderInput, supportsDryRun: true,
  describe: (input) => ({ outcome: "deleted", entityType: "order", entityIds: [input.orderId],
    versionBefore: input.expectedVersion, versionAfter: null, changedFields: [] }),
  execute: async ({ ctx, tx, afterCommit }, input) => {
    await deleteOrderInTransaction(ctx, tx, input);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
