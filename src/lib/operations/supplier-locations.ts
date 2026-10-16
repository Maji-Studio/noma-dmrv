import { addSupplierLocationInTransaction, updateSupplierLocationInTransaction, deleteSupplierLocationInTransaction } from "@/data-access/supplier-location-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import type { SupplierLocation } from "@/db/schema";
import { addSupplierLocationInput, updateSupplierLocationInput, supplierLocationVersionInput } from "@/schemas/supplier-location-input";
import type { Operation } from "./runner";

export const addSupplierLocation: Operation<typeof addSupplierLocationInput, SupplierLocation> = {
  id: "add_supplier_location", input: addSupplierLocationInput, supportsDryRun: true,
  describe: (_input, output) => ({ outcome: "created", entityType: "supplier_location", entityIds: [output.id], versionBefore: null, versionAfter: output.version }),
  execute: async ({ ctx, tx, activity, afterCommit }, input) => {
    const saved = await addSupplierLocationInTransaction(ctx, tx, input, activity.capture);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const updateSupplierLocation: Operation<typeof updateSupplierLocationInput, SupplierLocation> = {
  id: "update_supplier_location", input: updateSupplierLocationInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "supplier_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: async ({ ctx, tx, activity, afterCommit }, input) => {
    const saved = await updateSupplierLocationInTransaction(ctx, tx, input, activity.capture);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};
export const deleteSupplierLocation: Operation<typeof supplierLocationVersionInput, SupplierLocation> = {
  id: "delete_supplier_location", input: supplierLocationVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "deleted", entityType: "supplier_location", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: ({ ctx, tx, activity }, input) => deleteSupplierLocationInTransaction(ctx, tx, input, activity.capture),
};
