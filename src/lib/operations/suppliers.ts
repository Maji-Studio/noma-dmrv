import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createSupplierInTransaction, updateSupplierInTransaction, deleteSupplierInTransaction, archiveSupplierInTransaction, restoreSupplierInTransaction, type CreatedSupplierWithLocations } from "@/data-access/supplier-writes";
import { lockPartyFacilities } from "@/data-access/party-reference-guards";
import { suppliers, type Supplier } from "@/db/schema";
import { createSupplierInput, updateSupplierInput, supplierVersionInput } from "@/schemas/supplier-input";
import { recordPartyLocationActivity } from "./party-activity";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
export const createSupplier: Operation<typeof createSupplierInput, CreatedSupplierWithLocations> = {
  id: "create_supplier", input: createSupplierInput, supportsDryRun: true,
  describe: (_input, output) => ({ outcome: "created", entityType: "supplier", entityIds: [output.supplier.id], versionBefore: null, versionAfter: output.supplier.version }),
  execute: async (scope, input) => {
    const { ctx, tx, activity } = scope;
    await lockPartyFacilities(ctx, tx, input.locations);
    const result = await withAutoCodes(ctx, tx, "SUP", suppliers, suppliers.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createSupplierInTransaction(ctx, savepoint, { ...input, code }, activity.capture, recordPartyLocationActivity(scope, "supplier")), CODE_CONFLICT_MESSAGES.supplier);
    return result;
  },
};
export const updateSupplier: Operation<typeof updateSupplierInput, Supplier> = {
  id: "update_supplier", input: updateSupplierInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "supplier", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: ({ ctx, tx, activity }, input) => updateSupplierInTransaction(ctx, tx, input, activity.capture),
};
export const deleteSupplier: Operation<typeof supplierVersionInput, void> = {
  id: "delete_supplier", input: supplierVersionInput, supportsDryRun: true,
  describe: input => ({ outcome: "deleted", entityType: "supplier", entityIds: [input.supplierId], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: async (scope, input) => {
    await deleteSupplierInTransaction(scope.ctx, scope.tx, input, scope.activity.capture, recordPartyLocationActivity(scope, "supplier"));
  },
};

export const archiveSupplier: Operation<typeof supplierVersionInput, Supplier> = {
  id: "archive_supplier", input: supplierVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "active", toStatus: "archived", entityType: "supplier", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: ({ ctx, tx, activity }, input) => archiveSupplierInTransaction(ctx, tx, input, activity.capture),
};

export const restoreSupplier: Operation<typeof supplierVersionInput, Supplier> = {
  id: "restore_supplier", input: supplierVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "archived", toStatus: "active", entityType: "supplier", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: ({ ctx, tx, activity }, input) => restoreSupplierInTransaction(ctx, tx, input, activity.capture),
};
