import { and, desc, eq, getTableColumns, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import type { ApplicationRepresentationInput } from "@/lib/representations/applications";
import { requireOrgScope, type Executor } from "./utils";
import { findApiDelivery } from "./api-deliveries";
import { findApiOrder } from "./api-orders";
import { findApiCreditBatch } from "./api-credit-batches";
import { inApplicationCreditBatchLineage } from "./credit-batch-lineage-filter";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, requireApiLookupFacility, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiApplicationFilters {
  q?: string; code?: string; facilityId?: string; deliveryId?: string; orderId?: string; creditBatchId?: string;
  evidenceMethod?: "location" | "boundary" | "visual"; appliedFrom?: string; appliedBefore?: string;
}

function applicationQuery(ctx: OrgContext, executor: Executor) {
  requireOrgScope(ctx);
  // Frozen shares and their owning version must come from one statement snapshot.
  return executor.select({ ...getTableColumns(applications), cursorCreatedAt: lookupCursorCreatedAt(applications.createdAt),
    allocations: sql<ApplicationRepresentationInput["allocations"]>`(
      select coalesce(json_agg(json_build_object(
        'biocharProductId', share.biochar_product_id, 'productionRunId', share.production_run_id,
        'wetMassKg', share.wet_mass_kg, 'dryMassKg', share.dry_mass_kg
      ) order by share.biochar_product_id, share.production_run_id), '[]'::json)
      from application_output_allocations share
      where share.organization_id = ${ctx.organizationId} and share.application_id = "applications"."id"
    )`,
  }).from(applications).innerJoin(deliveries, and(eq(deliveries.id, applications.deliveryId), eq(deliveries.organizationId, ctx.organizationId)));
}

/** Direct reads retain applications whose delivery is archived. */
export async function findApiApplication(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await applicationQuery(ctx, executor).where(and(eq(applications.organizationId, ctx.organizationId),
    "id" in identifier ? eq(applications.id, identifier.id) : eq(applications.code, identifier.code))).limit(1);
  if (!row) throw new DomainError("not_found", "Application was not found.", {
    issues: [{ path: ["applicationId"], code: "not_found", message: "Application was not found." }],
  });
  return row;
}

export async function listApiApplications(ctx: OrgContext, filters: ApiApplicationFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  if (filters.deliveryId) await findApiDelivery(ctx, { id: filters.deliveryId });
  if (filters.orderId) await findApiOrder(ctx, { id: filters.orderId });
  if (filters.creditBatchId) await findApiCreditBatch(ctx, { id: filters.creditBatchId });
  return applicationQuery(ctx, db).where(and(eq(applications.organizationId, ctx.organizationId), isNull(deliveries.archivedAt),
    filters.facilityId === undefined ? undefined : eq(deliveries.facilityId, filters.facilityId),
    filters.deliveryId === undefined ? undefined : eq(applications.deliveryId, filters.deliveryId),
    filters.orderId === undefined ? undefined : eq(deliveries.orderId, filters.orderId),
    filters.creditBatchId === undefined ? undefined : inApplicationCreditBatchLineage(ctx, filters.creditBatchId, applications.id),
    filters.evidenceMethod === undefined ? undefined : eq(applications.evidenceMethod, filters.evidenceMethod),
    filters.code === undefined ? undefined : eq(applications.code, filters.code),
    filters.appliedFrom === undefined ? undefined : gte(applications.applicationDate, new Date(`${filters.appliedFrom}T00:00:00.000Z`)),
    filters.appliedBefore === undefined ? undefined : lt(applications.applicationDate, new Date(`${filters.appliedBefore}T00:00:00.000Z`)),
    or(lookupSearch({ name: applications.code }, filters.q), lookupSearch({ name: applications.fieldIdentifier }, filters.q), lookupSearch({ name: applications.cropType }, filters.q)),
    lookupPosition(applications, cursor),
  )).orderBy(desc(applications.createdAt), desc(applications.id)).limit(limit + 1);
}
