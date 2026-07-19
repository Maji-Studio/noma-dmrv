/**
 * Application options for searchable entity selection.
 */

import { ilike, or, eq, and, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { applications, deliveries, facilities } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate } from "@/lib/format-utils";
import { requireOrgScope } from "../utils";

interface ApplicationOptionRow {
  id: string;
  code: string;
  applicationDate: Date | null;
  status: string;
  fieldIdentifier: string | null;
  deliveryCode: string | null;
  facilityName: string | null;
}

/** Map a selected application row to its entity-select option shape. Shared by
 * the list and by-id queries so both format the subtitle identically. */
function toApplicationOption(result: ApplicationOptionRow): EntityOption {
  return {
    id: result.id,
    code: result.code,
    name: result.code,
    subtitle: [
      result.facilityName,
      result.deliveryCode ? `Delivery ${result.deliveryCode}` : undefined,
      result.fieldIdentifier ?? undefined,
      result.applicationDate ? formatDate(result.applicationDate) : undefined,
      result.status,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export async function getApplicationsEntity(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, facilityId, limit } = params;

  // Applications carry no archived_at — hide them via their archived delivery
  const conditions: SQL[] = [isNull(deliveries.archivedAt)];

  if (facilityId) {
    conditions.push(eq(deliveries.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(applications.code, searchPattern),
        ilike(applications.fieldIdentifier, searchPattern),
        ilike(deliveries.code, searchPattern),
        ilike(facilities.name, searchPattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: applications.id,
      code: applications.code,
      applicationDate: applications.applicationDate,
      status: applications.status,
      fieldIdentifier: applications.fieldIdentifier,
      deliveryCode: deliveries.code,
      facilityName: facilities.name,
    })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      facilities,
      and(
        eq(deliveries.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(applications.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map(toApplicationOption);
}

export async function getApplicationEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: applications.id,
      code: applications.code,
      applicationDate: applications.applicationDate,
      status: applications.status,
      fieldIdentifier: applications.fieldIdentifier,
      deliveryCode: deliveries.code,
      facilityName: facilities.name,
    })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      facilities,
      and(
        eq(deliveries.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return toApplicationOption(result);
}
