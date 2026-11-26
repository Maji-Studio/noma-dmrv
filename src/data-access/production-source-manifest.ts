import { getTransportFeedstockIdsCountedElsewhere } from "./certification-lineage-guards";
import { db, type DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { PRODUCTION_SOURCE_MANIFEST_VERSION, productionSourceManifestsEqual, readProductionSourceManifest, type ProductionSourceManifest } from "@/lib/certification/production-source-manifest";
import { loadBatchEmissionContributors } from "./credit-batch-emission-contributors";
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
  const batches = await loadBatchEmissionContributors(ctx, batchIds, reader);
  const failedContributors = Object.values(batches).flatMap(batch => batch.failedContributors)
    .sort((a, b) => a.runId.localeCompare(b.runId));
  const runIds = new Set(failedContributors.map(run => run.runId));
  const feedstockIds = [...new Set(failedContributors.flatMap(run => run.feedstockIds))];
  const owners = await getFeedstockTransportOwners(ctx, feedstockIds, reader);
  const countedElsewhere = await getTransportFeedstockIdsCountedElsewhere(ctx, feedstockIds, removalId, reader);
  return readProductionSourceManifest({ productionSourceManifest: {
    version: PRODUCTION_SOURCE_MANIFEST_VERSION, failedContributors,
    countedTransportFeedstockIds: feedstockIds.filter(id => runIds.has(owners.get(id) ?? "") && !countedElsewhere.has(id)).sort(),
  } })!;
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
