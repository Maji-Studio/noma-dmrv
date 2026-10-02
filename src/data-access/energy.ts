/**
 * The energy read (ADR 0031): everything the attribution in
 * `@/lib/energy/attribution` needs for one facility, in one pass.
 *
 * It loads the facility's whole history rather than the requested period. A
 * delivery inside the period carries biochar made by runs before it, and a
 * credit batch reaches back to its first run; the attribution filters its
 * output to the period. Every query filters on the active organization as
 * well as the facility, so a foreign facility id reads as an empty facility.
 *
 * Runs exclude cancelled and archived ones, like the old facility energy
 * totals did. Days are facility-local `YYYY-MM-DD`: run starts and deliveries
 * are instants read in the facility zone, while application dates and
 * feedstock receipt dates are calendar days stored as UTC midnight, so their
 * UTC day is the day the operator chose.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationOutputAllocations,
  applications,
  creditBatches,
  creditBatchProductionRuns,
  customerLocations,
  customers,
  deliveries,
  facilities,
  feedstocks,
  orders,
  outputStockAllocations,
  outputStockRunAllocations,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  transportLegs,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DEFAULT_FACILITY_TIMEZONE, formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import type {
  EnergyFeedstockInput,
  EnergyInputs,
  EnergyRunShareInput,
} from "@/lib/energy/types";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { getDeliveryColumnAvailability } from "./deliveries";
import { effectiveDeliveryDistanceKm } from "./delivery-distance-projections";
import { requireOrgScope } from "./utils";

const FEEDSTOCK_LEG_ENTITY_TYPE = "feedstock";

export interface EnergyFacilityInputs {
  /** IANA zone the days were computed in. */
  timeZone: string;
  inputs: EnergyInputs;
}

const EMPTY_INPUTS: EnergyInputs = {
  runs: [],
  feedstocks: [],
  feedstockDraws: [],
  deliveries: [],
  deliveryRunShares: [],
  applications: [],
  applicationRunShares: [],
  creditBatches: [],
};

function toShares(
  rows: { ownerId: string | null; runId: string; dryMassKg: number }[],
): EnergyRunShareInput[] {
  return rows
    .filter((row): row is EnergyRunShareInput => row.ownerId != null && row.dryMassKg > 0)
    .map((row) => ({ ownerId: row.ownerId, runId: row.runId, dryMassKg: row.dryMassKg }));
}

export async function getEnergyInputs(
  ctx: OrgContext,
  facilityId: string,
): Promise<EnergyFacilityInputs> {
  requireOrgScope(ctx);
  const orgId = ctx.organizationId;

  const [facility] = await db
    .select({ timezone: facilities.timezone })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, orgId)));
  if (!facility) {
    return { timeZone: DEFAULT_FACILITY_TIMEZONE, inputs: EMPTY_INPUTS };
  }
  const timeZone = facility.timezone || DEFAULT_FACILITY_TIMEZONE;
  const dayOf = (instant: Date) => formatFacilityDate(instant, timeZone);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const facilityRuns = and(
    eq(productionRuns.facilityId, facilityId),
    eq(productionRuns.organizationId, orgId),
    isNull(productionRuns.archivedAt),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  );
  const facilityDeliveries = and(
    eq(deliveries.facilityId, facilityId),
    eq(deliveries.organizationId, orgId),
    isNull(deliveries.archivedAt),
  );

  const [
    runRows,
    batchRows,
    feedstockRows,
    legRows,
    drawRows,
    deliveryRows,
    deliveryShareRows,
    applicationRows,
    applicationShareRows,
  ] = await Promise.all([
    db
      .select({
        id: productionRuns.id,
        code: productionRuns.code,
        startTime: productionRuns.startTime,
        reactorName: reactors.identifier,
        creditBatchId: creditBatchProductionRuns.creditBatchId,
        dieselOperationLiters: productionRuns.dieselOperationLiters,
        dieselGensetLiters: productionRuns.dieselGensetLiters,
        preprocessingFuelLiters: productionRuns.preprocessingFuelLiters,
        electricityKwh: productionRuns.electricityKwh,
        lowCarbonPercentage: productionRuns.lowCarbonPercentage,
        biocharDryMassKg: productionRuns.biocharDryMassKg,
      })
      .from(productionRuns)
      .leftJoin(
        reactors,
        and(eq(reactors.id, productionRuns.reactorId), eq(reactors.organizationId, orgId)),
      )
      .leftJoin(
        creditBatchProductionRuns,
        and(
          eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
          eq(creditBatchProductionRuns.organizationId, orgId),
        ),
      )
      .where(facilityRuns),
    db
      .select({
        id: creditBatches.id,
        code: creditBatches.code,
        startDate: creditBatches.startDate,
        endDate: creditBatches.endDate,
        status: creditBatches.status,
      })
      .from(creditBatches)
      .where(
        and(
          eq(creditBatches.facilityId, facilityId),
          eq(creditBatches.organizationId, orgId),
          isNull(creditBatches.archivedAt),
        ),
      ),
    db
      .select({
        id: feedstocks.id,
        code: feedstocks.code,
        deliveryDate: feedstocks.deliveryDate,
        createdAt: feedstocks.createdAt,
        wetMassKg: feedstocks.massWetKg,
      })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.facilityId, facilityId),
          eq(feedstocks.organizationId, orgId),
          isNull(feedstocks.archivedAt),
        ),
      ),
    db
      .select({
        feedstockId: transportLegs.entityId,
        distanceKm: transportLegs.distanceKm,
        loadMassKg: transportLegs.loadMassKg,
      })
      .from(transportLegs)
      .innerJoin(
        feedstocks,
        and(
          eq(feedstocks.id, transportLegs.entityId),
          eq(feedstocks.organizationId, orgId),
          eq(feedstocks.facilityId, facilityId),
        ),
      )
      .where(
        and(
          eq(transportLegs.organizationId, orgId),
          eq(transportLegs.entityType, FEEDSTOCK_LEG_ENTITY_TYPE),
        ),
      ),
    db
      .select({
        runId: productionRunFeedstocks.productionRunId,
        feedstockId: productionRunFeedstocks.feedstockId,
        wetMassKg: productionRunFeedstocks.wetMassUsedKg,
      })
      .from(productionRunFeedstocks)
      .innerJoin(
        productionRuns,
        and(eq(productionRuns.id, productionRunFeedstocks.productionRunId), facilityRuns),
      )
      .where(eq(productionRunFeedstocks.organizationId, orgId)),
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        deliveryDate: deliveries.deliveryDate,
        customerName: customers.name,
        effectiveDistanceKm: effectiveDeliveryDistanceKm(deliveryColumns),
        deliveredWetMassKg: deliveries.deliveredWetMassKg,
        massDryKg: deliveries.massDryKg,
      })
      .from(deliveries)
      .leftJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, orgId)))
      .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, orgId)))
      .leftJoin(
        customerLocations,
        and(
          eq(
            customerLocations.id,
            sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
          ),
          eq(customerLocations.organizationId, orgId),
        ),
      )
      .where(facilityDeliveries),
    // Net dry mass per delivery and source run. Reversal rows are negative,
    // so the sum is what the truck actually carried from each run.
    db
      .select({
        ownerId: outputStockAllocations.deliveryId,
        runId: outputStockRunAllocations.productionRunId,
        dryMassKg: sql<number>`sum(${outputStockRunAllocations.dryMassKg})`.mapWith(Number),
      })
      .from(outputStockRunAllocations)
      .innerJoin(
        outputStockAllocations,
        and(
          eq(outputStockAllocations.id, outputStockRunAllocations.allocationId),
          eq(outputStockAllocations.organizationId, orgId),
        ),
      )
      .innerJoin(
        deliveries,
        and(eq(deliveries.id, outputStockAllocations.deliveryId), facilityDeliveries),
      )
      .where(eq(outputStockRunAllocations.organizationId, orgId))
      .groupBy(outputStockAllocations.deliveryId, outputStockRunAllocations.productionRunId),
    db
      .select({
        id: applications.id,
        code: applications.code,
        applicationDate: applications.applicationDate,
        deliveryId: applications.deliveryId,
        dryTons: applications.biocharAppliedDryTons,
        fieldName: applications.fieldIdentifier,
      })
      .from(applications)
      .innerJoin(deliveries, and(eq(deliveries.id, applications.deliveryId), facilityDeliveries))
      .where(eq(applications.organizationId, orgId)),
    db
      .select({
        ownerId: applicationOutputAllocations.applicationId,
        runId: applicationOutputAllocations.productionRunId,
        dryMassKg: sql<number>`sum(${applicationOutputAllocations.dryMassKg})`.mapWith(Number),
      })
      .from(applicationOutputAllocations)
      .innerJoin(
        deliveries,
        and(eq(deliveries.id, applicationOutputAllocations.deliveryId), facilityDeliveries),
      )
      .where(eq(applicationOutputAllocations.organizationId, orgId))
      .groupBy(applicationOutputAllocations.applicationId, applicationOutputAllocations.productionRunId),
  ]);

  const legsByFeedstock = new Map<string, EnergyFeedstockInput["legs"]>();
  for (const leg of legRows) {
    const legs = legsByFeedstock.get(leg.feedstockId) ?? [];
    legs.push({ distanceKm: leg.distanceKm, loadMassKg: leg.loadMassKg });
    legsByFeedstock.set(leg.feedstockId, legs);
  }

  return {
    timeZone,
    inputs: {
      runs: runRows.map((run) => ({
        id: run.id,
        code: run.code,
        day: dayOf(run.startTime),
        reactorName: run.reactorName,
        creditBatchId: run.creditBatchId,
        dieselOperationLiters: run.dieselOperationLiters,
        dieselGensetLiters: run.dieselGensetLiters,
        preprocessingFuelLiters: run.preprocessingFuelLiters,
        electricityKwh: run.electricityKwh,
        lowCarbonPercentage: run.lowCarbonPercentage,
        biocharDryMassKg: run.biocharDryMassKg,
      })),
      feedstocks: feedstockRows.map((feedstock) => ({
        id: feedstock.id,
        code: feedstock.code,
        day: feedstock.deliveryDate ? formatUtcDate(feedstock.deliveryDate) : dayOf(feedstock.createdAt),
        wetMassKg: feedstock.wetMassKg,
        legs: legsByFeedstock.get(feedstock.id) ?? [],
      })),
      feedstockDraws: drawRows,
      deliveries: deliveryRows.map((delivery) => ({
        id: delivery.id,
        code: delivery.code,
        day: dayOf(delivery.deliveryDate),
        customerName: delivery.customerName,
        effectiveDistanceKm: delivery.effectiveDistanceKm,
        deliveredWetMassKg: delivery.deliveredWetMassKg,
        massDryKg: delivery.massDryKg,
      })),
      deliveryRunShares: toShares(deliveryShareRows),
      applications: applicationRows.map((application) => ({
        id: application.id,
        code: application.code,
        day: formatUtcDate(application.applicationDate),
        deliveryId: application.deliveryId,
        dryMassKg: application.dryTons == null ? null : application.dryTons * KG_PER_TONNE,
        fieldName: application.fieldName,
      })),
      applicationRunShares: toShares(applicationShareRows),
      creditBatches: batchRows,
    },
  };
}

