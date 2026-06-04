/**
 * Application options for searchable entity selection.
 */

import { ilike, or, eq, and, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { applications, deliveries, facilities } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

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
      result.applicationDate
        ? new Date(result.applicationDate).toLocaleDateString()
        : undefined,
      result.status,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export async function getApplicationsEntity(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [];

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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .innerJoin(facilities, eq(deliveries.facilityId, facilities.id))
    .where(whereClause)
    .limit(limit);

  return results.map(toApplicationOption);
}

export async function getApplicationEntityById(id: string): Promise<EntityOption | null> {
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
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .innerJoin(facilities, eq(deliveries.facilityId, facilities.id))
    .where(eq(applications.id, id))
    .limit(1);

  if (!result) return null;

  return toApplicationOption(result);
}
