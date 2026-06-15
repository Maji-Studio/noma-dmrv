/**
 * Order fulfillment status — DERIVED, never stored.
 *
 * Orders have no `status` column; the `delivery_status` enum is only
 * `upcoming` / `delivered`. An order's fulfillment is therefore computed from
 * its deliveries. This module is the single source of truth for that derivation,
 * shared by the orders data-access layer (the SQL CASE used for filtering must
 * mirror `deriveOrderFulfillmentStatus`), the filter schema, and the list UI.
 */
import type { StatusValue } from "@/components/ui/status-badge";

export const orderFulfillmentStatuses = [
  "no_deliveries",
  "pending",
  "partial",
  "fulfilled",
] as const;

export type OrderFulfillmentStatus = (typeof orderFulfillmentStatuses)[number];

/**
 * Derive an order's fulfillment status from its delivery counts.
 *
 * @param totalDeliveries     deliveries linked to the order (non-archived)
 * @param deliveredDeliveries those in the `delivered` status
 */
export function deriveOrderFulfillmentStatus(
  totalDeliveries: number,
  deliveredDeliveries: number,
): OrderFulfillmentStatus {
  if (totalDeliveries <= 0) return "no_deliveries";
  if (deliveredDeliveries <= 0) return "pending";
  if (deliveredDeliveries < totalDeliveries) return "partial";
  return "fulfilled";
}

/**
 * Human-readable label + design-system badge variant for each status.
 * Reuses the existing status ramp (no new StatusBadge variants):
 * draft (muted) · pending (wait) · running (run) · complete (ok).
 */
export const ORDER_FULFILLMENT_DISPLAY: Record<
  OrderFulfillmentStatus,
  { label: string; badgeStatus: StatusValue }
> = {
  no_deliveries: { label: "No deliveries", badgeStatus: "draft" },
  pending: { label: "Pending", badgeStatus: "pending" },
  partial: { label: "Partial", badgeStatus: "running" },
  fulfilled: { label: "Fulfilled", badgeStatus: "complete" },
};
