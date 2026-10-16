import { z } from "zod";
import { customerLocationInput as sharedCustomerLocationInput, partyAddress } from "./party-location-input";
import { expectedVersionSchema, gpsPairSuperRefine, uuidSchema } from "./helpers";

const customerLocationInput = z.object(sharedCustomerLocationInput.shape)
  .omit({ siteDescription: true }).extend({ address: partyAddress });

export const addCustomerLocationInput = z.strictObject({
  ...customerLocationInput.shape, customerId: uuidSchema(),
}).superRefine(gpsPairSuperRefine);

// App actions discover the parent through tx; restricted transports supply it.
export const customerLocationVersionInput = z.strictObject({
  customerId: uuidSchema().optional(), locationId: uuidSchema(), expectedVersion: expectedVersionSchema,
});
export const updateCustomerLocationInput = z.strictObject({
  ...z.object(customerLocationInput.shape).partial().shape, ...customerLocationVersionInput.shape,
}).superRefine(gpsPairSuperRefine).refine(
  input => Object.entries(input).some(([key, value]) => !["customerId", "locationId", "expectedVersion"].includes(key) && value !== undefined),
  "Supply at least one field to update.",
);
export type AddCustomerLocationInput = z.infer<typeof addCustomerLocationInput>;
export type UpdateCustomerLocationInput = z.infer<typeof updateCustomerLocationInput>;
export type CustomerLocationVersionInput = z.infer<typeof customerLocationVersionInput>;
