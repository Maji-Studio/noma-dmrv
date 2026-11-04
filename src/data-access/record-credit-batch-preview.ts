/**
 * Which credit batches an unsaved Delivery, Application or Biochar Product
 * joins (#1350). A record follows the production runs behind its biochar, so
 * the preview plans the draw or share with the save path's own planner,
 * reads the runs it takes, and resolves them to batches with the read the
 * saved line uses. Nothing is written.
 *
 * Until the mass is known the draw cannot be planned. The preview then reads
 * the runs whose stock the source holds at that time (`basis: "source"`): the
 * mass decides which of their batches the record joins.
 */
import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { resolveApplicationDryMassTons } from "@/lib/application-write-rules";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { drawnSourceRunIds, heldLayers, productSourceRunIds, sharedSourceRunIds, type DrawnLayer } from "@/lib/credit-batches/source-runs";
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

/** A refusal the save would also give (a SafeError, DomainError included) plans nothing; anything else is a real failure. */
function refusedAsNull(error: unknown): null {
  if (error instanceof SafeError) return null;
  throw error;
}

/** A refused or untraceable preview names no batch. */
function nothingToResolve(basis: "refused" | "untraceable"): RecordCreditBatchPreview {
  return { batches: [], heldOut: false, basis, sourceRunCount: 0, unbatchedRunCount: 0 };
}

async function resolve(ctx: OrgContext, reader: Pick<DbTransaction, "select">, runIds: string[], basis: "planned" | "source"): Promise<RecordCreditBatchPreview> {
  const { batches, batchedRunIds } = await getCreditBatchesForSourceRuns(ctx, runIds, reader);
  return {
    batches, heldOut: false, basis,
    sourceRunCount: runIds.length,
    unbatchedRunCount: runIds.filter(id => !batchedRunIds.has(id)).length,
  };
}

/** The runs a planned draw or a bin's layers lead to, by the record's own saved lineage rule. */
function sourceRuns(kind: OutputPreviewInput["kind"], layers: readonly DrawnLayer[]): string[] {
  return kind === "biochar-product" ? productSourceRunIds(layers) : drawnSourceRunIds(layers);
}

/**
 * A planned draw names its runs exactly. A draw the save would refuse names
 * none. Before a draw is entered, the line reads the runs the bin holds then.
 */
async function previewOutputDraw(ctx: OrgContext, tx: DbTransaction, input: OutputPreviewInput): Promise<RecordCreditBatchPreview> {
  if (input.draw) {
    const draw: OutputStockPreviewInput = { ...input.bin, kind: DRAW_KIND[input.kind], ...input.draw };
    const prepared = await prepareOutputStock(ctx, draw, tx).catch(refusedAsNull);
    if (!prepared?.plan || prepared.preview.blockingMessage) return nothingToResolve("refused");
    return resolve(ctx, tx, sourceRuns(input.kind, prepared.preview.allocations), "planned");
  }
  const bin = await prepareOutputStock(ctx, { ...input.bin, kind: "count", wetMassKg: 0, moisturePercent: null }, tx);
  const held = heldLayers(bin.layers, input.bin.occurredAt).map(layer => ({
    layerId: layer.id,
    runs: layer.runs.map(run => ({ productionRunId: run.productionRunId, dryMassKg: Number(run.remainingDryKg) })),
  }));
  return resolve(ctx, tx, sourceRuns(input.kind, held), "source");
}

/**
 * The shares the save would write for this amount; before an amount is
 * entered, the shares of everything the delivery has left: proportional
 * shares reach every run with biochar left. A delivery whose saved stock
 * allocation is missing or does not balance plans nothing.
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
  // Everything left is always a valid amount, so a refusal here is the delivery's own records.
  const remainingKg = Math.max(0, (delivery.wetKg ?? 0) - applied.wetKg);
  const rest = remainingKg > 0 ? await plan(remainingKg).catch(refusedAsNull) : [];
  if (rest === null || delivery.wetKg == null || delivery.dryKg == null) return nothingToResolve("untraceable");
  let shares = rest;
  let basis: "planned" | "source" = "source";
  if (input.appliedWetMassKg != null) {
    const requested = await plan(input.appliedWetMassKg).catch(refusedAsNull);
    if (requested === null) return nothingToResolve("refused");
    shares = requested;
    basis = "planned";
  }
  const runIds = sharedSourceRunIds(shares);
  const mix = await getMixDrawnSources(ctx, tx, shares.map(share => ({ deliveryId: share.deliveryId, productId: share.biocharProductId })));
  if (shares.some(share => mix.deliveryIds.has(share.deliveryId) || mix.productIds.has(share.biocharProductId))) {
    // A held-out application keeps only Removal-owned slices, and a new one has none.
    return { batches: [], heldOut: true, basis, sourceRunCount: runIds.length, unbatchedRunCount: runIds.length };
  }
  return resolve(ctx, tx, runIds, basis);
}

export async function previewRecordCreditBatches(ctx: OrgContext, input: RecordCreditBatchPreviewInput): Promise<RecordCreditBatchPreview> {
  requireOrgScope(ctx);
  // One snapshot for the plan and the membership read; read only, so nothing posts.
  return db.transaction(
    tx => input.kind === "application" ? previewApplication(ctx, tx, input) : previewOutputDraw(ctx, tx, input),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
