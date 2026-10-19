import { partyLocationNotFound } from "@/lib/party-domain-errors";
import { readApiSupplierLocation } from "@/lib/read-models/api-supplier-locations";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";
import type { SupplierLocationRepresentation } from "@/lib/representations/supplier-locations";
import type { CustomerLocationRepresentation } from "@/lib/representations/customer-locations";
import { addSupplierLocationApiInput, updateSupplierLocationApiInput, supplierLocationApiVersionInput } from "@/schemas/supplier-location-input";
import { addCustomerLocationApiInput, updateCustomerLocationApiInput, customerLocationApiVersionInput } from "@/schemas/customer-location-input";
import { addSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "./supplier-locations";
import { addCustomerLocation, updateCustomerLocation, deleteCustomerLocation, archiveCustomerLocation, restoreCustomerLocation } from "./customer-locations";
import type { Operation, OperationScope } from "./runner";

type SupplierOutput = { data: SupplierLocationRepresentation; warnings: string[] };
type CustomerOutput = { data: CustomerLocationRepresentation; warnings: string[] };

async function supplierBody(scope: OperationScope, parentId: string, locationId: string) {
  const row = await readApiSupplierLocation(scope.ctx, parentId, locationId, scope.tx);
  if (!row) throw partyLocationNotFound("supplier");
  return row;
}
async function customerBody(scope: OperationScope, parentId: string, locationId: string) {
  const row = await readApiCustomerLocation(scope.ctx, parentId, locationId, scope.tx);
  if (!row) throw partyLocationNotFound("customer");
  return row;
}

// App operations keep full inputs and rows. Registered operations publish API fields only.
export const addSupplierLocationApi: Operation<typeof addSupplierLocationApiInput, SupplierOutput> = {
  ...addSupplierLocation, input: addSupplierLocationApiInput,
  describe: (_input, output) => ({ outcome: "created", entityType: "supplier_location", entityIds: [output.data.id], versionBefore: null, versionAfter: output.data.version }),
  execute: async (scope, input) => {
    const saved = await addSupplierLocation.execute(scope, input);
    return { data: await supplierBody(scope, input.supplierId, saved.id), warnings: saved.warnings };
  },
};
export const updateSupplierLocationApi: Operation<typeof updateSupplierLocationApiInput, SupplierOutput> = {
  ...updateSupplierLocation, input: updateSupplierLocationApiInput,
  describe: (input, output) => ({ outcome: "updated", entityType: "supplier_location", entityIds: [output.data.id], versionBefore: input.expectedVersion, versionAfter: output.data.version }),
  execute: async (scope, input) => {
    const saved = await updateSupplierLocation.execute(scope, input);
    return { data: await supplierBody(scope, input.supplierId, saved.id), warnings: saved.warnings };
  },
};
export const deleteSupplierLocationApi: Operation<typeof supplierLocationApiVersionInput, SupplierOutput> = {
  ...deleteSupplierLocation, input: supplierLocationApiVersionInput,
  describe: (input, output) => ({ outcome: "deleted", entityType: "supplier_location", entityIds: [output.data.id], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: async (scope, input) => {
    const data = await supplierBody(scope, input.supplierId, input.locationId);
    const saved = await deleteSupplierLocation.execute(scope, input);
    return { data, warnings: saved.warnings };
  },
};
export const addCustomerLocationApi: Operation<typeof addCustomerLocationApiInput, CustomerOutput> = {
  ...addCustomerLocation, input: addCustomerLocationApiInput,
  describe: (_input, output) => ({ outcome: "created", entityType: "customer_location", entityIds: [output.data.id], versionBefore: null, versionAfter: output.data.version }),
  execute: async (scope, input) => {
    const { siteDescription, ...fields } = input;
    const saved = await addCustomerLocation.execute(scope, { ...fields, address: siteDescription });
    return { data: await customerBody(scope, input.customerId, saved.id), warnings: saved.warnings };
  },
};
export const updateCustomerLocationApi: Operation<typeof updateCustomerLocationApiInput, CustomerOutput> = {
  ...updateCustomerLocation, input: updateCustomerLocationApiInput,
  describe: (input, output) => ({ outcome: "updated", entityType: "customer_location", entityIds: [output.data.id], versionBefore: input.expectedVersion, versionAfter: output.data.version }),
  execute: async (scope, input) => {
    const { siteDescription, ...fields } = input;
    const saved = await updateCustomerLocation.execute(scope, { ...fields, address: siteDescription });
    return { data: await customerBody(scope, input.customerId, saved.id), warnings: saved.warnings };
  },
};
export const deleteCustomerLocationApi: Operation<typeof customerLocationApiVersionInput, CustomerOutput> = {
  ...deleteCustomerLocation, input: customerLocationApiVersionInput,
  describe: (input, output) => ({ outcome: "deleted", entityType: "customer_location", entityIds: [output.data.id], versionBefore: input.expectedVersion, versionAfter: null }),
  execute: async (scope, input) => {
    const data = await customerBody(scope, input.customerId, input.locationId);
    const saved = await deleteCustomerLocation.execute(scope, input);
    return { data, warnings: saved.warnings };
  },
};
export const archiveCustomerLocationApi: Operation<typeof customerLocationApiVersionInput, CustomerOutput> = {
  ...archiveCustomerLocation, input: customerLocationApiVersionInput,
  describe: (input, output) => ({ outcome: "status_changed", entityType: "customer_location", entityIds: [output.data.id], versionBefore: input.expectedVersion, versionAfter: output.data.version, fromStatus: "active", toStatus: "archived" }),
  execute: async (scope, input) => {
    const saved = await archiveCustomerLocation.execute(scope, input);
    return { data: await customerBody(scope, input.customerId, saved.id), warnings: saved.warnings };
  },
};
export const restoreCustomerLocationApi: Operation<typeof customerLocationApiVersionInput, CustomerOutput> = {
  ...restoreCustomerLocation, input: customerLocationApiVersionInput,
  describe: (input, output) => ({ outcome: "status_changed", entityType: "customer_location", entityIds: [output.data.id], versionBefore: input.expectedVersion, versionAfter: output.data.version, fromStatus: "archived", toStatus: "active" }),
  execute: async (scope, input) => {
    const saved = await restoreCustomerLocation.execute(scope, input);
    return { data: await customerBody(scope, input.customerId, saved.id), warnings: saved.warnings };
  },
};
