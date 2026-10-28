import { ActionError } from "@/lib/action-error";
import { IN_USE_REASON } from "@/lib/delete-refusal";
import { deliveryDeepLinkHref } from "@/lib/delivery-links";
import { feedstockDeepLinkHref } from "@/lib/feedstock-links";
import { orderDeepLinkHref } from "@/lib/order-links";

/** A record that still uses the row, as a link the operator can open. */
export interface InUseRecordLink { href: string; code: string; kind: string }

type NamedRecord = { id: string; code: string; facilityId?: string };

/** The records a refusal names under `key`, skipping any entry without a string id and code. */
function namedRecords(error: unknown, key: "feedstocks" | "deliveries" | "orders"): NamedRecord[] {
  if (!(error instanceof ActionError)) return [];
  const meta = error.issues.find((issue) => issue.meta?.reason === IN_USE_REASON)?.meta;
  const named = Array.isArray(meta?.[key]) ? (meta[key] as unknown[]) : [];
  return named.flatMap((item) => {
    const { id, code, facilityId } = (item ?? {}) as { id?: unknown; code?: unknown; facilityId?: unknown };
    if (typeof id !== "string" || typeof code !== "string") return [];
    return [{ id, code, ...(typeof facilityId === "string" ? { facilityId } : {}) }];
  });
}

/** Deliveries that block an order delete. The refusal names no facility, so they open under the order's own. */
export const orderInUseReferences = (error: unknown, facilityId?: string): InUseRecordLink[] =>
  namedRecords(error, "deliveries").map(({ id, code }) => ({ href: deliveryDeepLinkHref(id, facilityId), code, kind: "delivery" }));

/** Feedstock intakes that block a supplier delete; each links under its own facility. */
export const supplierInUseReferences = (error: unknown): InUseRecordLink[] =>
  namedRecords(error, "feedstocks").map(({ id, code, facilityId }) => ({ href: feedstockDeepLinkHref(id, facilityId), code, kind: "feedstock" }));

/** Deliveries that block a customer delete; each links under its own facility. */
export const customerInUseReferences = (error: unknown): InUseRecordLink[] =>
  namedRecords(error, "deliveries").map(({ id, code, facilityId }) => ({ href: deliveryDeepLinkHref(id, facilityId), code, kind: "delivery" }));

/** Orders that block a customer location delete; each links under its own facility. */
export const locationInUseReferences = (error: unknown): InUseRecordLink[] =>
  namedRecords(error, "orders").map(({ id, code, facilityId }) => ({ href: orderDeepLinkHref(id, facilityId), code, kind: "order" }));
