import type { OrgContext } from "@/lib/auth/server";
import { runOperationInProcess } from "@/lib/operations/runner";
import { addSupplierLocation, updateSupplierLocation as update, deleteSupplierLocation as remove } from "@/lib/operations/supplier-locations";
import type { AddSupplierLocationInput, UpdateSupplierLocationInput } from "@/schemas/supplier-location-input";

// Preserve legacy fixture call shapes while exercising the real operation runner.
export const createSupplierLocation = (ctx: OrgContext, input: AddSupplierLocationInput) => runOperationInProcess(addSupplierLocation, ctx, input);
export const updateSupplierLocation = (ctx: OrgContext, locationId: string, input: Omit<UpdateSupplierLocationInput, "locationId">) => runOperationInProcess(update, ctx, { ...input, locationId });
export const deleteSupplierLocation = async (ctx: OrgContext, locationId: string, expectedVersion: number): Promise<void> => {
  await runOperationInProcess(remove, ctx, { locationId, expectedVersion });
};
