import { readApiCustomer } from "@/lib/read-models/api-customers";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";
import type { CustomerRepresentation } from "@/lib/representations/customers";
import type { CustomerLocationRepresentation } from "@/lib/representations/customer-locations";
import { createCustomerApiInput, updateCustomerApiInput, customerVersionInput } from "@/schemas/customer-input";
import { createCustomer, updateCustomer, archiveCustomer, restoreCustomer, deleteCustomer } from "./customers";
import type { Operation } from "./runner";

type CustomerOutput = { customer: CustomerRepresentation };
const updateInput = updateCustomerApiInput.extend(customerVersionInput.shape);

// App actions retain full inputs and rows; the registry publishes only API fields.
export const createCustomerApi: Operation<typeof createCustomerApiInput, CustomerOutput & { locations: CustomerLocationRepresentation[] }> = {
  ...createCustomer, input: createCustomerApiInput,
  describe: (_input, output) => ({ outcome: "created", entityType: "customer", entityIds: [output.customer.id], versionBefore: null, versionAfter: output.customer.version }),
  execute: async (scope, input) => {
    const result = await createCustomer.execute(scope, input);
    return { customer: await readApiCustomer(scope.ctx, { id: result.customer.id }, scope.tx),
      locations: await Promise.all(result.locations.map(async row => {
        const location = await readApiCustomerLocation(scope.ctx, result.customer.id, row.id, scope.tx);
        if (!location) throw new Error("Created customer location was not found.");
        return location;
      })) };
  },
};
export const updateCustomerApi: Operation<typeof updateInput, CustomerOutput> = {
  ...updateCustomer, input: updateInput,
  describe: (input, output) => ({ outcome: "updated", entityType: "customer", entityIds: [output.customer.id], versionBefore: input.expectedVersion, versionAfter: output.customer.version }),
  execute: async (scope, input) => {
    const row = await updateCustomer.execute(scope, input);
    return { customer: await readApiCustomer(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const archiveCustomerApi: Operation<typeof customerVersionInput, CustomerOutput> = {
  ...archiveCustomer, input: customerVersionInput,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "active", toStatus: "archived", entityType: "customer", entityIds: [output.customer.id], versionBefore: input.expectedVersion, versionAfter: output.customer.version }),
  execute: async (scope, input) => {
    const row = await archiveCustomer.execute(scope, input);
    return { customer: await readApiCustomer(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const restoreCustomerApi: Operation<typeof customerVersionInput, CustomerOutput> = {
  ...restoreCustomer, input: customerVersionInput,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "archived", toStatus: "active", entityType: "customer", entityIds: [output.customer.id], versionBefore: input.expectedVersion, versionAfter: output.customer.version }),
  execute: async (scope, input) => {
    const row = await restoreCustomer.execute(scope, input);
    return { customer: await readApiCustomer(scope.ctx, { id: row.id }, scope.tx) };
  },
};

/** Preserve the pre-delete customer alongside the cascade for preview and replay. */
export const deleteCustomerApi: Operation<typeof deleteCustomer.input, CustomerOutput & Pick<Awaited<ReturnType<typeof deleteCustomer.execute>>, "cascade" | "warnings">> = {
  ...deleteCustomer,
  describe: input => ({ outcome: "deleted", entityType: "customer", entityIds: [input.customerId], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: async (scope, input) => {
    const customer = await readApiCustomer(scope.ctx, { id: input.customerId }, scope.tx);
    const { cascade, warnings } = await deleteCustomer.execute(scope, input);
    return { customer, cascade, warnings };
  },
};
