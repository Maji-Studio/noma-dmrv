import { FAILED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { feedstockTypes, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { facilityListHref } from "@/lib/dashboard-links";
import { RECORD_LINKS, recordHref } from "@/lib/record-links";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";
import { loadRunEmissionContributors } from "./credit-batch-emission-contributors";
import { requireOrgScope } from "./utils";

/** Recomputed on every read; creating a matching batch clears the unresolved note. */
export async function loadFailedRunEmissionGuidance(
  ctx: OrgContext,
  scope: { facilityId: string } | { runIds: readonly string[] },
  reader: DbTransaction | typeof db = db,
): Promise<FailedRunEmissionGuidance[]> {
  requireOrgScope(ctx);
  if ("runIds" in scope && !scope.runIds.length) return [];
  const runs = await reader.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns)
    .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.status, FAILED_PRODUCTION_RUN_STATUS),
      isNull(productionRuns.archivedAt), "facilityId" in scope ? eq(productionRuns.facilityId, scope.facilityId)
        : inArray(productionRuns.id, [...scope.runIds]))).orderBy(productionRuns.id);
  const contributors = await loadRunEmissionContributors(ctx, runs.map(run => run.id), reader);
  const typeIds = [...new Set(contributors.flatMap(run => run.feedstockTypeId ? [run.feedstockTypeId] : []))];
  const types = typeIds.length ? await reader.select({ id: feedstockTypes.id, name: feedstockTypes.name }).from(feedstockTypes)
    .where(and(eq(feedstockTypes.organizationId, ctx.organizationId), inArray(feedstockTypes.id, typeIds))) : [];
  const codes = new Map(runs.map(run => [run.id, run.code]));
  const names = new Map(types.map(type => [type.id, type.name]));
  return contributors.map(run => {
    const runCode = codes.get(run.runId)!;
    const feedstockTypeName = run.feedstockTypeId ? names.get(run.feedstockTypeId) ?? null : null;
    const state = run.creditBatchId ? "attached" : run.unresolvedReason === "mixed-feedstock" ? "mixed-feedstock"
      : run.unresolvedReason === "empty-feedstock" ? "empty-feedstock" : "no-match";
    const batch = run.creditBatchId ? { id: run.creditBatchId, code: run.creditBatchCode! } : null;
    const href = batch ? recordHref("creditBatch", batch.id, { facilityId: run.facilityId })
      : state === "no-match" ? facilityListHref(RECORD_LINKS.creditBatch.path, run.facilityId)
        : recordHref("productionRun", run.runId, { facilityId: run.facilityId });
    return { productionRunId: run.runId, runCode, facilityId: run.facilityId, endDay: run.endDay,
      feedstockTypeId: run.feedstockTypeId, feedstockTypeName, state, batch, href };
  });
}

/** Facility-level checks remain available even when there is no credit batch. */
export async function loadFacilityFailedRunEmissionTodos(
  ctx: OrgContext, facilityId: string, reader: DbTransaction | typeof db = db,
) {
  requireOrgScope(ctx);
  const guidance = await loadFailedRunEmissionGuidance(ctx, { facilityId }, reader);
  return guidance.flatMap(item => item.state === "attached" ? [] : [{
    id: `failed-run-emissions:${item.productionRunId}`,
    productionRun: { id: item.productionRunId, code: item.runCode },
    target: { href: item.href },
    emissionAttachment: { ...item, state: item.state },
  }]);
}

export type FacilityFailedRunEmissionTodo = Awaited<ReturnType<typeof loadFacilityFailedRunEmissionTodos>>[number];
