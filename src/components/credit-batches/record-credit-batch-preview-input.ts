/**
 * Builds the credit batch preview request (#1350) from what a form holds.
 * Pure, so the request each form state sends is tested without rendering.
 */
import { massKgSchema } from "@/schemas/helpers";
import type { RecordCreditBatchPreviewInput } from "@/schemas/record-credit-batches";
import type { OutputStockPreviewInput } from "@/types/output-stock";

interface ChosenBin {
  storageLocationId: string | null | undefined;
  facilityId: string | null | undefined;
  /** The entry's time as the form holds it. */
  occurredAt: unknown;
}

function instant(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * A Delivery or Biochar Product draw: null until a bin is chosen. `draw` is
 * the stock preview's own request once mass and readings are in, so the
 * credit batch line plans exactly the draw the stock preview shows.
 */
export function outputDrawCreditBatchPreview(
  kind: "delivery" | "biochar-product",
  bin: ChosenBin,
  draw: OutputStockPreviewInput | null,
): RecordCreditBatchPreviewInput | null {
  const occurredAt = instant(bin.occurredAt);
  if (!bin.storageLocationId || !bin.facilityId || !occurredAt) return null;
  return {
    kind,
    bin: { storageLocationId: bin.storageLocationId, facilityId: bin.facilityId, occurredAt },
    draw: draw ? { wetMassKg: draw.wetMassKg, moisturePercent: draw.moisturePercent ?? null, sources: draw.sources } : null,
  };
}

/** An Application's share of a delivery: null until a delivery is chosen. */
export function applicationCreditBatchPreview(
  deliveryId: string | null | undefined,
  appliedWetMassKg: unknown,
  applicationId: string | null = null,
): RecordCreditBatchPreviewInput | null {
  if (!deliveryId) return null;
  // The server's own bound, so an amount it would reject is sent as "not entered yet".
  const parsed = massKgSchema().positive().safeParse(appliedWetMassKg);
  const amount = parsed.success ? parsed.data : null;
  return { kind: "application", deliveryId, appliedWetMassKg: amount, applicationId };
}
