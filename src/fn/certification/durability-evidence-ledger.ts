/**
 * Durability evidence-ledger generation, storage, and Source mirroring.
 *
 * Thin wrapper over the shared ledger core (`evidence-ledger-core.ts`): builds
 * the tier-specific ledger from the same credit-batch data as the
 * measurement-sample POST, hashes it, and hands a `LedgerArtifactSpec` to
 * `ensureLedgerSource`.
 *
 * The 200-year PDF reconciles H/C, carbon, product mass, and the facility soil
 * reference. The 1000-year PDF records per-replicate total carbon, directly
 * measured inorganic carbon, calculated organic carbon, s_fraction, attributed
 * product mass, and the current component's raw/capped durability explanation.
 * The document attaches to a member credit batch so candidate discovery binds
 * its Source to the matching measurement-sample Datapoints.
 *
 * Server-internal core (no "use server" — takes an explicit `orgCtx`, called from
 * the submit pipeline which already resolved the caller).
 */
import type { OrgContext } from "@/lib/auth/server";
import { getFacilityById } from "@/data-access/facilities";
import { buildDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-build-model";
import { buildThousandYearDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-1000-build-model";
import { renderDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-pdf";
import { renderThousandYearDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-1000-pdf";
import {
  DURABILITY_EVIDENCE_LEDGER_KIND,
  type DurabilityLedgerModel,
  type DurabilityEvidenceLedgerDocMetadata,
  type ThousandYearDurabilityLedgerModel,
} from "@/lib/certification/evidence-ledger/durability-types";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";
import { logger } from "@/lib/log";
import {
  loadRemovalSubmissionContext,
  type RemovalSubmissionContext,
} from "./certify-context-core";
import {
  ensureLedgerSource,
  retireLedgerSources,
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
  if (ctx.batchesWithSamples.length === 0) {
    return retireLedgerSources(orgCtx, {
      kind: DURABILITY_EVIDENCE_LEDGER_KIND,
      removalId,
      reason: "no-samples",
      log,
    });
  }
  const durabilityOption = ctx.batchesWithSamples[0]?.durabilityOption;
  if (
    !durabilityOption ||
    ctx.batchesWithSamples.some(
      (batch) => batch.durabilityOption !== durabilityOption,
    )
  ) {
    return retireLedgerSources(orgCtx, {
      kind: DURABILITY_EVIDENCE_LEDGER_KIND,
      removalId,
      reason: "mixed-or-missing-tier",
      log,
    });
  }
  if (
    durabilityOption === "200_year" &&
    !ctx.facilityReferenceSoilTemperature
  ) {
    // A 200-year durability ledger needs the facility soil reference (the gate
    // blocks submission when it's unset). Retire any previously valid ledger so
    // the stale Source cannot re-enter a later submission.
    return retireLedgerSources(orgCtx, {
      kind: DURABILITY_EVIDENCE_LEDGER_KIND,
      removalId,
      reason: "no-soil-reference",
      log,
    });
  }

  const facility = await getFacilityById(orgCtx, ctx.facilityId);
  const memberBatchCodes =
    ctx.memberBatches.map((b) => b.code).join(" · ") || null;

  const commonModelArgs = {
    batches: ctx.batchesWithSamples,
    attributionByRunId: ctx.attributionByRunId,
    memberBatchCodes,
    facilityName: facility?.name ?? null,
    externalProjectId: ctx.mapping.externalProjectId,
    generatedAtIso: new Date().toISOString(),
  };
  let model: DurabilityLedgerModel | ThousandYearDurabilityLedgerModel;
  let render: () => Promise<Buffer>;
  if (durabilityOption === "1000_year") {
    const thousandYearModel =
      buildThousandYearDurabilityLedgerModel({
        ...commonModelArgs,
        componentKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
      });
    model = thousandYearModel;
    render = () =>
      renderThousandYearDurabilityLedgerPdf(thousandYearModel);
  } else {
    const twoHundredYearModel = buildDurabilityLedgerModel({
      ...commonModelArgs,
      facilityReferenceSoilTemperature:
        ctx.facilityReferenceSoilTemperature!,
    });
    model = twoHundredYearModel;
    render = () => renderDurabilityLedgerPdf(twoHundredYearModel);
  }

  const contentHash = stableLedgerContentHash({
    ...model,
    durabilityOption,
  });
  const metadata: DurabilityEvidenceLedgerDocMetadata = {
    kind: DURABILITY_EVIDENCE_LEDGER_KIND,
    removalId,
    durabilityOption,
    contentHash,
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
    render,
    log,
  });
}
