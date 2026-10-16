import { z } from "zod";
import { supplierLocationInput } from "./party-location-input";
import { expectedVersionSchema, gpsPairSuperRefine, uuidSchema } from "./helpers";

export const addSupplierLocationInput = z.strictObject({
  ...supplierLocationInput.shape, supplierId: uuidSchema(),
}).superRefine(gpsPairSuperRefine);

// App actions discover the parent through tx; restricted transports supply it.
export const supplierLocationVersionInput = z.strictObject({
  supplierId: uuidSchema().optional(), locationId: uuidSchema(), expectedVersion: expectedVersionSchema,
});
export const updateSupplierLocationInput = z.strictObject({
  ...z.object(supplierLocationInput.shape).partial().shape, ...supplierLocationVersionInput.shape,
}).superRefine(gpsPairSuperRefine).refine(
  input => Object.entries(input).some(([key, value]) => !["supplierId", "locationId", "expectedVersion"].includes(key) && value !== undefined),
  "Supply at least one field to update.",
);
export type AddSupplierLocationInput = z.infer<typeof addSupplierLocationInput>;
export type UpdateSupplierLocationInput = z.infer<typeof updateSupplierLocationInput>;
export type SupplierLocationVersionInput = z.infer<typeof supplierLocationVersionInput>;
