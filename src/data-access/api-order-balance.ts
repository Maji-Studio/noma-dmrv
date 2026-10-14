import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { decimal, subtract } from "@/lib/output-stock/exact";
import { publishOrderBalanceKg } from "@/lib/delivery-order-balance";
import type { ApiLookupIdentifier } from "./api-lookup-filters";
import { findApiOrder } from "./api-orders";
import { readDeliveryOrderAllocation } from "./delivery-order-balance";
import { requireOrgScope } from "./utils";

/** Quantity and deliveries share one snapshot; archived orders include cascade-archived deliveries. */
export async function findApiOrderBalance(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const order = await findApiOrder(ctx, identifier, tx);
    const allocation = await readDeliveryOrderAllocation(ctx, tx, order.id, {
      orderQuantityKg: order.quantityKg, includeArchived: order.archivedAt !== null,
    });
    if (allocation.fulfillmentStatus === null) throw new Error("Order balance has no fulfillment status");
    const deliveredKg = decimal(allocation.allocatedWetKg);
    return {
      orderId: order.id, quantityKg: order.quantityKg,
      deliveredWetMassKg: publishOrderBalanceKg(deliveredKg),
      remainingWetMassKg: publishOrderBalanceKg(subtract(decimal(order.quantityKg), deliveredKg)),
      fulfillmentStatus: allocation.fulfillmentStatus,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
