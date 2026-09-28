/**
 * Order fulfillment status — DERIVED, never stored.
 *
 * Orders have no `status` column, and the `delivery_status` enum is only
 * `delivered`, so counting delivered deliveries says nothing: every linked
 * delivery is delivered. Fulfillment is therefore the delivered wet mass
 * against the requested wet mass. This module is the single source of truth
 * for that derivation, shared by the orders data-access layer (the SQL CASE
 * used for filtering must mirror `deriveOrderFulfillmentStatus`), the filter
 * schema, and the list UI.
 */
import type { StatusValue } from "@/components/ui/status-badge";

/**
 * Share of the requested wet mass that may be missing and still count as
 * fulfilled: wet mass moves with moisture and weighing between order and
 * delivery, so an exact match is not the bar.
 */
export const ORDER_FULFILLED_SHORTFALL_FRACTION = 0.02;

export const orderFulfillmentStatuses = [
  "no_deliveries",
  "partial",
  "fulfilled",
] as const;

export type OrderFulfillmentStatus = (typeof orderFulfillmentStatuses)[number];

/**
 * Derive an order's fulfillment status from its deliveries' wet mass.
 *
 * @param deliveryCount       deliveries linked to the order (non-archived)
 * @param deliveredWetMassKg  their summed delivered wet mass
 * @param requestedWetMassKg  the order's requested wet mass
 */
export function deriveOrderFulfillmentStatus(
  deliveryCount: number,
  deliveredWetMassKg: number,
  requestedWetMassKg: number,
): OrderFulfillmentStatus {
  if (deliveryCount <= 0) return "no_deliveries";
  if (deliveredWetMassKg >= requestedWetMassKg * (1 - ORDER_FULFILLED_SHORTFALL_FRACTION)) {
    return "fulfilled";
  }
  return "partial";
}

/**
 * Human-readable label + design-system badge variant for each status.
 * Reuses the existing status ramp (no new StatusBadge variants):
 * draft (muted) · running (run) · complete (ok).
 */
export const ORDER_FULFILLMENT_DISPLAY: Record<
  OrderFulfillmentStatus,
  { label: string; badgeStatus: StatusValue }
> = {
  no_deliveries: { label: "No deliveries", badgeStatus: "draft" },
  partial: { label: "Partial", badgeStatus: "running" },
  fulfilled: { label: "Fulfilled", badgeStatus: "complete" },
};
