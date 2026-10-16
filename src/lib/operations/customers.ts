import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createCustomerInTransaction, updateCustomerInTransaction, deleteCustomerInTransaction, type CreatedCustomerWithLocations } from "@/data-access/customer-writes";
import { lockPartyFacilities } from "@/data-access/party-reference-guards";
import { customers, type Customer } from "@/db/schema";
import { createCustomerInput, updateCustomerInput, customerVersionInput } from "@/schemas/customer-input";
import { changedFields } from "./changed-fields";
import { recordPartyLocationActivity } from "./party-activity";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
export const createCustomer: Operation<typeof createCustomerInput, CreatedCustomerWithLocations> = {
  id: "create_customer", input: createCustomerInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "created", entityType: "customer", entityIds: [output.customer.id], versionBefore: null, versionAfter: output.customer.version, changedFields: changedFields(input) }),
  execute: async (scope, input) => {
    const { ctx, tx } = scope;
    await lockPartyFacilities(ctx, tx, input.locations);
    const result = await withAutoCodes(ctx, tx, "CUS", customers, customers.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createCustomerInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.customer);
    recordPartyLocationActivity(scope, "customer", "created", result.locations);
    return result;
  },
};
export const updateCustomer: Operation<typeof updateCustomerInput, Customer> = {
  id: "update_customer", input: updateCustomerInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "customer", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input) }),
  execute: ({ ctx, tx }, input) => updateCustomerInTransaction(ctx, tx, input),
};
export const deleteCustomer: Operation<typeof customerVersionInput, void> = {
  id: "delete_customer", input: customerVersionInput, supportsDryRun: true,
  describe: input => ({ outcome: "deleted", entityType: "customer", entityIds: [input.customerId], versionBefore: input.expectedVersion, versionAfter: null, changedFields: [] }),
  execute: async (scope, input) => {
    const deleted = await deleteCustomerInTransaction(scope.ctx, scope.tx, input);
    recordPartyLocationActivity(scope, "customer", "deleted", deleted);
  },
};
