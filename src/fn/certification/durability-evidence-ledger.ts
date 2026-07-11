/**
 * 200-year durability evidence-ledger generation, storage, and Source mirroring.
 *
 * Thin wrapper over the shared ledger core (`evidence-ledger-core.ts`): builds
 * the pure `DurabilityLedgerModel` from the removal's credit-batch durability
 * data (the same `buildPerBatchDurabilityData` figures the measurement-sample
 * POST submits, so the ledger reconciles to what's submitted), hashes it, and
 * hands a `LedgerArtifactSpec` to `ensureLedgerSource`.
 *
 * Unlike the gated measurement-sample POST, this PDF is benign evidence — it
 * shows noma's working in noma's native units (dimensionless H/C, carbon %, kg,
 * °C), independent of the sandbox-gated wire-unit transforms — so it is NOT
 * behind `DURABILITY_MEASUREMENT_SAMPLES_LIVE`. It generates whenever a removal
 * has sampled credit batches and a facility soil reference; the document attaches
 * to a member credit batch so the candidate-document walk mirrors its Source into
 * the removal's `source_ids`. Best-effort at the submit call site.
 *
 * Server-internal core (no "use server" — takes an explicit `orgCtx`, called from
 * the submit pipeline which already resolved the caller).
 */
import type { OrgContext } from "@/lib/auth/server";
import { getFacilityById } from "@/data-access/facilities";
import { buildDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-build-model";
import { renderDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-pdf";
import {
  DURABILITY_EVIDENCE_LEDGER_KIND,
  type DurabilityEvidenceLedgerDocMetadata,
} from "@/lib/certification/evidence-ledger/durability-types";
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

/**
 * Generate (or reuse) the durability evidence ledger for a removal, store it, and
 * mirror it to an Isometric Source. Loads the submission context, then delegates
 * to the from-context variant. The submit pipeline already holds a context and
 * should call `ensureDurabilityEvidenceLedgerSourceFromContext` to avoid a second
 * load.
 */
export async function ensureDurabilityEvidenceLedgerSource(
  orgCtx: OrgContext,
  removalId: string,
): Promise<EnsureLedgerResult> {
  const ctx = await loadRemovalSubmissionContext(orgCtx, removalId);
  return ensureDurabilityEvidenceLedgerSourceFromContext(orgCtx, removalId, ctx);
}

/**
 * As above, but against an already-loaded submission context. Idempotent on
 * ledger content; supersedes any prior durability ledger for the removal. Throws
 * on render/storage/mirror failure — the caller decides whether a ledger hiccup
 * should block submission.
 */
export async function ensureDurabilityEvidenceLedgerSourceFromContext(
  orgCtx: OrgContext,
  removalId: string,
  ctx: RemovalSubmissionContext,
): Promise<EnsureLedgerResult> {
  const log = logger.child({ op: "removal:durability-evidence-ledger", removalId });

  if (!ctx.mapping) {
    // No Isometric project linked → nothing to mirror into.
    return { status: "skipped", reason: "no-mapping" };
  }
  if (ctx.memberBatches.length === 0) {
    // No credit batch to attach the document to.
    return { status: "skipped", reason: "no-batches" };
  }
  if (!ctx.facilityReferenceSoilTemperature) {
    // A 200-year durability ledger needs the facility soil reference (the gate
    // blocks submission when it's unset; here it just means there's nothing to
    // evidence yet — e.g. a non-durability removal).
    return { status: "skipped", reason: "no-soil-reference" };
  }

  const facility = await getFacilityById(orgCtx, ctx.facilityId);
  const memberBatchCodes =
    ctx.memberBatches.map((b) => b.code).join(" · ") || null;

  const model = buildDurabilityLedgerModel({
    batches: ctx.batchesWithSamples,
    attributionByRunId: ctx.attributionByRunId,
    facilityReferenceSoilTemperature: ctx.facilityReferenceSoilTemperature,
    memberBatchCodes,
    facilityName: facility?.name ?? null,
    externalProjectId: ctx.mapping.externalProjectId,
    generatedAtIso: new Date().toISOString(),
  });

  const metadata: DurabilityEvidenceLedgerDocMetadata = {
    kind: DURABILITY_EVIDENCE_LEDGER_KIND,
    removalId,
    contentHash: stableLedgerContentHash(model),
  };

  return ensureLedgerSource(orgCtx, {
    kind: DURABILITY_EVIDENCE_LEDGER_KIND,
    removalId,
    facilityId: ctx.facilityId,
    attachBatchId: ctx.memberBatches[0].id,
    contentHash: metadata.contentHash,
    // No sampled batch → no durability chemistry to evidence; retire any stale
    // ledger (mirrors the transport ledger's no-legs skip).
    isEmpty: model.batches.length === 0,
    emptyReason: "no-samples",
    storageKeyPrefix: "durability-evidence",
    fileName: `durability-evidence-ledger-${model.memberBatchCodes ?? removalId}.pdf`,
    buildMetadata: () => metadata as unknown as Record<string, unknown>,
    render: () => renderDurabilityLedgerPdf(model),
    log,
  });
}
