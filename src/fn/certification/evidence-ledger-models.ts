import { createHash } from "node:crypto";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { buildLedgerModel } from "@/lib/certification/evidence-ledger/build-model";
import { buildDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-build-model";
import { buildThousandYearDurabilityLedgerModel } from "@/lib/certification/evidence-ledger/durability-1000-build-model";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";

/** Pin the render timestamp to a constant so identical models hash identically. */
export function stableLedgerContentHash<M extends { generatedAtIso: string }>(
  model: M,
): string {
  const stable = { ...model, generatedAtIso: "" };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** Shared inputs for generation and DB-only correction comparison. */
export function transportLedgerModel(ctx: RemovalSubmissionContext, facilityName: string | null, generatedAtIso: string) {
  const memberBatchCodes =
    ctx.memberBatches.map((b) => b.code).join(" · ") || null;

  return buildLedgerModel({
    legsByCategory: ctx.transportLegs,
    memberBatchCodes,
    facilityName,
    externalProjectId: ctx.mapping!.externalProjectId,
    generatedAtIso,
  });

}
export function durabilityLedgerModel(ctx: RemovalSubmissionContext, facilityName: string | null, generatedAtIso: string) {
  const memberBatchCodes =
    ctx.memberBatches.map((b) => b.code).join(" · ") || null;

  const commonModelArgs = {
    batches: ctx.batchesWithSamples,
    attributionByRunId: ctx.attributionByRunId,
    memberBatchCodes,
    facilityName,
    externalProjectId: ctx.mapping!.externalProjectId,
    generatedAtIso,
  };
  return ctx.batchesWithSamples[0]?.durabilityOption === "1000_year"
    ? buildThousandYearDurabilityLedgerModel({ ...commonModelArgs, componentKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR })
    : buildDurabilityLedgerModel({ ...commonModelArgs, facilityReferenceSoilTemperature: ctx.facilityReferenceSoilTemperature! });
}
