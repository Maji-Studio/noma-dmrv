/** Customer-location options for the order's customer-scoped picker. */
import { and, eq, ilike, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { ARCHIVED_OPTION_SUBTITLE } from "@/lib/archived-option";
import { requireOrgScope } from "../utils";

function toOption(row: { id: string; name: string; archivedAt: Date | null }): EntityOption {
  return { id: row.id, code: "", name: row.name, ...(row.archivedAt ? { archived: true, subtitle: ARCHIVED_OPTION_SUBTITLE } : {}) };
}

export async function getCustomerLocationsEntity(ctx: OrgContext, params: {
  customerId?: string;
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  // Without a customer there is no destination to choose for an order.
  if (!params.customerId) return [];
  const rows = await db.select({ id: customerLocations.id, name: customerLocations.name, archivedAt: customerLocations.archivedAt })
    .from(customerLocations)
    .where(and(
      eq(customerLocations.organizationId, ctx.organizationId),
      eq(customerLocations.customerId, params.customerId),
      isNull(customerLocations.archivedAt),
      params.search ? ilike(customerLocations.name, `%${params.search}%`) : undefined,
    ))
    .limit(params.limit);
  return rows.map(toOption);
}

export async function getCustomerLocationEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [row] = await db.select({ id: customerLocations.id, name: customerLocations.name, archivedAt: customerLocations.archivedAt })
    .from(customerLocations)
    .where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.id, id)))
    .limit(1);
  return row ? toOption(row) : null;
}
