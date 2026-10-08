import { describe, expect, it } from "vitest";
import { updateFacilitySchema, archiveFacilitySchema, restoreFacilitySchema } from "./facilities";
import { updateReactorSchema, deleteReactorSchema } from "./reactors";
import { updateStorageLocationSchema, deleteStorageLocationSchema, archiveStorageLocationSchema, restoreStorageLocationSchema } from "./storage-locations";
import { updateSupplierSchema, deleteSupplierSchema, updateSupplierLocationSchema, deleteSupplierLocationSchema } from "./suppliers";
import { updateCustomerSchema, deleteCustomerSchema, updateCustomerLocationSchema, deleteCustomerLocationSchema } from "./customers";
import { updateFormulationSchema, deleteFormulationSchema } from "./formulations";
import { updateFeedstockTypeSchema, deleteFeedstockTypeSchema } from "./feedstock-types";
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const contracts = [
  [updateFacilitySchema, { facilityId: ID }], [archiveFacilitySchema, { facilityId: ID }], [restoreFacilitySchema, { facilityId: ID }],
  [updateReactorSchema, { reactorId: ID }], [deleteReactorSchema, { reactorId: ID }],
  [updateStorageLocationSchema, { storageLocationId: ID }], [deleteStorageLocationSchema, { storageLocationId: ID }], [archiveStorageLocationSchema, { storageLocationId: ID }], [restoreStorageLocationSchema, { storageLocationId: ID }],
  [updateSupplierSchema, { supplierId: ID }], [deleteSupplierSchema, { supplierId: ID }], [updateSupplierLocationSchema, { locationId: ID }], [deleteSupplierLocationSchema, { locationId: ID }],
  [updateCustomerSchema, { customerId: ID }], [deleteCustomerSchema, { customerId: ID }], [updateCustomerLocationSchema, { locationId: ID }], [deleteCustomerLocationSchema, { locationId: ID }],
  [updateFormulationSchema, { formulationId: ID }], [deleteFormulationSchema, { formulationId: ID }],
  [updateFeedstockTypeSchema, { feedstockTypeId: ID }], [deleteFeedstockTypeSchema, { feedstockTypeId: ID }],
] as const;
describe.each(contracts)("master-data write contract %#", (schema, identity) => {
  it("requires a loaded positive integer and strips the old timestamp", () => {
    expect(schema.parse({ ...identity, expectedVersion: 1, expectedUpdatedAt: new Date() })).toMatchObject({ ...identity, expectedVersion: 1 });
    expect(schema.parse({ ...identity, expectedVersion: 1 })).not.toHaveProperty("expectedUpdatedAt");
    for (const expectedVersion of [undefined, null, 0, -1, 1.5, "1"]) {
      const result = schema.safeParse({ ...identity, expectedVersion });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toBe("Reload this record before saving.");
    }
  });
});
