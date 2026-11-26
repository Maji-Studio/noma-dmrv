import { z } from "zod";
import { SafeError } from "@/lib/errors";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { includesProductionInputs } from "./production-claim-policy";

export const PRODUCTION_SOURCE_MANIFEST_VERSION = 1;

const productionSourceManifestSchema = z.object({
  version: z.literal(PRODUCTION_SOURCE_MANIFEST_VERSION),
  countedTransportFeedstockIds: z.array(z.string().min(1)).optional(),
  failedContributors: z.array(z.object({
    runId: z.string().min(1), version: z.number().int().positive(),
    facilityId: z.string().min(1), endDay: z.iso.date(),
    feedstockTypeId: z.string().min(1), feedstockIds: z.array(z.string().min(1)),
    creditBatchId: z.string().min(1), creditBatchCode: z.string().min(1),
    kind: z.literal("failed"), unresolvedReason: z.null(),
  })),
});

/** Historical snapshots without a manifest remain unknown, never a live recomputation. */
export function readProductionSourceManifest(snapshot: unknown) {
  const envelope = z.object({ productionSourceManifest: z.unknown().optional() }).safeParse(snapshot);
  if (!envelope.success || envelope.data.productionSourceManifest === undefined) return null;
  const parsed = productionSourceManifestSchema.safeParse(envelope.data.productionSourceManifest);
  if (!parsed.success) throw new SafeError("This saved submission has an invalid production source manifest. Refresh the review before submitting.");
  return parsed.data;
}

/** Defense at compilation: only failed inputs attached to this Removal's claiming batches. */
export function claimingFailedEmissionRuns(ctx: RemovalSubmissionContext, removalId: string) {
  const claiming = new Set(ctx.memberBatchClaims.filter(batch =>
    includesProductionInputs(batch.claimedByRemovalId, removalId)).map(batch => batch.creditBatchId));
  const manifest = readProductionSourceManifest({ productionSourceManifest: ctx.productionSourceManifest });
  if (ctx.failedEmissionRuns?.length && !manifest) {
    throw new SafeError("Failed production inputs have no source manifest. Refresh the review before submitting.");
  }
  const ids = new Set(manifest?.failedContributors.filter(run => claiming.has(run.creditBatchId)).map(run => run.runId));
  return [...new Map((ctx.failedEmissionRuns ?? []).filter(run => run.status === "failed" && ids.has(run.id))
    .map(run => [run.id, run])).values()];
}

export type ProductionSourceManifest = z.infer<typeof productionSourceManifestSchema>;

/** Canonical source identities, independently of numeric emissions or array order. */
export function productionSourceManifestsEqual(
  reviewed: ProductionSourceManifest | null,
  current: ProductionSourceManifest | null,
): boolean {
  const canonical = (manifest: ProductionSourceManifest | null) => JSON.stringify({
    failedContributors: (manifest?.failedContributors ?? []).map(run => ({ ...run,
      feedstockIds: [...run.feedstockIds].sort(),
    })).sort((a, b) => a.runId.localeCompare(b.runId)),
    countedTransportFeedstockIds: [...(manifest?.countedTransportFeedstockIds ?? [])].sort(),
  });
  return canonical(reviewed) === canonical(current);
}
