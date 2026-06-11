/**
 * Dashboard Stats data access
 * Database queries for dashboard statistics
 */
import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
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

  // Always exclude archived rows (facility archive cascade)
  const baseWhere = facilityId
    ? and(isNull(deliveries.archivedAt), eq(deliveries.facilityId, facilityId))
    : isNull(deliveries.archivedAt);

  const [[currentResult], [previousResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(deliveries)
      .where(and(baseWhere, gte(deliveries.createdAt, currentStart))),
    db
      .select({ count: count() })
      .from(deliveries)
      .where(
        and(
          baseWhere,
          gte(deliveries.createdAt, previousStart),
          lt(deliveries.createdAt, previousEnd)
        )
      ),
  ]);

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

  // Always exclude archived rows (facility archive cascade)
  const baseWhere = facilityId
    ? and(isNull(productionRuns.archivedAt), eq(productionRuns.facilityId, facilityId))
    : isNull(productionRuns.archivedAt);

  const [[currentResult], [previousResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(productionRuns)
      .where(and(baseWhere, eq(productionRuns.status, "running"))),
    db
      .select({ count: count() })
      .from(productionRuns)
      .where(
        and(
          baseWhere,
          eq(productionRuns.status, "running"),
          gte(productionRuns.createdAt, previousStart),
          lt(productionRuns.createdAt, previousEnd)
        )
      ),
  ]);

  return {
    current: currentResult?.count ?? 0,
    previous: previousResult?.count ?? 0,
  };
}

/**
 * Get pending applications (status = 'applied' - biochar applied but not yet verified)
 */
async function getPendingApplicationsStats(
  facilityId?: string,
  periodDays: number = 30
): Promise<MetricStat> {
  const { previousStart, previousEnd } = getDateRanges(periodDays);

  // Facility filter via deliveries join; applications carry no archived_at —
  // archived ones are hidden through their archived delivery
  const facilityWhere = facilityId
    ? and(isNull(deliveries.archivedAt), eq(deliveries.facilityId, facilityId))
    : isNull(deliveries.archivedAt);

  const [[currentResult], [previousResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(and(eq(applications.status, "applied"), facilityWhere)),
    db
      .select({ count: count() })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(
        and(
          eq(applications.status, "applied"),
          facilityWhere,
          gte(applications.createdAt, previousStart),
          lt(applications.createdAt, previousEnd)
        )
      ),
  ]);

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
  const { currentStart, previousStart, previousEnd } = getDateRanges(periodDays);

  // Always exclude archived rows (facility archive cascade)
  const baseWhere = facilityId
    ? and(isNull(creditBatches.archivedAt), eq(creditBatches.facilityId, facilityId))
    : isNull(creditBatches.archivedAt);

  const [[currentResult], [previousResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(creditBatches)
      .where(and(baseWhere, eq(creditBatches.status, "issued"), gte(creditBatches.createdAt, currentStart))),
    db
      .select({ count: count() })
      .from(creditBatches)
      .where(
        and(
          baseWhere,
          eq(creditBatches.status, "issued"),
          gte(creditBatches.createdAt, previousStart),
          lt(creditBatches.createdAt, previousEnd)
        )
      ),
  ]);

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
