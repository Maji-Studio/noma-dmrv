import { readApiSupplier } from "@/lib/read-models/api-suppliers";
import { representSupplierLocation } from "@/lib/representations/supplier-locations";
import type { SupplierRepresentation } from "@/lib/representations/suppliers";
import type { SupplierLocationRepresentation } from "@/lib/representations/supplier-locations";
import { createSupplierApiInput, updateSupplierApiInput, supplierVersionInput } from "@/schemas/supplier-input";
import { createSupplier, updateSupplier, archiveSupplier, restoreSupplier } from "./suppliers";
import { changedFields } from "./changed-fields";
import type { Operation } from "./runner";

type SupplierOutput = { supplier: SupplierRepresentation };
const updateInput = updateSupplierApiInput.extend(supplierVersionInput.shape);

// App actions retain full inputs and rows; the registry publishes only API fields.
export const createSupplierApi: Operation<typeof createSupplierApiInput, SupplierOutput & { locations: SupplierLocationRepresentation[] }> = {
  ...createSupplier, input: createSupplierApiInput,
  describe: (input, output) => ({ outcome: "created", entityType: "supplier", entityIds: [output.supplier.id], versionBefore: null, versionAfter: output.supplier.version, changedFields: changedFields(input) }),
  execute: async (scope, input) => {
    const result = await createSupplier.execute(scope, input);
    return { supplier: await readApiSupplier(scope.ctx, { id: result.supplier.id }, scope.tx),
      locations: result.locations.map(row => representSupplierLocation(row)) };
  },
};
export const updateSupplierApi: Operation<typeof updateInput, SupplierOutput> = {
  ...updateSupplier, input: updateInput,
  describe: (input, output) => ({ outcome: "updated", entityType: "supplier", entityIds: [output.supplier.id], versionBefore: input.expectedVersion, versionAfter: output.supplier.version, changedFields: changedFields(input) }),
  execute: async (scope, input) => {
    const row = await updateSupplier.execute(scope, input);
    return { supplier: await readApiSupplier(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const archiveSupplierApi: Operation<typeof supplierVersionInput, SupplierOutput> = {
  ...archiveSupplier, input: supplierVersionInput,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "active", toStatus: "archived", entityType: "supplier", entityIds: [output.supplier.id], versionBefore: input.expectedVersion, versionAfter: output.supplier.version, changedFields: [] }),
  execute: async (scope, input) => {
    const row = await archiveSupplier.execute(scope, input);
    return { supplier: await readApiSupplier(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const restoreSupplierApi: Operation<typeof supplierVersionInput, SupplierOutput> = {
  ...restoreSupplier, input: supplierVersionInput,
  describe: (input, output) => ({ outcome: "status_changed", fromStatus: "archived", toStatus: "active", entityType: "supplier", entityIds: [output.supplier.id], versionBefore: input.expectedVersion, versionAfter: output.supplier.version, changedFields: [] }),
  execute: async (scope, input) => {
    const row = await restoreSupplier.execute(scope, input);
    return { supplier: await readApiSupplier(scope.ctx, { id: row.id }, scope.tx) };
  },
};
