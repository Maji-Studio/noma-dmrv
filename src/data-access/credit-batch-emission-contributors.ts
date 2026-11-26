import { COMPLETED_PRODUCTION_RUN_STATUS, EMISSION_SOURCE_RUN_STATUSES, FAILED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { and, eq, inArray, isNull, exists, gte, lte, or } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, feedstocks, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { productionRunMembershipDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

type Reader = Pick<DbTransaction, "select" | "selectDistinct">;
export type EmissionContributor = {
  runId: string;
  version: number;
  facilityId: string;
  endDay: string | null;
  feedstockTypeId: string | null;
  feedstockIds: string[];
  creditBatchId: string | null;
  creditBatchCode: string | null;
  kind: "material" | "failed";
  unresolvedReason: "no-batch" | "empty-feedstock" | "mixed-feedstock" | null;
};
export type BatchEmissionContributors = {
  materialMembers: EmissionContributor[];
  failedContributors: EmissionContributor[];
};
type Options = { includeArchived?: boolean };

/** One set-based resolver, also usable inside the caller's write transaction. */
export async function loadRunEmissionContributors(
  ctx: OrgContext, runIds: readonly string[], reader: Reader = db, options: Options = {},
): Promise<EmissionContributor[]> {
  requireOrgScope(ctx);
  if (!runIds.length) return [];
  const runs = await reader.select({
    id: productionRuns.id, version: productionRuns.version, facilityId: productionRuns.facilityId,
    status: productionRuns.status, endDay: productionRunMembershipDateExpr(ctx.organizationId),
  }).from(productionRuns).where(and(
    eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, [...new Set(runIds)]),
    inArray(productionRuns.status, [...EMISSION_SOURCE_RUN_STATUSES]),
    options.includeArchived ? undefined : isNull(productionRuns.archivedAt),
  ));
  if (!runs.length) return [];
  const ids = runs.map(run => run.id);
  const [draws, memberships, batches] = await Promise.all([
    reader.select({ runId: productionRunFeedstocks.productionRunId, feedstockId: feedstocks.id, typeId: feedstocks.feedstockTypeId })
      .from(productionRunFeedstocks).innerJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)))
      .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), inArray(productionRunFeedstocks.productionRunId, ids))),
    runs.some(run => run.status === COMPLETED_PRODUCTION_RUN_STATUS) ? reader.select({ runId: creditBatchProductionRuns.productionRunId, batchId: creditBatchProductionRuns.creditBatchId })
      .from(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), inArray(creditBatchProductionRuns.productionRunId, ids))) : Promise.resolve([]),
    reader.select({ id: creditBatches.id, code: creditBatches.code, facilityId: creditBatches.facilityId,
      typeId: creditBatches.feedstockTypeId, startDate: creditBatches.startDate, endDate: creditBatches.endDate })
      .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId),
        inArray(creditBatches.facilityId, [...new Set(runs.map(run => run.facilityId))]),
        options.includeArchived ? undefined : isNull(creditBatches.archivedAt))),
  ]);
  return runs.flatMap((run): EmissionContributor[] => {
    const linked = draws.filter(draw => draw.runId === run.id);
    const types = new Set(linked.map(draw => draw.typeId));
    const typeId = types.size === 1 ? [...types][0] : null;
    const matches = run.status === COMPLETED_PRODUCTION_RUN_STATUS
      ? batches.filter(batch => memberships.some(member => member.runId === run.id && member.batchId === batch.id))
      : batches.filter(batch => typeId && batch.typeId === typeId && batch.facilityId === run.facilityId &&
        run.endDay && batch.startDate <= run.endDay && batch.endDate >= run.endDay);
    if (matches.length > 1) throw new SafeError(`Production run ${run.id} matches multiple credit batches. Review overlapping batch windows before assigning emissions.`);
    if (run.status === COMPLETED_PRODUCTION_RUN_STATUS && !matches.length) return [];
    const match = matches[0];
    return [{ runId: run.id, version: run.version, facilityId: run.facilityId, endDay: run.endDay,
      feedstockTypeId: typeId, feedstockIds: [...new Set(linked.map(draw => draw.feedstockId))].sort(),
      creditBatchId: match?.id ?? null, creditBatchCode: match?.code ?? null,
      kind: run.status === COMPLETED_PRODUCTION_RUN_STATUS ? "material" : "failed",
      unresolvedReason: match ? null : types.size === 0 ? "empty-feedstock" : types.size > 1 ? "mixed-feedstock" : "no-batch" }];
  });
}

/** Material membership remains separate; failed attachments never create membership rows. */
export async function loadBatchEmissionContributors(
  ctx: OrgContext, batchIds: readonly string[], reader: Reader = db, options: Options & { failedOnly?: boolean } = {},
): Promise<Record<string, BatchEmissionContributors>> {
  requireOrgScope(ctx);
  const ids = [...new Set(batchIds)];
  if (!ids.length) return {};
  const batches = await reader.select({ id: creditBatches.id, facilityId: creditBatches.facilityId, feedstockTypeId: creditBatches.feedstockTypeId, startDate: creditBatches.startDate, endDate: creditBatches.endDate }).from(creditBatches)
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, ids),
      options.includeArchived ? undefined : isNull(creditBatches.archivedAt)));
  if (!batches.length) return {};
  const endDay = productionRunMembershipDateExpr(ctx.organizationId);
  const runs = await reader.select({ id: productionRuns.id }).from(productionRuns)
    .where(and(eq(productionRuns.organizationId, ctx.organizationId),
      options.includeArchived ? undefined : isNull(productionRuns.archivedAt),
      or(
        options.failedOnly ? undefined : and(eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS), exists(reader.select({ id: creditBatchProductionRuns.productionRunId })
          .from(creditBatchProductionRuns).where(and(
            eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
            eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
            inArray(creditBatchProductionRuns.creditBatchId, batches.map(batch => batch.id)),
          )))),
        and(eq(productionRuns.status, FAILED_PRODUCTION_RUN_STATUS), or(...batches.map(batch => and(
          eq(productionRuns.facilityId, batch.facilityId), gte(endDay, batch.startDate), lte(endDay, batch.endDate),
          exists(reader.select({ id: productionRunFeedstocks.productionRunId }).from(productionRunFeedstocks)
            .innerJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId),
              eq(feedstocks.organizationId, ctx.organizationId)))
            .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId),
              eq(productionRunFeedstocks.productionRunId, productionRuns.id), eq(feedstocks.feedstockTypeId, batch.feedstockTypeId)))),
        )))),
      )));
  const contributors = await loadRunEmissionContributors(ctx, runs.map(run => run.id), reader, options);
  return Object.fromEntries(batches.map(batch => [batch.id, {
    materialMembers: contributors.filter(run => run.creditBatchId === batch.id && run.kind === "material"),
    failedContributors: contributors.filter(run => run.creditBatchId === batch.id && run.kind === "failed"),
  }]));
}
