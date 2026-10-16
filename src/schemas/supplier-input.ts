import { z } from "zod";
import { uuidSchema } from "./helpers";
import { updateSupplierSchema } from "./suppliers";
import { partyName, partyOptionalText, partyLocations, partyVersionFields, supplierLocationInput, supplierLocationApiInput } from "./party-location-input";

const apiFields = { name: partyName, sourceRegion: partyOptionalText.describe("Source region; null clears it.") };
const fullFields = { ...updateSupplierSchema.omit({ supplierId: true, expectedVersion: true, code: true }).shape, ...apiFields };
export const createSupplierInput = z.strictObject({ ...fullFields, locations: partyLocations(supplierLocationInput) });
export const createSupplierApiInput = z.strictObject({ ...apiFields, locations: partyLocations(supplierLocationApiInput) });
export const supplierVersionInput = z.strictObject({ supplierId: uuidSchema(), ...partyVersionFields });
export const updateSupplierInput = z.strictObject({ ...z.object(fullFields).partial().shape, code: updateSupplierSchema.shape.code.describe("Organization-unique code; omitted keeps the current code."), ...supplierVersionInput.shape });
export const updateSupplierApiInput = z.strictObject({ ...z.object(apiFields).partial().shape, code: updateSupplierSchema.shape.code.describe("Organization-unique code; omitted keeps the current code.") });
export type CreateSupplierInput = z.output<typeof createSupplierInput>;
export type UpdateSupplierInput = z.output<typeof updateSupplierInput>;
export type SupplierVersionInput = z.output<typeof supplierVersionInput>;
