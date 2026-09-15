import type { EntityOption } from '@/components/forms/entity-select/types';
import { db } from '@/db';
import { customers, formulations, orders } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { requireOrgScope } from '../utils';

export function toOrderEntityOption(row: { id: string; code: string; customerName: string | null; formulationName?: string | null; quantityKg: number; totalDeliveredKg: number }): EntityOption {
  const remaining = Math.max(0, row.quantityKg - row.totalDeliveredKg);
  return { id: row.id, code: row.code, name: [row.customerName, row.formulationName].filter(Boolean).join(' · '), remainingMass: { wetKg: remaining, dryKg: null }, subtitle: `Requested wet mass remaining: ${remaining} kg` };
}
export async function getOrdersEntity(ctx: OrgContext, params: { search?: string; facilityId?: string; limit: number; id?: string }): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const rows = await db.select({ id: orders.id, code: orders.code, customerName: customers.name, formulationName: formulations.name, quantityKg: orders.quantityKg,
    totalDeliveredKg: sql<number>`coalesce((select sum(d.delivered_wet_mass_kg) from deliveries d where d.organization_id = ${ctx.organizationId} and d.order_id = ${orders.id} and d.archived_at is null), 0)`.mapWith(Number) })
    .from(orders).leftJoin(customers, and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, orders.customerId)))
    .leftJoin(formulations, and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, orders.formulationId)))
    .where(and(eq(orders.organizationId, ctx.organizationId), params.id ? eq(orders.id, params.id) : isNull(orders.archivedAt), params.facilityId ? eq(orders.facilityId, params.facilityId) : undefined,
      params.search ? or(ilike(orders.code, `%${params.search}%`), ilike(formulations.name, `%${params.search}%`)) : undefined)).orderBy(desc(orders.orderDate)).limit(params.limit);
  return rows.map(toOrderEntityOption);
}
export async function getOrderEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  return (await getOrdersEntity(ctx, { id, limit: 1 }))[0] ?? null;
}
