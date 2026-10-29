import { and, asc, count, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { BLOCKER_LIMIT } from "@/config/party-input";
import type { InUseRecordRef } from "@/lib/party-domain-errors";
import { findRegisteredCustomerLocationIds } from "./certifier-storage-locations";
import { requireOrgScope } from "./utils";

/** Caller holds the location FOR UPDATE, fencing orders and registration FKs. */
export async function findCustomerLocationBlockers(ctx: OrgContext, tx: DbTransaction, locationId: string): Promise<{ orderCodes: string[]; orders: InUseRecordRef[]; orderCount: number; registeredLocationIds: string[] }> {
  requireOrgScope(ctx);
  const uses = await tx.select({ id: orders.id, code: orders.code, facilityId: orders.facilityId }).from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.customerLocationId, locationId)))
    .orderBy(asc(orders.code)).limit(BLOCKER_LIMIT);
  const registered = await findRegisteredCustomerLocationIds(ctx, tx, locationId);
  const [{ total }] = uses.length ? await tx.select({ total: count() }).from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.customerLocationId, locationId))) : [{ total: 0 }];
  return { orderCodes: uses.map(row => row.code), orders: uses, orderCount: total, registeredLocationIds: registered };
}
