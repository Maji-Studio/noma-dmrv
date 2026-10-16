import { addCustomerLocationInTransaction, updateCustomerLocationInTransaction, deleteCustomerLocationInTransaction } from "@/data-access/customer-location-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import type { CustomerLocation } from "@/db/schema";
import { addCustomerLocationInput, updateCustomerLocationInput, customerLocationVersionInput } from "@/schemas/customer-location-input";
import type { Operation } from "./runner";

export const addCustomerLocation: Operation<typeof addCustomerLocationInput, CustomerLocation> = {
  id: "add_customer_location", input: addCustomerLocationInput, supportsDryRun: true,
  describe: (_input, output) => ({ outcome: "created", entityType: "customer_location", entityIds: [output.id], versionBefore: null, versionAfter: output.version }),
  execute: async ({ ctx, tx, activity, afterCommit }, input) => {
    const saved = await addCustomerLocationInTransaction(ctx, tx, input, activity.capture);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const updateCustomerLocation: Operation<typeof updateCustomerLocationInput, CustomerLocation> = {
  id: "update_customer_location", input: updateCustomerLocationInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "customer_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: async ({ ctx, tx, activity, afterCommit }, input) => {
    const saved = await updateCustomerLocationInTransaction(ctx, tx, input, activity.capture);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const deleteCustomerLocation: Operation<typeof customerLocationVersionInput, CustomerLocation> = {
  id: "delete_customer_location", input: customerLocationVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "deleted", entityType: "customer_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: ({ ctx, tx, activity }, input) => deleteCustomerLocationInTransaction(ctx, tx, input, activity.capture),
};
