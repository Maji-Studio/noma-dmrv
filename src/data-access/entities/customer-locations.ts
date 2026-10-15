/** Customer-location options for the order's customer-scoped picker. */
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

function toOption(row: { id: string; name: string }): EntityOption {
  return { id: row.id, code: "", name: row.name };
}

export async function getCustomerLocationsEntity(ctx: OrgContext, params: {
  customerId?: string;
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  // Without a customer there is no destination to choose for an order.
  if (!params.customerId) return [];
  const rows = await db.select({ id: customerLocations.id, name: customerLocations.name })
    .from(customerLocations)
    .where(and(
      eq(customerLocations.organizationId, ctx.organizationId),
      eq(customerLocations.customerId, params.customerId),
      params.search ? ilike(customerLocations.name, `%${params.search}%`) : undefined,
    ))
    .limit(params.limit);
  return rows.map(toOption);
}

export async function getCustomerLocationEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [row] = await db.select({ id: customerLocations.id, name: customerLocations.name })
    .from(customerLocations)
    .where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.id, id)))
    .limit(1);
  return row ? toOption(row) : null;
}
