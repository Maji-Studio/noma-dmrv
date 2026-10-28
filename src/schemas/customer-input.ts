import { z } from "zod";
import { uuidSchema } from "./helpers";
import { updateCustomerSchema } from "./customers";
import { partyName, partyLocations, partyVersionFields, customerLocationInput, customerLocationApiInput } from "./party-location-input";

const apiFields = { name: partyName, cropType: updateCustomerSchema.shape.cropType.describe("Crop type; null clears it.") };
const fullFields = { ...updateCustomerSchema.omit({ customerId: true, expectedVersion: true, code: true }).shape, ...apiFields };
export const createCustomerInput = z.strictObject({ ...fullFields, locations: partyLocations(customerLocationInput) });
export const createCustomerApiInput = z.strictObject({ ...apiFields, locations: partyLocations(customerLocationApiInput) });
export const customerVersionInput = z.strictObject({ customerId: uuidSchema(), ...partyVersionFields });
export const updateCustomerInput = z.strictObject({ ...z.object(fullFields).partial().shape, code: updateCustomerSchema.shape.code.describe("Organization-unique code; omitted keeps the current code."), ...customerVersionInput.shape });
export const updateCustomerApiInput = z.strictObject({ ...z.object(apiFields).partial().shape, code: updateCustomerSchema.shape.code.describe("Organization-unique code; omitted keeps the current code.") });
export type CreateCustomerInput = z.output<typeof createCustomerInput>;
export type UpdateCustomerInput = z.output<typeof updateCustomerInput>;
export type CustomerVersionInput = z.output<typeof customerVersionInput>;

export const deleteCustomerInput = customerVersionInput.extend({ cascadeFingerprint: z.string().optional() });
export type DeleteCustomerInput = z.output<typeof deleteCustomerInput>;
