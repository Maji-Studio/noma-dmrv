import type { OrgContext } from "@/lib/auth/server";
import { runOperationInProcess } from "@/lib/operations/runner";
import { addCustomerLocation, updateCustomerLocation as update, deleteCustomerLocation as remove } from "@/lib/operations/customer-locations";
import type { AddCustomerLocationInput, UpdateCustomerLocationInput } from "@/schemas/customer-location-input";

// Preserve legacy fixture call shapes while exercising the real operation runner.
export const createCustomerLocation = (ctx: OrgContext, input: AddCustomerLocationInput) => runOperationInProcess(addCustomerLocation, ctx, input);
export const updateCustomerLocation = (ctx: OrgContext, locationId: string, input: Omit<UpdateCustomerLocationInput, "locationId">) => runOperationInProcess(update, ctx, { ...input, locationId });
export const deleteCustomerLocation = async (ctx: OrgContext, locationId: string, expectedVersion: number): Promise<void> => {
  await runOperationInProcess(remove, ctx, { locationId, expectedVersion });
};
