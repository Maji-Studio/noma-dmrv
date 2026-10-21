/**
 * Which credit batches an unsaved Delivery, Application or Biochar Product
 * joins (#1350). A record follows the production runs behind its biochar, so
 * the preview plans the draw or share with the save path's own planner,
 * reads the runs it takes, and resolves them to batches with the read the
 * saved line uses. Nothing is written.
 *
 * Until the mass is known the draw cannot be planned. The preview then reads
 * the runs whose stock the source holds at that time and says so (`exact`
 * false): the mass decides which of their batches the record joins.
 */
import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { resolveApplicationDryMassTons } from "@/lib/application-write-rules";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { drawnSourceRunIds, sharedSourceRunIds } from "@/lib/credit-batches/source-runs";
import { SafeError } from "@/lib/errors";
import type { RecordCreditBatchPreviewInput } from "@/schemas/record-credit-batches";
import type { OutputStockPreviewInput } from "@/types/output-stock";
import type { RecordCreditBatchPreview } from "@/types/record-credit-batches";
import { getCreditBatchesForSourceRuns } from "./credit-batch-source-runs";
import { appliedOnDelivery, planApplicationShares } from "./delivery-allocation-provenance";
import { getMixDrawnSources } from "./mix-bin-credit-hold";
import { prepareOutputStock } from "./output-stock-operations";
import { requireOrgScope } from "./utils";

type OutputPreviewInput = Extract<RecordCreditBatchPreviewInput, { kind: "delivery" | "biochar-product" }>;
type ApplicationPreviewInput = Extract<RecordCreditBatchPreviewInput, { kind: "application" }>;

/** The save path's stock kind for each record. */
const DRAW_KIND = { delivery: "delivery", "biochar-product": "production_draw" } as const;

/** A refusal the save would also give (a SafeError) plans nothing; anything else is a real failure. */
function refusedAsNull(error: unknown): null {
  if (error instanceof SafeError) return null;
  throw error;
}

async function resolve(ctx: OrgContext, reader: Pick<DbTransaction, "select">, runIds: string[], exact: boolean): Promise<RecordCreditBatchPreview> {
  const { batches, batchedRunIds } = await getCreditBatchesForSourceRuns(ctx, runIds, reader);
  return {
    batches, heldOut: false, exact,
    sourceRunCount: runIds.length,
    unbatchedRunCount: runIds.filter(id => !batchedRunIds.has(id)).length,
  };
}

/**
 * A planned draw names its runs exactly. A draw the planner refuses (too
 * little stock, a missing reading) or one not entered yet falls back to the
 * runs the bin holds at that time.
 */
async function previewOutputDraw(ctx: OrgContext, tx: DbTransaction, input: OutputPreviewInput): Promise<RecordCreditBatchPreview> {
  const binOnly: OutputStockPreviewInput = { ...input.bin, kind: "count", wetMassKg: 0, moisturePercent: null };
  if (input.draw) {
    const draw: OutputStockPreviewInput = { ...input.bin, kind: DRAW_KIND[input.kind], ...input.draw };
    const prepared = await prepareOutputStock(ctx, draw, tx).catch(refusedAsNull);
    if (prepared?.plan && !prepared.preview.blockingMessage) {
      return resolve(ctx, tx, drawnSourceRunIds(prepared.preview.allocations), true);
    }
  }
  const held = await prepareOutputStock(ctx, binOnly, tx);
  return resolve(ctx, tx, drawnSourceRunIds(held.preview.beforeAllocations ?? []), false);
}

/**
 * The shares the save would write for this amount, or, before an amount is
 * entered or when the save would refuse it, the shares of everything the
 * delivery has left: proportional shares reach every run with biochar left.
 */
async function previewApplication(ctx: OrgContext, tx: DbTransaction, input: ApplicationPreviewInput): Promise<RecordCreditBatchPreview> {
  const [delivery] = await tx.select({ id: deliveries.id, wetKg: deliveries.deliveredWetMassKg, dryKg: deliveries.massDryKg })
    .from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, input.deliveryId)));
  if (!delivery) throw new SafeError("Delivery not found in this organization.");
  const applied = await appliedOnDelivery(ctx, tx, delivery.id, input.applicationId);
  const plan = async (wetKg: number) => {
    const dryTons = resolveApplicationDryMassTons({
      requestedWetKg: wetKg, deliveryWetKg: delivery.wetKg, deliveryDryBiocharKg: delivery.dryKg,
      alreadyAppliedWetKg: applied.wetKg, alreadyAppliedDryKg: applied.dryKg,
    });
    return planApplicationShares(ctx, tx, { deliveryId: delivery.id, applicationId: input.applicationId, wetKg, dryKg: dryTons * KG_PER_TONNE });
  };
  // A refused amount, or a delivery without traceable shares, plans nothing.
  const attempt = (wetKg: number) => plan(wetKg).catch(refusedAsNull);
  const requested = input.appliedWetMassKg != null ? await attempt(input.appliedWetMassKg) : null;
  const remainingKg = Math.max(0, (delivery.wetKg ?? 0) - applied.wetKg);
  const shares = requested ?? (remainingKg > 0 ? await attempt(remainingKg) : null) ?? [];
  const exact = requested !== null;
  const mix = await getMixDrawnSources(ctx, tx, shares.map(share => ({ deliveryId: share.deliveryId, productId: share.biocharProductId })));
  if (shares.some(share => mix.deliveryIds.has(share.deliveryId) || mix.productIds.has(share.biocharProductId))) {
    // A held-out application keeps only Removal-owned slices, and a new one has none.
    const runIds = sharedSourceRunIds(shares);
    return { batches: [], heldOut: true, exact, sourceRunCount: runIds.length, unbatchedRunCount: runIds.length };
  }
  return resolve(ctx, tx, sharedSourceRunIds(shares), exact);
}

export async function previewRecordCreditBatches(ctx: OrgContext, input: RecordCreditBatchPreviewInput): Promise<RecordCreditBatchPreview> {
  requireOrgScope(ctx);
  // One snapshot for the plan and the membership read; read only, so nothing posts.
  return db.transaction(
    tx => input.kind === "application" ? previewApplication(ctx, tx, input) : previewOutputDraw(ctx, tx, input),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
