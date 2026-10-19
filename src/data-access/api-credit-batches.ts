import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import type { CreditBatchSampling, CreditBatchStatus } from "@/schemas/credit-batches";
import { requireOrgScope, type Executor } from "./utils";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, requireApiLookupFacility, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiCreditBatchFilters { q?: string; facilityId?: string; code?: string; status?: CreditBatchStatus; sampling?: CreditBatchSampling }

/** The narrow lookup projection: never the rich batch result with its rollups. */
function batchQuery(ctx: OrgContext, executor: Executor) {
  requireOrgScope(ctx);
  return executor.select({
    id: creditBatches.id,
    code: creditBatches.code,
    version: creditBatches.version,
    facilityId: creditBatches.facilityId,
    feedstockTypeId: creditBatches.feedstockTypeId,
    status: creditBatches.status,
    sampling: creditBatches.sampling,
    startDate: creditBatches.startDate,
    endDate: creditBatches.endDate,
    archivedAt: creditBatches.archivedAt,
    createdAt: creditBatches.createdAt,
    updatedAt: creditBatches.updatedAt,
    cursorCreatedAt: lookupCursorCreatedAt(creditBatches.createdAt),
  }).from(creditBatches);
}

/** Archived batches stay readable by id or code, as other lookups do; lists hide them. */
export async function findApiCreditBatch(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await batchQuery(ctx, executor).where(and(
    eq(creditBatches.organizationId, ctx.organizationId),
    "id" in identifier ? eq(creditBatches.id, identifier.id) : eq(creditBatches.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Credit batch was not found.", {
    issues: [{ path: ["creditBatchId"], code: "not_found", message: "Credit batch was not found." }],
  });
  return row;
}

export async function listApiCreditBatches(ctx: OrgContext, filters: ApiCreditBatchFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  return batchQuery(ctx, db).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), isNull(creditBatches.archivedAt),
    filters.facilityId ? eq(creditBatches.facilityId, filters.facilityId) : undefined,
    filters.status ? eq(creditBatches.status, filters.status) : undefined,
    filters.sampling ? eq(creditBatches.sampling, filters.sampling) : undefined,
    filters.code !== undefined ? eq(creditBatches.code, filters.code) : undefined,
    lookupSearch({ name: creditBatches.code }, filters.q),
    lookupPosition(creditBatches, cursor),
  )).orderBy(desc(creditBatches.createdAt), desc(creditBatches.id)).limit(limit + 1);
}
