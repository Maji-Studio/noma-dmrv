/**
 * Transport evidence-ledger generation, storage, and Source mirroring.
 *
 * Thin wrapper over the shared ledger core (`evidence-ledger-core.ts`): builds
 * the pure transport `LedgerModel` from the removal's live transport legs, hashes
 * it, and hands a `LedgerArtifactSpec` to `ensureLedgerSource`, which owns the
 * reuse/render/store/mirror/retire choreography common to both evidence ledgers.
 *
 * Server-internal core (no "use server" — it takes an explicit `orgCtx` and is
 * called from the submit pipeline, which already resolved the caller). On every
 * Submit/Resubmit, `ensureTransportEvidenceLedgerSource` regenerates the ledger
 * from the removal's live transport legs, stores it, attaches it as a private
 * document on a member credit batch, and mirrors it to an Isometric Source so it
 * rides into the removal's `source_ids`.
 */
import type { OrgContext } from "@/lib/auth/server";
import { getFacilityById } from "@/data-access/facilities";
import { appliedBiocharFraction } from "@/lib/certification/mass-accounting";
import { buildLedgerModel } from "@/lib/certification/evidence-ledger/build-model";
import { renderEvidenceLedgerPdf } from "@/lib/certification/evidence-ledger/pdf";
import {
  TRANSPORT_EVIDENCE_LEDGER_KIND,
  type TransportEvidenceLedgerDocMetadata,
} from "@/lib/certification/evidence-ledger/types";
import { logger } from "@/lib/log";
import {
  loadRemovalSubmissionContext,
  type RemovalSubmissionContext,
} from "./certify-context-core";
import {
  ensureLedgerSource,
  stableLedgerContentHash,
  type EnsureLedgerResult,
} from "./evidence-ledger-core";

export type { EnsureLedgerResult } from "./evidence-ledger-core";

/**
 * Generate (or reuse) the transport evidence ledger for a removal, store it, and
 * mirror it to an Isometric Source. Loads the submission context, then delegates
 * to the from-context variant. Use this for standalone callers (e.g. a manual
 * regenerate); the submit pipeline already holds a context and should call
 * `ensureTransportEvidenceLedgerSourceFromContext` to avoid a second load.
 */
export async function ensureTransportEvidenceLedgerSource(
  orgCtx: OrgContext,
  removalId: string,
): Promise<EnsureLedgerResult> {
  const ctx = await loadRemovalSubmissionContext(orgCtx, removalId);
  return ensureTransportEvidenceLedgerSourceFromContext(orgCtx, removalId, ctx);
}

/**
 * As above, but against an already-loaded submission context. Idempotent on
 * ledger content; supersedes any prior transport ledger for the removal. Throws
 * on render/storage/mirror failure — the caller decides whether a ledger hiccup
 * should block submission.
 */
export async function ensureTransportEvidenceLedgerSourceFromContext(
  orgCtx: OrgContext,
  removalId: string,
  ctx: RemovalSubmissionContext,
): Promise<EnsureLedgerResult> {
  const log = logger.child({ op: "removal:evidence-ledger", removalId });

  if (!ctx.mapping) {
    // No Isometric project linked → nothing to mirror into.
    return { status: "skipped", reason: "no-mapping" };
  }
  if (ctx.memberBatches.length === 0) {
    // No credit batch to attach the document to.
    return { status: "skipped", reason: "no-batches" };
  }

  const facility = await getFacilityById(orgCtx, ctx.facilityId);
  const memberBatchCodes =
    ctx.memberBatches.map((b) => b.code).join(" · ") || null;

  const model = buildLedgerModel({
    legsByCategory: ctx.transportLegs,
    memberBatchCodes,
    facilityName: facility?.name ?? null,
    externalProjectId: ctx.mapping.externalProjectId,
    generatedAtIso: new Date().toISOString(),
    // §8.6.2 delivery bucket (ADR 0020): the SAME removal-wide fraction the
    // submit pipeline scales the biochar-transport datapoint by, so the
    // ledger's biochar subtotal reconciles to the submitted scalar.
    appliedBiocharFraction: appliedBiocharFraction(ctx.runSummary),
  });

  const metadata: TransportEvidenceLedgerDocMetadata = {
    kind: TRANSPORT_EVIDENCE_LEDGER_KIND,
    removalId,
    contentHash: stableLedgerContentHash(model),
  };

  return ensureLedgerSource(orgCtx, {
    kind: TRANSPORT_EVIDENCE_LEDGER_KIND,
    removalId,
    facilityId: ctx.facilityId,
    attachBatchId: ctx.memberBatches[0].id,
    contentHash: metadata.contentHash,
    // Legs removed entirely → no transport to evidence; retire any stale ledger.
    isEmpty: model.totalLegs === 0,
    emptyReason: "no-legs",
    storageKeyPrefix: "transport-evidence",
    fileName: `transport-evidence-ledger-${model.memberBatchCodes ?? removalId}.pdf`,
    buildMetadata: () => metadata as unknown as Record<string, unknown>,
    render: () => renderEvidenceLedgerPdf(model),
    log,
  });
}
