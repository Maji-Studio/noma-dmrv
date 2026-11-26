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

/** Keep ownership attribution and already-counted transport identical on every read. */
export async function loadCountedFailedTransportOwners(
  ctx: OrgContext, contributors: readonly EmissionContributor[],
  reader: Pick<DbTransaction, "select" | "selectDistinct"> = db,
  removalId?: string | null,
): Promise<Map<string, string>> {
  requireOrgScope(ctx);
  if (!contributors.length) return new Map();
  const runIds = new Set(contributors.map(run => run.runId));
  const feedstockIds = [...new Set(contributors.flatMap(run => run.feedstockIds))];
  const owners = await getFeedstockTransportOwners(ctx, feedstockIds, reader);
  const countedElsewhere = await getTransportFeedstockIdsCountedElsewhere(ctx, feedstockIds, removalId, reader);
  return new Map([...owners].filter(([id, runId]) => runIds.has(runId) && !countedElsewhere.has(id)));
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
