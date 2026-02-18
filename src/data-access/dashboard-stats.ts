/**
 * Dashboard Stats data access
 * Database queries for dashboard statistics
 */
import { and, count, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, productionRuns, applications, creditBatches } from "@/db/schema";

/**
 * Stats for a single metric
 */
export interface MetricStat {
  current: number;
  previous: number;
}

/**
 * Dashboard statistics result
 */
export interface DashboardStats {
  totalDeliveries: MetricStat;
  activeProductionRuns: MetricStat;
  pendingApplications: MetricStat;
  issuedCredits: MetricStat;
}

/**
 * Calculate date ranges for current and previous periods
 * Default period is last 30 days
 */
function getDateRanges(periodDays: number = 30) {
  const now = new Date();
  const currentPeriodStart = new Date(now);
  currentPeriodStart.setDate(currentPeriodStart.getDate() - periodDays);

  const previousPeriodStart = new Date(currentPeriodStart);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - periodDays);

  return {
    currentStart: currentPeriodStart,
    currentEnd: now,
    previousStart: previousPeriodStart,
    previousEnd: currentPeriodStart,
  };
}

/**
 * Get total deliveries count for current and previous periods
 */
async function getDeliveriesStats(
  facilityId?: string,
  periodDays: number = 30
): Promise<MetricStat> {
  const { currentStart, previousStart, previousEnd } = getDateRanges(periodDays);

  const baseWhere = facilityId ? eq(deliveries.facilityId, facilityId) : undefined;

  // Current period count
  const [currentResult] = await db
    .select({ count: count() })
    .from(deliveries)
    .where(
      baseWhere
        ? and(baseWhere, gte(deliveries.createdAt, currentStart))
        : gte(deliveries.createdAt, currentStart)
    );

  // Previous period count
  const [previousResult] = await db
    .select({ count: count() })
    .from(deliveries)
    .where(
      baseWhere
        ? and(
            baseWhere,
            gte(deliveries.createdAt, previousStart),
            lt(deliveries.createdAt, previousEnd)
          )
        : and(
            gte(deliveries.createdAt, previousStart),
            lt(deliveries.createdAt, previousEnd)
          )
    );

  return {
    current: currentResult?.count ?? 0,
    previous: previousResult?.count ?? 0,
  };
}

/**
 * Get active production runs (status = 'running')
 */
async function getActiveProductionRunsStats(
  facilityId?: string,
  periodDays: number = 30
): Promise<MetricStat> {
  const { previousStart, previousEnd } = getDateRanges(periodDays);

  const baseWhere = facilityId ? eq(productionRuns.facilityId, facilityId) : undefined;

  // Current active count (currently running)
  const [currentResult] = await db
    .select({ count: count() })
    .from(productionRuns)
    .where(
      baseWhere
        ? and(baseWhere, eq(productionRuns.status, "running"))
        : eq(productionRuns.status, "running")
    );

  // Previous period - count runs that were running during that period
  const [previousResult] = await db
    .select({ count: count() })
    .from(productionRuns)
    .where(
      baseWhere
        ? and(
            baseWhere,
            eq(productionRuns.status, "running"),
            gte(productionRuns.createdAt, previousStart),
            lt(productionRuns.createdAt, previousEnd)
          )
        : and(
            eq(productionRuns.status, "running"),
            gte(productionRuns.createdAt, previousStart),
            lt(productionRuns.createdAt, previousEnd)
          )
    );

  return {
    current: currentResult?.count ?? 0,
    previous: previousResult?.count ?? 0,
  };
}

/**
 * Get pending applications (status = 'delivered' - waiting to be applied)
 */
async function getPendingApplicationsStats(
  facilityId?: string,
  periodDays: number = 30
): Promise<MetricStat> {
  const { previousStart, previousEnd } = getDateRanges(periodDays);

  // Build facility filter via deliveries join
  const facilityWhere = facilityId
    ? eq(deliveries.facilityId, facilityId)
    : undefined;

  // Current pending count (delivered but not yet applied)
  const currentQuery = db
    .select({ count: count() })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id));

  const [currentResult] = await (facilityWhere
    ? currentQuery.where(and(eq(applications.status, "delivered"), facilityWhere))
    : currentQuery.where(eq(applications.status, "delivered")));

  // Previous period pending
  const previousQuery = db
    .select({ count: count() })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id));

  const [previousResult] = await (facilityWhere
    ? previousQuery.where(
        and(
          eq(applications.status, "delivered"),
          facilityWhere,
          gte(applications.createdAt, previousStart),
          lt(applications.createdAt, previousEnd)
        )
      )
    : previousQuery.where(
        and(
          eq(applications.status, "delivered"),
          gte(applications.createdAt, previousStart),
          lt(applications.createdAt, previousEnd)
        )
      ));

  return {
    current: currentResult?.count ?? 0,
    previous: previousResult?.count ?? 0,
  };
}

/**
 * Get issued credits count (status = 'issued')
 */
async function getIssuedCreditsStats(
  facilityId?: string,
  periodDays: number = 30
): Promise<MetricStat> {
  const { previousStart, previousEnd } = getDateRanges(periodDays);

  const baseWhere = facilityId ? eq(creditBatches.facilityId, facilityId) : undefined;

  // Current issued count
  const [currentResult] = await db
    .select({ count: count() })
    .from(creditBatches)
    .where(
      baseWhere
        ? and(baseWhere, eq(creditBatches.status, "issued"))
        : eq(creditBatches.status, "issued")
    );

  // Previous period issued count
  const [previousResult] = await db
    .select({ count: count() })
    .from(creditBatches)
    .where(
      baseWhere
        ? and(
            baseWhere,
            eq(creditBatches.status, "issued"),
            gte(creditBatches.createdAt, previousStart),
            lt(creditBatches.createdAt, previousEnd)
          )
        : and(
            eq(creditBatches.status, "issued"),
            gte(creditBatches.createdAt, previousStart),
            lt(creditBatches.createdAt, previousEnd)
          )
    );

  return {
    current: currentResult?.count ?? 0,
    previous: previousResult?.count ?? 0,
  };
}

/**
 * Get all dashboard statistics
 */
export async function getDashboardStats(
  facilityId?: string,
  periodDays: number = 30
): Promise<DashboardStats> {
  const [totalDeliveries, activeProductionRuns, pendingApplications, issuedCredits] =
    await Promise.all([
      getDeliveriesStats(facilityId, periodDays),
      getActiveProductionRunsStats(facilityId, periodDays),
      getPendingApplicationsStats(facilityId, periodDays),
      getIssuedCreditsStats(facilityId, periodDays),
    ]);

  return {
    totalDeliveries,
    activeProductionRuns,
    pendingApplications,
    issuedCredits,
  };
}
