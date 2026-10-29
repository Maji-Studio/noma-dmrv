import { ActionError } from "@/lib/action-error";
import { IN_USE_REASON } from "@/lib/delete-refusal";
import { FORMULATION_IN_USE_KINDS, type FormulationInUseKind } from "@/lib/formulation-domain-errors";
import { recordHref } from "@/lib/record-links";

/** A record that still uses the row, as a link the operator can open. */
export interface InUseRecordLink { href: string; code: string; kind: string }

const COUNT_KEY = { feedstocks: "feedstockCount", deliveries: "deliveryCount", orders: "orderCount" } as const;

/** The meta of the refusal's in-use issue, if the error carries one. */
function inUseMeta(error: unknown) {
  return error instanceof ActionError ? error.issues.find((issue) => issue.meta?.reason === IN_USE_REASON)?.meta : undefined;
}

/** How many blockers the refusal names beyond the links it carries (0 when it names no total). */
export function inUseMoreCount(error: unknown, key: keyof typeof COUNT_KEY): number {
  const meta = inUseMeta(error);
  const total = meta?.[COUNT_KEY[key]];
  const shown = namedRecords(error, key).length;
  return typeof total === "number" && Number.isFinite(total) ? Math.max(0, Math.floor(total) - shown) : 0;
}

type NamedRecord = { id: string; code: string; facilityId?: string };

/** The records a refusal names under `key`, skipping any entry without a string id and code. */
function namedRecords(error: unknown, key: "feedstocks" | "deliveries" | "orders"): NamedRecord[] {
  const meta = inUseMeta(error);
  const named = Array.isArray(meta?.[key]) ? (meta[key] as unknown[]) : [];
  return named.flatMap((item) => {
    const { id, code, facilityId } = (item ?? {}) as { id?: unknown; code?: unknown; facilityId?: unknown };
    if (typeof id !== "string" || typeof code !== "string") return [];
    return [{ id, code, ...(typeof facilityId === "string" ? { facilityId } : {}) }];
  });
}

/** Deliveries that block an order delete. The refusal names no facility, so they open under the order's own. */
export const orderInUseReferences = (error: unknown, facilityId?: string): InUseRecordLink[] =>
  namedRecords(error, "deliveries").map(({ id, code }) => ({ href: recordHref("delivery", id, { facilityId: facilityId }), code, kind: "delivery" }));

/** Feedstock intakes that block a supplier delete; each links under its own facility. */
export const supplierInUseReferences = (error: unknown): InUseRecordLink[] =>
  namedRecords(error, "feedstocks").map(({ id, code, facilityId }) => ({ href: recordHref("feedstock", id, { facilityId: facilityId }), code, kind: "feedstock" }));

/** Deliveries that block a customer delete; each links under its own facility. */
export const customerInUseReferences = (error: unknown): InUseRecordLink[] =>
  namedRecords(error, "deliveries").map(({ id, code, facilityId }) => ({ href: recordHref("delivery", id, { facilityId: facilityId }), code, kind: "delivery" }));

/** Orders that block a customer location delete; each links under its own facility. */
export const locationInUseReferences = (error: unknown): InUseRecordLink[] =>
  namedRecords(error, "orders").map(({ id, code, facilityId }) => ({ href: recordHref("order", id, { facilityId: facilityId }), code, kind: "order" }));

/** "biochar products use it" for the formulation dialog, read from the refusal's meta key; undefined when it names none. */
export function formulationInUseReason(error: unknown): string | undefined {
  const meta = inUseMeta(error);
  const kind = (Object.keys(FORMULATION_IN_USE_KINDS) as FormulationInUseKind[]).find((name) => meta && FORMULATION_IN_USE_KINDS[name] in meta);
  return kind ? `${kind} use it` : undefined;
}
