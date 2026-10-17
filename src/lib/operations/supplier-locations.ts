import { addSupplierLocationInTransaction, updateSupplierLocationInTransaction, deleteSupplierLocationInTransaction, type SupplierLocationWriteOutput } from "@/data-access/supplier-location-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { addSupplierLocationInput, updateSupplierLocationInput, supplierLocationVersionInput } from "@/schemas/supplier-location-input";
import type { Operation } from "./runner";
import { recordPartyLocationActivity } from "./party-activity";

export const addSupplierLocation: Operation<typeof addSupplierLocationInput, SupplierLocationWriteOutput> = {
  id: "add_supplier_location", input: addSupplierLocationInput, supportsDryRun: true,
  describe: (_input, output) => ({ outcome: "created", entityType: "supplier_location", entityIds: [output.id], versionBefore: null, versionAfter: output.version }),
  execute: async (scope, input) => {
    const { ctx, tx, activity, afterCommit } = scope;
    const saved = await addSupplierLocationInTransaction(ctx, tx, input, activity.capture, recordPartyLocationActivity(scope, "supplier"));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const updateSupplierLocation: Operation<typeof updateSupplierLocationInput, SupplierLocationWriteOutput> = {
  id: "update_supplier_location", input: updateSupplierLocationInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "supplier_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: async (scope, input) => {
    const { ctx, tx, activity, afterCommit } = scope;
    const saved = await updateSupplierLocationInTransaction(ctx, tx, input, activity.capture, recordPartyLocationActivity(scope, "supplier"));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const deleteSupplierLocation: Operation<typeof supplierLocationVersionInput, SupplierLocationWriteOutput> = {
  id: "delete_supplier_location", input: supplierLocationVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "deleted", entityType: "supplier_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: (scope, input) => deleteSupplierLocationInTransaction(scope.ctx, scope.tx, input, scope.activity.capture, recordPartyLocationActivity(scope, "supplier")),
};
