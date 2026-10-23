import { durabilityLedgerModel } from "./evidence-ledger-models";
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
import { getFacilityById } from "@/data-access/facilities";
import type { OrgContext } from "@/lib/auth/server";
import { CURRENT_1000_YEAR_PREVIEW_FORMULA_VERSION } from "@/lib/calculations/biochar-removal";
import { renderThousandYearDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-1000-pdf";
import { renderDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-pdf";
import {
  DURABILITY_EVIDENCE_LEDGER_KIND,
  type DurabilityEvidenceLedgerDocMetadata,
  type DurabilityLedgerModel,
  type ThousandYearDurabilityLedgerModel,
} from "@/lib/certification/evidence-ledger/durability-types";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";
import { logger } from "@/lib/log";
import {
  type RemovalSubmissionContext,
} from "./certify-context-core";
import {
  ensureLedgerSource,
  retireLedgerSources,
  stableLedgerContentHash,
  type EnsureLedgerResult,
} from "./evidence-ledger-core";

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
  const model = durabilityLedgerModel(ctx, facility?.name ?? null, new Date().toISOString());
  const render = () => durabilityOption === "1000_year"
    ? renderThousandYearDurabilityLedgerPdf(model as ThousandYearDurabilityLedgerModel)
    : renderDurabilityLedgerPdf(model as DurabilityLedgerModel);

  const contentHash = stableLedgerContentHash({
    ...model,
    durabilityOption,
  });
  const metadata: DurabilityEvidenceLedgerDocMetadata = {
    kind: DURABILITY_EVIDENCE_LEDGER_KIND,
    removalId,
    durabilityOption,
    ...(durabilityOption === "1000_year"
      ? {
          componentKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
          formulaVersion: CURRENT_1000_YEAR_PREVIEW_FORMULA_VERSION,
        }
      : {}),
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
