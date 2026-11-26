import { includesProductionInputs } from "@/lib/certification/production-claim-policy";
import { getTransportFeedstockIdsCountedElsewhere } from "./certification-lineage-guards";
import { db, type DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { PRODUCTION_SOURCE_MANIFEST_VERSION, productionSourceManifestsEqual, readProductionSourceManifest, type ProductionSourceManifest } from "@/lib/certification/production-source-manifest";
import { loadBatchEmissionContributors, type EmissionContributor } from "./credit-batch-emission-contributors";
import { getFeedstockTransportOwners } from "./feedstock-transport-ownership";
import { requireOrgScope } from "./utils";

/** The reservation caller holds each batch row; source writers share these locks. */
export async function loadProductionSourceManifest(
  ctx: OrgContext,
  batchIds: readonly string[],
  reader: Pick<DbTransaction, "select" | "selectDistinct"> = db,
  removalId?: string | null,
): Promise<ProductionSourceManifest> {
  requireOrgScope(ctx);
  const batches = await loadBatchEmissionContributors(ctx, batchIds, reader, { failedOnly: true });
  return buildProductionSourceManifest(ctx, Object.values(batches).flatMap(batch => batch.failedContributors), reader, removalId);
}

/** Shared counted-input policy for review, reservation and batch figures. */
export async function buildProductionSourceManifest(
  ctx: OrgContext,
  contributors: readonly EmissionContributor[],
  reader: Pick<DbTransaction, "select" | "selectDistinct"> = db,
  removalId?: string | null,
): Promise<ProductionSourceManifest> {
  requireOrgScope(ctx);
  const failedContributors = [...contributors].sort((a, b) => a.runId.localeCompare(b.runId));
  const owners = await loadCountedFailedTransportOwners(ctx, failedContributors, reader, removalId);
  return readProductionSourceManifest({ productionSourceManifest: {
    version: PRODUCTION_SOURCE_MANIFEST_VERSION, failedContributors,
    countedTransportFeedstockIds: [...owners.keys()].sort(),
  } })!;
}

/** Keep ownership attribution and already-counted transport identical on every read.
 * A Removal passes its ID; batch views pass each batch's claiming Removal ID.
 * Missing claims exclude every other listing snapshot.
 */
export async function loadCountedFailedTransportOwners(
  ctx: OrgContext, contributors: readonly EmissionContributor[],
  reader: Pick<DbTransaction, "select" | "selectDistinct"> = db,
  removalId?: string | null | ReadonlyMap<string, string | null>,
): Promise<Map<string, string>> {
  requireOrgScope(ctx);
  if (!contributors.length) return new Map();
  const runs = new Map(contributors.map(run => [run.runId, run]));
  const feedstockIds = [...new Set(contributors.flatMap(run => run.feedstockIds))];
  const owners = await getFeedstockTransportOwners(ctx, feedstockIds, reader);
  const groups = new Map<string | null, [string, string][]>();
  for (const [id, runId] of owners) {
    const run = runs.get(runId);
    if (!run) continue;
    const relativeRemovalId = typeof removalId === "object" && removalId !== null
      ? removalId.get(run.creditBatchId ?? "") ?? null : removalId ?? null;
    const group = groups.get(relativeRemovalId) ?? [];
    group.push([id, runId]);
    groups.set(relativeRemovalId, group);
  }
  const counted = await Promise.all([...groups].map(async ([relativeRemovalId, entries]) => {
    const elsewhere = await getTransportFeedstockIdsCountedElsewhere(ctx, entries.map(([id]) => id), relativeRemovalId, reader);
    return entries.filter(([id]) => !elsewhere.has(id));
  }));
  return new Map(counted.flat());
}

/** No additional locks here: acquiring runs after batch rows would invert writer order. */
export async function assertProductionSourceManifestFresh(
  ctx: OrgContext,
  tx: DbTransaction,
  batchIds: readonly string[],
  reviewed: ProductionSourceManifest | null,
  removalId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const current = await loadProductionSourceManifest(ctx, batchIds, tx, removalId);
  if (!productionSourceManifestsEqual(reviewed, current)) {
    throw new DomainError("conflict", "Production sources changed while preparing this Removal. Refresh the review and submit again.", { retryable: true });
  }
}

/** Shared production-claim scope for submission transport and the Sources reader. */
export async function loadProductionClaimFeedstockScope(
  ctx: OrgContext,
  batches: readonly { id: string; productionEmissionsClaimedByRemovalId: string | null; productionFeedstockIds: string[] }[],
  removalId: string | null,
  reader: Pick<DbTransaction, "select" | "selectDistinct"> = db,
) {
  requireOrgScope(ctx);
  const productionBatches = batches.filter(batch => includesProductionInputs(batch.productionEmissionsClaimedByRemovalId, removalId));
  const contributors = await loadBatchEmissionContributors(ctx, productionBatches.map(batch => batch.id), reader, { failedOnly: true });
  const failedContributors = Object.values(contributors).flatMap(batch => batch.failedContributors);
  const manifest = await buildProductionSourceManifest(ctx, failedContributors, reader, removalId);
  return {
    failedContributors,
    manifest,
    feedstockIds: [...new Set([...productionBatches.flatMap(batch => batch.productionFeedstockIds),
      ...(manifest.countedTransportFeedstockIds ?? [])])],
  };
}
