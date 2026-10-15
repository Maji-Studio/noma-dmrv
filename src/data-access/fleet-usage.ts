/**
 * Which records still reference a vehicle, driver or operator.
 *
 * Every foreign key onto `vehicles`, `drivers` and `operators` in
 * `src/db/schema` is counted here, so a delete can refuse with a message that
 * says where the record is used. The foreign keys stay the race backstop.
 */

import { and, count, eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbTransaction } from "@/db";
import {
  deliveries,
  feedstocks,
  incidentReports,
  productionRuns,
  productionSamples,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { FleetUsage } from "@/lib/fleet/messages";
import { requireOrgScope } from "./utils";

interface UsageSource {
  table: PgTable;
  organizationId: AnyPgColumn;
  reference: AnyPgColumn;
  singular: string;
  plural: string;
}

const VEHICLE_USAGE: readonly UsageSource[] = [
  { table: feedstocks, organizationId: feedstocks.organizationId, reference: feedstocks.vehicleId, singular: "feedstock intake", plural: "feedstock intakes" },
  { table: deliveries, organizationId: deliveries.organizationId, reference: deliveries.vehicleId, singular: "delivery", plural: "deliveries" },
];

const DRIVER_USAGE: readonly UsageSource[] = [
  { table: deliveries, organizationId: deliveries.organizationId, reference: deliveries.driverId, singular: "delivery", plural: "deliveries" },
];

const OPERATOR_USAGE: readonly UsageSource[] = [
  { table: productionRuns, organizationId: productionRuns.organizationId, reference: productionRuns.operatorId, singular: "production run", plural: "production runs" },
  { table: incidentReports, organizationId: incidentReports.organizationId, reference: incidentReports.operatorId, singular: "production incident", plural: "production incidents" },
  { table: productionSamples, organizationId: productionSamples.organizationId, reference: productionSamples.sampledById, singular: "in-process measurement", plural: "in-process measurements" },
];

async function countUsage(
  ctx: OrgContext,
  tx: DbTransaction,
  sources: readonly UsageSource[],
  id: string,
): Promise<FleetUsage[]> {
  requireOrgScope(ctx);
  const usages: FleetUsage[] = [];
  for (const source of sources) {
    const [row] = await tx
      .select({ value: count() })
      .from(source.table)
      .where(and(eq(source.reference, id), eq(source.organizationId, ctx.organizationId)));
    usages.push({ singular: source.singular, plural: source.plural, count: Number(row?.value ?? 0) });
  }
  return usages;
}

export function countVehicleUsage(ctx: OrgContext, tx: DbTransaction, vehicleId: string) {
  return countUsage(ctx, tx, VEHICLE_USAGE, vehicleId);
}

export function countDriverUsage(ctx: OrgContext, tx: DbTransaction, driverId: string) {
  return countUsage(ctx, tx, DRIVER_USAGE, driverId);
}

export function countOperatorUsage(ctx: OrgContext, tx: DbTransaction, operatorId: string) {
  return countUsage(ctx, tx, OPERATOR_USAGE, operatorId);
}
