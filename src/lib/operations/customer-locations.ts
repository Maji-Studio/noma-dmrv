import { addCustomerLocationInTransaction, updateCustomerLocationInTransaction, deleteCustomerLocationInTransaction, type CustomerLocationWriteOutput } from "@/data-access/customer-location-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { addCustomerLocationInput, updateCustomerLocationInput, customerLocationVersionInput } from "@/schemas/customer-location-input";
import type { Operation } from "./runner";
import { recordFilledDeliveryActivity } from "./location-activity";
import { recordPartyLocationActivity } from "./party-activity";

export const addCustomerLocation: Operation<typeof addCustomerLocationInput, CustomerLocationWriteOutput> = {
  id: "add_customer_location", input: addCustomerLocationInput, supportsDryRun: true,
  describe: (_input, output) => ({ outcome: "created", entityType: "customer_location", entityIds: [output.id], versionBefore: null, versionAfter: output.version }),
  execute: async (scope, input) => {
    const { ctx, tx, activity, afterCommit } = scope;
    const saved = await addCustomerLocationInTransaction(ctx, tx, input, activity.capture, recordPartyLocationActivity(scope, "customer"));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const updateCustomerLocation: Operation<typeof updateCustomerLocationInput, CustomerLocationWriteOutput> = {
  id: "update_customer_location", input: updateCustomerLocationInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "customer_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: async (scope, input) => {
    const { ctx, tx, activity, afterCommit } = scope;
    const saved = await updateCustomerLocationInTransaction(ctx, tx, input, activity.capture, recordPartyLocationActivity(scope, "customer"), recordFilledDeliveryActivity(scope));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const deleteCustomerLocation: Operation<typeof customerLocationVersionInput, CustomerLocationWriteOutput> = {
  id: "delete_customer_location", input: customerLocationVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "deleted", entityType: "customer_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: (scope, input) => deleteCustomerLocationInTransaction(scope.ctx, scope.tx, input, scope.activity.capture, recordPartyLocationActivity(scope, "customer")),
};
