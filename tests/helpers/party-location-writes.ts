import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { createSupplierLocationInTransaction, updateSupplierLocationInTransaction, type SupplierLocationInsertInput } from "@/data-access/supplier-location-writes";
import { updateCustomerLocationInTransaction } from "@/data-access/customer-location-writes";

type SupplierUpdate = Omit<Parameters<typeof updateSupplierLocationInTransaction>[2], "locationId" | "supplierId">;
type CustomerUpdate = Omit<Parameters<typeof updateCustomerLocationInTransaction>[2], "locationId" | "customerId">;

/** Insert a supplier location in its own transaction and return the row. */
export async function createSupplierLocation(ctx: OrgContext, input: SupplierLocationInsertInput & { supplierId: string }) {
  const { supplierId, ...data } = input;
  const { location } = await db.transaction(tx => createSupplierLocationInTransaction(ctx, tx, supplierId, data));
  return location;
}

/** Update a supplier location (version-checked) in its own transaction. */
export function updateSupplierLocation(ctx: OrgContext, locationId: string, input: SupplierUpdate) {
  return db.transaction(tx => updateSupplierLocationInTransaction(ctx, tx, { ...input, locationId }));
}

/** Update a customer location (version-checked) in its own transaction. */
export function updateCustomerLocation(ctx: OrgContext, locationId: string, input: CustomerUpdate) {
  return db.transaction(tx => updateCustomerLocationInTransaction(ctx, tx, { ...input, locationId }));
}
