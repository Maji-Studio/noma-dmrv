import { db, type DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { productionSourceManifestsEqual, readProductionSourceManifest, type ProductionSourceManifest } from "@/lib/certification/production-source-manifest";
import { loadBatchEmissionContributors } from "./credit-batch-emission-contributors";
import { getFeedstockTransportOwners } from "./feedstock-transport-ownership";
import { requireOrgScope } from "./utils";

/** The reservation caller holds each batch row; source writers share these locks. */
export async function loadProductionSourceManifest(
  ctx: OrgContext,
  batchIds: readonly string[],
  reader: Pick<DbTransaction, "select" | "selectDistinct"> = db,
): Promise<ProductionSourceManifest> {
  requireOrgScope(ctx);
  const batches = await loadBatchEmissionContributors(ctx, batchIds, reader);
  const failedContributors = Object.values(batches).flatMap(batch => batch.failedContributors)
    .sort((a, b) => a.runId.localeCompare(b.runId));
  const runIds = new Set(failedContributors.map(run => run.runId));
  const feedstockIds = [...new Set(failedContributors.flatMap(run => run.feedstockIds))];
  const owners = await getFeedstockTransportOwners(ctx, feedstockIds, reader);
  return readProductionSourceManifest({ productionSourceManifest: {
    version: 1, failedContributors,
    countedTransportFeedstockIds: feedstockIds.filter(id => runIds.has(owners.get(id) ?? "")).sort(),
  } })!;
}

/** No additional locks here: acquiring runs after batch rows would invert writer order. */
export async function assertProductionSourceManifestFresh(
  ctx: OrgContext,
  tx: DbTransaction,
  batchIds: readonly string[],
  reviewed: ProductionSourceManifest | null,
): Promise<void> {
  requireOrgScope(ctx);
  const current = await loadProductionSourceManifest(ctx, batchIds, tx);
  if (!productionSourceManifestsEqual(reviewed, current)) {
    throw new DomainError("conflict", "Production sources changed while preparing this Removal. Refresh the review and submit again.", { retryable: true });
  }
}
