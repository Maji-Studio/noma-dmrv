import type { DbTransaction } from '@/db';
import { facilities } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { requireOrgScope } from './utils';

/** A UTC timestamp without time zone as its facility calendar day ("YYYY-MM-DD"), independent of the DB session zone. */
export function facilityTimestampDateExpr(timestamp: SQLWrapper, timezone: SQLWrapper) {
  return sql<string | null>`(${timestamp} at time zone 'UTC' at time zone ${timezone})::date::text`;
}

export async function getOutputStockFacilityTimezone(ctx: OrgContext, facilityId: string, reader: Pick<DbTransaction, 'select'>): Promise<string> {
  requireOrgScope(ctx);
  const [facility] = await reader.select({ timezone: facilities.timezone }).from(facilities).where(and(
    eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId),
  ));
  if (!facility) throw new SafeError('Facility not found');
  return facility.timezone;
}
