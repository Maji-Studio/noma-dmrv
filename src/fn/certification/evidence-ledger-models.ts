import type { TransportLeg } from "@/db/schema";
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

/** Retain the historical created-at ordering, resolving ties by stable identity. */
function orderedLegs(legs: TransportLeg[]) {
  return [...legs].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
}

/** Deterministic render inputs; correction reads compare source facts separately. */
export function transportLedgerModel(ctx: RemovalSubmissionContext, facilityName: string | null, generatedAtIso: string) {
  const memberBatchCodes =
    [...ctx.memberBatches].sort((a, b) => a.id.localeCompare(b.id)).map((b) => b.code).join(" · ") || null;

  return buildLedgerModel({
    legsByCategory: {
      feedstock: orderedLegs(ctx.transportLegs.feedstock),
      // Delivery-derived legs have always been ordered by delivery identity.
      biochar: [...ctx.transportLegs.biochar].sort((a, b) => a.id.localeCompare(b.id)),
      sample: orderedLegs(ctx.transportLegs.sample),
    },
    memberBatchCodes,
    facilityName,
    externalProjectId: ctx.mapping!.externalProjectId,
    generatedAtIso,
  });

}
export function durabilityLedgerModel(ctx: RemovalSubmissionContext, facilityName: string | null, generatedAtIso: string) {
  const memberBatchCodes =
    [...ctx.memberBatches].sort((a, b) => a.id.localeCompare(b.id)).map((b) => b.code).join(" · ") || null;

  const commonModelArgs = {
    batches: [...ctx.batchesWithSamples].sort((a, b) => a.creditBatchId.localeCompare(b.creditBatchId)).map(batch => ({
      ...batch,
      samples: [...batch.samples].sort((a, b) => a.id.localeCompare(b.id)),
      runs: [...batch.runs].sort((a, b) => a.id.localeCompare(b.id)),
    })),
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
