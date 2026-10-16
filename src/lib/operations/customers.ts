import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createCustomerInTransaction, updateCustomerInTransaction, deleteCustomerInTransaction, archiveCustomerInTransaction, restoreCustomerInTransaction, type CreatedCustomerWithLocations } from "@/data-access/customer-writes";
import { lockPartyFacilities } from "@/data-access/party-reference-guards";
import { customers, type Customer } from "@/db/schema";
import { createCustomerInput, updateCustomerInput, customerVersionInput } from "@/schemas/customer-input";
import { recordPartyLocationActivity } from "./party-activity";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
export const createCustomer: Operation<typeof createCustomerInput, CreatedCustomerWithLocations> = {
  id: "create_customer", input: createCustomerInput, supportsDryRun: true,
  describe: (_input, output) => ({ outcome: "created", entityType: "customer", entityIds: [output.customer.id], versionBefore: null, versionAfter: output.customer.version }),
  execute: async (scope, input) => {
    const { ctx, tx, activity } = scope;
    await lockPartyFacilities(ctx, tx, input.locations);
    const result = await withAutoCodes(ctx, tx, "CUS", customers, customers.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createCustomerInTransaction(ctx, savepoint, { ...input, code }, activity.capture, recordPartyLocationActivity(scope, "customer")), CODE_CONFLICT_MESSAGES.customer);
    return result;
  },
};
export const updateCustomer: Operation<typeof updateCustomerInput, Customer> = {
  id: "update_customer", input: updateCustomerInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "customer", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: ({ ctx, tx, activity }, input) => updateCustomerInTransaction(ctx, tx, input, activity.capture),
};
export const deleteCustomer: Operation<typeof customerVersionInput, void> = {
  id: "delete_customer", input: customerVersionInput, supportsDryRun: true,
  describe: input => ({ outcome: "deleted", entityType: "customer", entityIds: [input.customerId], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: async (scope, input) => {
    await deleteCustomerInTransaction(scope.ctx, scope.tx, input, scope.activity.capture, recordPartyLocationActivity(scope, "customer"));
  },
};

export const archiveCustomer: Operation<typeof customerVersionInput, Customer> = {
  id: "archive_customer", input: customerVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "active", toStatus: "archived", entityType: "customer", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: ({ ctx, tx, activity }, input) => archiveCustomerInTransaction(ctx, tx, input, activity.capture),
};

export const restoreCustomer: Operation<typeof customerVersionInput, Customer> = {
  id: "restore_customer", input: customerVersionInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "archived", toStatus: "active", entityType: "customer", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version }),
  execute: ({ ctx, tx, activity }, input) => restoreCustomerInTransaction(ctx, tx, input, activity.capture),
};
