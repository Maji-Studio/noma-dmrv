import { z } from "zod";
import { customerLocationInput as sharedCustomerLocationInput, partyAddress, requireLocationUpdateField } from "./party-location-input";
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
}).superRefine(gpsPairSuperRefine).refine(...requireLocationUpdateField("customerId"));
export type AddCustomerLocationInput = z.infer<typeof addCustomerLocationInput>;
export type UpdateCustomerLocationInput = z.infer<typeof updateCustomerLocationInput>;
export type CustomerLocationVersionInput = z.infer<typeof customerLocationVersionInput>;

export const addCustomerLocationApiInput = z.strictObject({
  ...sharedCustomerLocationInput.shape, customerId: uuidSchema(),
}).superRefine(gpsPairSuperRefine);
export const customerLocationApiVersionInput = customerLocationVersionInput.required({ customerId: true });
export const updateCustomerLocationApiInput = z.strictObject({
  ...z.object(sharedCustomerLocationInput.shape).partial().shape, ...customerLocationApiVersionInput.shape,
}).superRefine(gpsPairSuperRefine).refine(...requireLocationUpdateField("customerId"));
