/**
 * Order fulfillment status — DERIVED, never stored.
 *
 * Orders have no `status` column, and the `delivery_status` enum is only
 * `delivered`, so counting delivered deliveries says nothing: every linked
 * delivery is delivered. Fulfillment is therefore the delivered wet mass
 * against the requested wet mass. The derivation itself is one SQL CASE in
 * `getOrders` (src/data-access/orders.ts), which both the list rows and the
 * status filter read, so the two cannot disagree at a boundary. This module
 * owns the shared vocabulary: the shortfall fraction, the status values, and
 * their display.
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
