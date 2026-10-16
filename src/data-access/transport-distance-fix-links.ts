import { ENTITY_DEEP_LINK_MODE_PARAM, ENTITY_DEEP_LINK_EDIT_MODE, LOCATION_DEEP_LINK_PARAM, SUPPLIER_QUERY_PARAM } from "@/lib/entity-deep-link";
import { CUSTOMER_DEEP_LINK_PARAM } from "@/lib/customer-links";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, feedstocks, orders, supplierLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export async function getTransportDistanceFixLinks(
  ctx: OrgContext, feedstockIds: string[], deliveryIds: string[],
): Promise<Map<string, string>> {
  requireOrgScope(ctx);
  const links = new Map<string, string>();
  if (feedstockIds.length) {
    const rows = await db.select({ id: feedstocks.id, facilityId: feedstocks.facilityId, supplierId: feedstocks.supplierId, locationId: supplierLocations.id })
      .from(feedstocks).leftJoin(supplierLocations, and(eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, feedstocks.supplierId), eq(supplierLocations.isDefault, true)))
      .where(and(eq(feedstocks.organizationId, ctx.organizationId), inArray(feedstocks.id, feedstockIds)));
    for (const row of rows) links.set(row.id, `/suppliers?${new URLSearchParams({ facility: row.facilityId, [SUPPLIER_QUERY_PARAM]: row.supplierId, [ENTITY_DEEP_LINK_MODE_PARAM]: ENTITY_DEEP_LINK_EDIT_MODE, ...(row.locationId ? { [LOCATION_DEEP_LINK_PARAM]: row.locationId } : {}) })}`);
  }
  if (deliveryIds.length) {
    const rows = await db.select({ id: deliveries.id, facilityId: deliveries.facilityId, customerId: orders.customerId, locationId: orders.customerLocationId })
      .from(deliveries).innerJoin(orders, and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, deliveries.orderId)))
      .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, deliveryIds)));
    for (const row of rows) links.set(row.id, `/customers?${new URLSearchParams({ facility: row.facilityId, [CUSTOMER_DEEP_LINK_PARAM]: row.customerId, [ENTITY_DEEP_LINK_MODE_PARAM]: ENTITY_DEEP_LINK_EDIT_MODE, [LOCATION_DEEP_LINK_PARAM]: row.locationId })}`);
  }
  return links;
}
