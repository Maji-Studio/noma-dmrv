import { z } from "zod";

export const OUTPUT_MOVEMENT_KINDS = ["production_draw", "product_draw", "delivery", "loss", "count", "reversal", "replacement", "merge", "split"] as const;

export const outputStockMovementRepresentationSchema = z.object({
  id: z.uuid().describe("Movement identifier, UUID."),
  storageLocationId: z.uuid().describe("Biochar or product bin the movement was posted on, UUID."),
  kind: z.enum(OUTPUT_MOVEMENT_KINDS).describe("What happened: production_draw and product_draw feed a new product, delivery ships stock, loss and count are manual, reversal and replacement are corrections, merge and split change the bin layout."),
  occurredAt: z.iso.datetime().describe("Instant the stock changed, UTC, RFC 3339."),
  wetMassKg: z.number().nullable().describe("Wet kilograms posted, or the whole counted bin for a count; null for a reversal or when none was recorded."),
  moisturePercent: z.number().nullable().describe("Moisture posted as percent of wet mass; the overall figure for a split-bin draw; null when none applies."),
  dryDeltaKg: z.number().describe("Change in dry biochar in kilograms: negative when stock left, positive for a reversal."),
  balanceBeforeDryKg: z.number().describe("Dry biochar in the bin just before the movement, kilograms."),
  balanceAfterDryKg: z.number().describe("Dry biochar in the bin just after the movement, kilograms."),
  reason: z.string().describe("Why the stock changed, untrusted plain text."),
  correctsMovementId: z.uuid().nullable().describe("Movement this reversal or replacement corrects, UUID, or null."),
  correctedByMovementId: z.uuid().nullable().describe("Reversal that undid this movement, UUID, or null."),
  productionRunIds: z.array(z.uuid()).describe("Production runs the stock was drawn from or restored to, ordered by id."),
  biocharProductIds: z.array(z.uuid()).describe("Biochar products the stock was drawn from or restored to, ordered by id."),
  targetBiocharProductId: z.uuid().nullable().describe("Product this draw created, UUID, or null."),
  deliveryId: z.uuid().nullable().describe("Delivery this movement shipped or corrected, UUID, or null."),
  createdAt: z.iso.datetime().describe("Posting instant in UTC, RFC 3339."),
});
export type OutputStockMovementRepresentation = z.infer<typeof outputStockMovementRepresentationSchema>;

type Instant = Date | string;
type Exact = number | string | null;
/** The history query keeps only output movements, so a null kind or instant fails the parse rather than publishing. */
export type OutputStockMovementRepresentationInput = Omit<OutputStockMovementRepresentation,
  "kind" | "occurredAt" | "createdAt" | "dryDeltaKg" | "balanceBeforeDryKg" | "balanceAfterDryKg"> & {
  kind: OutputStockMovementRepresentation["kind"] | null; occurredAt: Instant | null;
  createdAt: Instant; dryDeltaKg: Exact; balanceBeforeDryKg: Exact; balanceAfterDryKg: Exact;
};

const exact = (value: Exact) => value === null ? null : Number(value);

/** Exact numeric columns arrive as text; the ledger stores gram resolution, so a number is lossless. */
export function representOutputStockMovement(row: OutputStockMovementRepresentationInput): OutputStockMovementRepresentation {
  return outputStockMovementRepresentationSchema.parse({
    id: row.id, storageLocationId: row.storageLocationId, kind: row.kind,
    occurredAt: row.occurredAt === null ? null : new Date(row.occurredAt).toISOString(),
    wetMassKg: row.wetMassKg ?? null, moisturePercent: row.moisturePercent ?? null,
    dryDeltaKg: exact(row.dryDeltaKg), balanceBeforeDryKg: exact(row.balanceBeforeDryKg), balanceAfterDryKg: exact(row.balanceAfterDryKg),
    reason: row.reason, correctsMovementId: row.correctsMovementId, correctedByMovementId: row.correctedByMovementId,
    productionRunIds: row.productionRunIds, biocharProductIds: row.biocharProductIds,
    targetBiocharProductId: row.targetBiocharProductId, deliveryId: row.deliveryId,
    createdAt: new Date(row.createdAt).toISOString(),
  });
}
