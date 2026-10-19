import { sql, type SQLWrapper } from "drizzle-orm";
import { ORDER_FULFILLED_SHORTFALL_FRACTION, type OrderFulfillmentStatus } from "@/lib/orders/fulfillment";

/** One exact numeric fulfillment rule for the app list, its filter and the API balance. */
export function orderFulfillmentExpression(quantity: SQLWrapper, deliveryCount: SQLWrapper, deliveredWetKg: SQLWrapper) {
  return sql<OrderFulfillmentStatus>`
    case
      when coalesce(${deliveryCount}, 0) = 0 then 'no_deliveries'
      when coalesce(${deliveredWetKg}, 0) >= ${quantity}::numeric * (1 - ${ORDER_FULFILLED_SHORTFALL_FRACTION}::numeric) then 'fulfilled'
      else 'partial'
    end
  `;
}
