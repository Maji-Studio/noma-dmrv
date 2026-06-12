import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  certifierGhgStatements,
  certifierRemovals,
  certificationSubmissions,
  creditBatchApplications,
  creditBatches,
  deliveries,
  facilities,
  feedstocks,
  productionRuns,
  samples,
  transportLegs,
} from "@/db/schema";
import { requireAuth } from "./utils";
import {
  attentionPriority,
  buildCreditBatchAttention,
  buildEvidenceAttention,
  buildNowItems,
  buildProductionAttention,
  buildProgress,
  buildSubmissionAttention,
} from "./dashboard-overview-builders";

const DEFAULT_PERIOD_DAYS = 30;
const MAX_ATTENTION_ITEMS = 18;
const ROW_LIMIT = 8;
const ISOMETRIC = "isometric";

export type DashboardTone = "critical" | "blocked" | "ready" | "waiting" | "running";

export interface DashboardFacilityOption {
  id: string;
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface DashboardAttentionItem {
  id: string;
  tone: DashboardTone;
  label: string;
  title: string;
  detail: string;
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  href: string;
  entityCode: string | null;
  occurredAt: string | null;
}

export interface DashboardNowItem {
  id: string;
  label: string;
  title: string;
  detail: string;
  status: string;
  facilityCode: string;
  href: string;
}

export interface DashboardMetric {
  label: string;
  value: number;
  detail: string;
}

export interface DashboardProgressStage {
  key: string;
  label: string;
  total: number;
  needsAttention: number;
  detail: string;
  href: string;
}

export interface DashboardEvidenceHealth {
  missingFacilityGps: number;
  missingApplicationGps: number;
  missingFeedstockGps: number;
  productionRunsWithoutSamples: number;
  transportEndpointGaps: number;
  transportDistanceEvidenceGaps: number;
}

export interface DashboardMapFacility {
  id: string;
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  attentionCount: number;
  runningRunCount: number;
}

export interface DashboardMapCoverage {
  facilities: DashboardMapFacility[];
  facilityCount: number;
  plottedFacilityCount: number;
  missingFacilityGpsCount: number;
  transportLegCount: number;
  transportEndpointGapCount: number;
}

export interface DashboardOverview {
  generatedAt: string;
  periodDays: number;
  selectedFacilityId: string | null;
  facilities: DashboardFacilityOption[];
  metrics: DashboardMetric[];
  attentionItems: DashboardAttentionItem[];
  nowItems: DashboardNowItem[];
  progress: DashboardProgressStage[];
  evidence: DashboardEvidenceHealth;
  map: DashboardMapCoverage;
}

interface DashboardOverviewInput {
  facilityId?: string | null;
  periodDays?: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface TransportAggregate {
  facilityId: string;
  total: number;
  endpointGaps: number;
  distanceEvidenceGaps: number;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function scopedFacilityCondition(facilityIds: string[]) {
  return facilityIds.length === 1
    ? eq(facilities.id, facilityIds[0])
    : inArray(facilities.id, facilityIds);
}

function scopedColumnCondition(column: AnyColumn, facilityIds: string[]) {
  return facilityIds.length === 1
    ? eq(column, facilityIds[0])
    : inArray(column, facilityIds);
}

async function loadFacilities(
  facilityId: string | null,
): Promise<DashboardFacilityOption[]> {
  const baseWhere = isNull(facilities.archivedAt);
  const where = facilityId
    ? and(baseWhere, eq(facilities.id, facilityId))
    : baseWhere;

  return db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      lat: facilities.gpsLatitude,
      lng: facilities.gpsLongitude,
    })
    .from(facilities)
    .where(where)
    .orderBy(facilities.code);
}

async function loadAllFacilities(): Promise<DashboardFacilityOption[]> {
  return db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      lat: facilities.gpsLatitude,
      lng: facilities.gpsLongitude,
    })
    .from(facilities)
    .where(isNull(facilities.archivedAt))
    .orderBy(facilities.code);
}

async function loadStatusCounts(facilityIds: string[]) {
  const scopeProduction = scopedColumnCondition(productionRuns.facilityId, facilityIds);
  const scopeProducts = scopedColumnCondition(biocharProducts.facilityId, facilityIds);
  const scopeDeliveries = scopedColumnCondition(deliveries.facilityId, facilityIds);
  const scopeCreditBatches = scopedColumnCondition(creditBatches.facilityId, facilityIds);

  const [
    feedstockRows,
    productionRows,
    productRows,
    deliveryRows,
    applicationRows,
    creditBatchRows,
  ] = await Promise.all([
    db
      .select({ status: feedstocks.status, count: count() })
      .from(feedstocks)
      .where(
        and(
          scopedColumnCondition(feedstocks.facilityId, facilityIds),
          isNull(feedstocks.archivedAt),
        ),
      )
      .groupBy(feedstocks.status),
    db
      .select({ status: productionRuns.status, count: count() })
      .from(productionRuns)
      .where(and(scopeProduction, isNull(productionRuns.archivedAt)))
      .groupBy(productionRuns.status),
    db
      .select({ status: biocharProducts.status, count: count() })
      .from(biocharProducts)
      .where(and(scopeProducts, isNull(biocharProducts.archivedAt)))
      .groupBy(biocharProducts.status),
    db
      .select({ status: deliveries.status, count: count() })
      .from(deliveries)
      .where(and(scopeDeliveries, isNull(deliveries.archivedAt)))
      .groupBy(deliveries.status),
    db
      .select({ status: applications.status, count: count() })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(and(scopeDeliveries, isNull(deliveries.archivedAt)))
      .groupBy(applications.status),
    db
      .select({ status: creditBatches.status, count: count() })
      .from(creditBatches)
      .where(and(scopeCreditBatches, isNull(creditBatches.archivedAt)))
      .groupBy(creditBatches.status),
  ]);

  return {
    feedstocks: feedstockRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    productionRuns: productionRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    biocharProducts: productRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    deliveries: deliveryRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    applications: applicationRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    creditBatches: creditBatchRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
  };
}

async function loadRunningRuns(facilityIds: string[]) {
  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      date: productionRuns.date,
      startTime: productionRuns.startTime,
    })
    .from(productionRuns)
    .where(
      and(
        scopedColumnCondition(productionRuns.facilityId, facilityIds),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "running"),
      ),
    )
    .orderBy(desc(productionRuns.startTime))
    .limit(ROW_LIMIT);
}

async function loadRecentCompletedRuns(facilityIds: string[], sinceDate: string) {
  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      date: productionRuns.date,
    })
    .from(productionRuns)
    .where(
      and(
        scopedColumnCondition(productionRuns.facilityId, facilityIds),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "complete"),
        gte(productionRuns.date, sinceDate),
      ),
    )
    .orderBy(desc(productionRuns.date))
    .limit(ROW_LIMIT);
}

async function loadRunsWithoutSamples(facilityIds: string[]) {
  const sampleCounts = db
    .select({
      productionRunId: samples.productionRunId,
      sampleCount: sql<number>`count(*)::int`.as("sample_count"),
    })
    .from(samples)
    .groupBy(samples.productionRunId)
    .as("sample_counts");

  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      date: productionRuns.date,
      sampleCount: sampleCounts.sampleCount,
    })
    .from(productionRuns)
    .leftJoin(sampleCounts, eq(sampleCounts.productionRunId, productionRuns.id))
    .where(
      and(
        scopedColumnCondition(productionRuns.facilityId, facilityIds),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "complete"),
        sql`coalesce(${sampleCounts.sampleCount}, 0) = 0`,
      ),
    )
    .orderBy(desc(productionRuns.date))
    .limit(ROW_LIMIT);
}

async function loadCreditBatchRows(facilityIds: string[]) {
  const applicationCounts = db
    .select({
      creditBatchId: creditBatchApplications.creditBatchId,
      applicationCount: sql<number>`count(*)::int`.as("application_count"),
    })
    .from(creditBatchApplications)
    .groupBy(creditBatchApplications.creditBatchId)
    .as("application_counts");

  return db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      facilityId: creditBatches.facilityId,
      status: creditBatches.status,
      endDate: creditBatches.endDate,
      removalId: creditBatches.removalId,
      totalCo2eStoredTons: creditBatches.totalCo2eStoredTons,
      applicationCount: applicationCounts.applicationCount,
    })
    .from(creditBatches)
    .leftJoin(
      applicationCounts,
      eq(applicationCounts.creditBatchId, creditBatches.id),
    )
    .where(
      and(
        scopedColumnCondition(creditBatches.facilityId, facilityIds),
        isNull(creditBatches.archivedAt),
        or(
          eq(creditBatches.status, "draft"),
          eq(creditBatches.status, "pending"),
          eq(creditBatches.status, "rejected"),
          isNull(creditBatches.totalCo2eStoredTons),
          sql`coalesce(${applicationCounts.applicationCount}, 0) = 0`,
        ),
      ),
    )
    .orderBy(desc(creditBatches.endDate))
    .limit(ROW_LIMIT);
}

function latestSubmission(submissionType: string, localEntityType: string) {
  return db
    .selectDistinctOn([certificationSubmissions.localEntityId], {
      localEntityId: certificationSubmissions.localEntityId,
      externalId: certificationSubmissions.externalId,
      status: certificationSubmissions.status,
      version: certificationSubmissions.version,
      submittedAt: certificationSubmissions.submittedAt,
      lockedAt: certificationSubmissions.lockedAt,
    })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC),
        eq(certificationSubmissions.submissionType, submissionType),
        eq(certificationSubmissions.localEntityType, localEntityType),
      ),
    )
    .orderBy(
      certificationSubmissions.localEntityId,
      desc(certificationSubmissions.version),
    );
}

async function loadRemovalRows(facilityIds: string[]) {
  const latest = latestSubmission("removal", "removal").as("latest_submission");

  return db
    .select({
      id: certifierRemovals.id,
      facilityId: certifierRemovals.facilityId,
      startedOn: certifierRemovals.startedOn,
      completedOn: certifierRemovals.completedOn,
      status: latest.status,
      submittedAt: latest.submittedAt,
      lockedAt: latest.lockedAt,
      externalId: latest.externalId,
    })
    .from(certifierRemovals)
    .leftJoin(latest, eq(latest.localEntityId, certifierRemovals.id))
    .where(scopedColumnCondition(certifierRemovals.facilityId, facilityIds))
    .orderBy(desc(certifierRemovals.createdAt))
    .limit(ROW_LIMIT);
}

async function loadGhgStatementRows(facilityIds: string[]) {
  const latest = latestSubmission("ghg_statement", "ghgStatement").as(
    "latest_submission",
  );

  return db
    .select({
      id: certifierGhgStatements.id,
      facilityId: certifierGhgStatements.facilityId,
      reportingPeriodEndOn: certifierGhgStatements.reportingPeriodEndOn,
      status: latest.status,
      submittedAt: latest.submittedAt,
      lockedAt: latest.lockedAt,
      externalId: latest.externalId,
    })
    .from(certifierGhgStatements)
    .leftJoin(latest, eq(latest.localEntityId, certifierGhgStatements.id))
    .where(scopedColumnCondition(certifierGhgStatements.facilityId, facilityIds))
    .orderBy(desc(certifierGhgStatements.reportingPeriodEndOn))
    .limit(ROW_LIMIT);
}

async function loadMissingApplicationGps(facilityIds: string[]) {
  return db
    .select({
      id: applications.id,
      code: applications.code,
      facilityId: deliveries.facilityId,
      applicationDate: applications.applicationDate,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .where(
      and(
        scopedColumnCondition(deliveries.facilityId, facilityIds),
        isNull(deliveries.archivedAt),
        or(isNull(applications.gpsLatitude), isNull(applications.gpsLongitude)),
      ),
    )
    .orderBy(desc(applications.applicationDate))
    .limit(ROW_LIMIT);
}

async function loadGpsGapCounts(facilityIds: string[]) {
  const [
    [facilityGps],
    [feedstockGps],
    [applicationGps],
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(facilities)
      .where(
        and(
          scopedFacilityCondition(facilityIds),
          or(isNull(facilities.gpsLatitude), isNull(facilities.gpsLongitude)),
        ),
      ),
    db
      .select({ count: count() })
      .from(feedstocks)
      .where(
        and(
          scopedColumnCondition(feedstocks.facilityId, facilityIds),
          isNull(feedstocks.archivedAt),
          or(isNull(feedstocks.gpsLatitude), isNull(feedstocks.gpsLongitude)),
        ),
      ),
    db
      .select({ count: count() })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(
        and(
          scopedColumnCondition(deliveries.facilityId, facilityIds),
          isNull(deliveries.archivedAt),
          or(isNull(applications.gpsLatitude), isNull(applications.gpsLongitude)),
        ),
      ),
  ]);

  return {
    missingFacilityGps: Number(facilityGps?.count ?? 0),
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    missingApplicationGps: Number(applicationGps?.count ?? 0),
  };
}

function transportAggregateSelect(facilityIdColumn: AnyColumn) {
  return {
    facilityId: sql<string>`${facilityIdColumn}`.as("facility_id"),
    total: sql<number>`count(*)::int`,
    endpointGaps: sql<number>`
      sum(case when
        ${transportLegs.originGpsLatitude} is null
        or ${transportLegs.originGpsLongitude} is null
        or ${transportLegs.destinationGpsLatitude} is null
        or ${transportLegs.destinationGpsLongitude} is null
      then 1 else 0 end)::int
    `,
    distanceEvidenceGaps: sql<number>`
      sum(case when
        ${transportLegs.distanceSource} is null
        or ${transportLegs.distanceSource} <> 'document'
      then 1 else 0 end)::int
    `,
  };
}

async function loadTransportAggregates(
  facilityIds: string[],
): Promise<TransportAggregate[]> {
  const [feedstockRows, biocharRows, sampleRows] = await Promise.all([
    db
      .select(transportAggregateSelect(feedstocks.facilityId))
      .from(transportLegs)
      .innerJoin(
        feedstocks,
        and(
          eq(transportLegs.entityType, "feedstock"),
          eq(transportLegs.entityId, feedstocks.id),
        ),
      )
      .where(scopedColumnCondition(feedstocks.facilityId, facilityIds))
      .groupBy(feedstocks.facilityId),
    db
      .select(transportAggregateSelect(biocharProducts.facilityId))
      .from(transportLegs)
      .innerJoin(
        biocharProducts,
        and(
          eq(transportLegs.entityType, "biochar"),
          eq(transportLegs.entityId, biocharProducts.id),
        ),
      )
      .where(scopedColumnCondition(biocharProducts.facilityId, facilityIds))
      .groupBy(biocharProducts.facilityId),
    db
      .select(transportAggregateSelect(productionRuns.facilityId))
      .from(transportLegs)
      .innerJoin(
        samples,
        and(
          eq(transportLegs.entityType, "sample"),
          eq(transportLegs.entityId, samples.id),
        ),
      )
      .innerJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
      .where(scopedColumnCondition(productionRuns.facilityId, facilityIds))
      .groupBy(productionRuns.facilityId),
  ]);

  const byFacility = new Map<string, TransportAggregate>();
  for (const row of [...feedstockRows, ...biocharRows, ...sampleRows]) {
    const current = byFacility.get(row.facilityId) ?? {
      facilityId: row.facilityId,
      total: 0,
      endpointGaps: 0,
      distanceEvidenceGaps: 0,
    };
    current.total += Number(row.total ?? 0);
    current.endpointGaps += Number(row.endpointGaps ?? 0);
    current.distanceEvidenceGaps += Number(row.distanceEvidenceGaps ?? 0);
    byFacility.set(row.facilityId, current);
  }
  return Array.from(byFacility.values());
}

async function loadPeriodCounts(facilityIds: string[], sinceDate: string) {
  const [[completedRuns], [submittedRemovals]] = await Promise.all([
    db
      .select({ count: count() })
      .from(productionRuns)
      .where(
        and(
          scopedColumnCondition(productionRuns.facilityId, facilityIds),
          isNull(productionRuns.archivedAt),
          eq(productionRuns.status, "complete"),
          gte(productionRuns.date, sinceDate),
        ),
      ),
    db
      .select({ count: count() })
      .from(certifierRemovals)
      .innerJoin(
        certificationSubmissions,
        and(
          eq(certificationSubmissions.localEntityType, "removal"),
          eq(certificationSubmissions.localEntityId, certifierRemovals.id),
          eq(certificationSubmissions.status, "submitted"),
        ),
      )
      .where(scopedColumnCondition(certifierRemovals.facilityId, facilityIds)),
  ]);
  return {
    completedRuns: Number(completedRuns?.count ?? 0),
    submittedRemovals: Number(submittedRemovals?.count ?? 0),
  };
}

export async function getDashboardOverview(
  userId: string,
  input?: DashboardOverviewInput,
): Promise<DashboardOverview> {
  requireAuth(userId);

  const periodDays = input?.periodDays ?? DEFAULT_PERIOD_DAYS;
  const selectedFacilityId = input?.facilityId ?? null;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - periodDays);
  const sinceDate = toDateOnly(since);

  const [allFacilities, scopedFacilities] = await Promise.all([
    loadAllFacilities(),
    loadFacilities(selectedFacilityId),
  ]);
  const facilityIds = scopedFacilities.map((facility) => facility.id);
  const facilityById = new Map(scopedFacilities.map((facility) => [facility.id, facility]));

  if (facilityIds.length === 0) {
    return {
      generatedAt: now.toISOString(),
      periodDays,
      selectedFacilityId,
      facilities: allFacilities,
      metrics: [],
      attentionItems: [],
      nowItems: [],
      progress: [],
      evidence: {
        missingFacilityGps: 0,
        missingApplicationGps: 0,
        missingFeedstockGps: 0,
        productionRunsWithoutSamples: 0,
        transportEndpointGaps: 0,
        transportDistanceEvidenceGaps: 0,
      },
      map: {
        facilities: [],
        facilityCount: 0,
        plottedFacilityCount: 0,
        missingFacilityGpsCount: 0,
        transportLegCount: 0,
        transportEndpointGapCount: 0,
      },
    };
  }

  const [
    counts,
    runningRuns,
    recentCompletedRuns,
    runsWithoutSamples,
    creditBatchRows,
    removalRows,
    statementRows,
    missingApplications,
    gpsGaps,
    transportAggregates,
    periodCounts,
  ] = await Promise.all([
    loadStatusCounts(facilityIds),
    loadRunningRuns(facilityIds),
    loadRecentCompletedRuns(facilityIds, sinceDate),
    loadRunsWithoutSamples(facilityIds),
    loadCreditBatchRows(facilityIds),
    loadRemovalRows(facilityIds),
    loadGhgStatementRows(facilityIds),
    loadMissingApplicationGps(facilityIds),
    loadGpsGapCounts(facilityIds),
    loadTransportAggregates(facilityIds),
    loadPeriodCounts(facilityIds, sinceDate),
  ]);

  const attentionItems = [
    ...buildSubmissionAttention({ removalRows, statementRows, facilityById }),
    ...buildEvidenceAttention({
      missingApplications,
      runsWithoutSamples,
      transportAggregates,
      facilityById,
    }),
    ...buildCreditBatchAttention({ creditBatchRows, facilityById }),
    ...buildProductionAttention({ runningRuns, facilityById }),
  ]
    .sort((a, b) => attentionPriority(a.tone) - attentionPriority(b.tone))
    .slice(0, MAX_ATTENTION_ITEMS);

  const attentionCountByFacility = new Map<string, number>();
  for (const item of attentionItems) {
    attentionCountByFacility.set(
      item.facilityId,
      (attentionCountByFacility.get(item.facilityId) ?? 0) + 1,
    );
  }

  const runningCountByFacility = new Map<string, number>();
  for (const run of runningRuns) {
    runningCountByFacility.set(
      run.facilityId,
      (runningCountByFacility.get(run.facilityId) ?? 0) + 1,
    );
  }

  const transportTotals = transportAggregates.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      endpointGaps: acc.endpointGaps + row.endpointGaps,
      distanceEvidenceGaps:
        acc.distanceEvidenceGaps + row.distanceEvidenceGaps,
    }),
    { total: 0, endpointGaps: 0, distanceEvidenceGaps: 0 },
  );

  const evidence: DashboardEvidenceHealth = {
    missingFacilityGps: gpsGaps.missingFacilityGps,
    missingApplicationGps: gpsGaps.missingApplicationGps,
    missingFeedstockGps: gpsGaps.missingFeedstockGps,
    productionRunsWithoutSamples: runsWithoutSamples.length,
    transportEndpointGaps: transportTotals.endpointGaps,
    transportDistanceEvidenceGaps: transportTotals.distanceEvidenceGaps,
  };

  const failedSubmissionCount = [
    ...removalRows.filter((row) => row.status === "rejected"),
    ...statementRows.filter((row) => row.status === "rejected"),
  ].length;
  const waitingSubmissionCount = [
    ...removalRows.filter((row) => row.status === "submitted"),
    ...statementRows.filter((row) => row.status === "submitted"),
  ].length;

  return {
    generatedAt: now.toISOString(),
    periodDays,
    selectedFacilityId,
    facilities: allFacilities,
    metrics: [
      {
        label: "Running runs",
        value: runningRuns.length,
        detail: "Production runs active now",
      },
      {
        label: "Completed runs",
        value: periodCounts.completedRuns,
        detail: `Last ${periodDays} days`,
      },
      {
        label: "Evidence gaps",
        value:
          evidence.missingApplicationGps +
          evidence.productionRunsWithoutSamples +
          evidence.transportEndpointGaps,
        detail: "Map, sample, and route gaps",
      },
      {
        label: "Submissions",
        value: waitingSubmissionCount + failedSubmissionCount,
        detail: `${waitingSubmissionCount} waiting, ${failedSubmissionCount} failed`,
      },
    ],
    attentionItems,
    nowItems: buildNowItems({
      runningRuns,
      recentCompletedRuns,
      removalRows,
      statementRows,
      facilityById,
    }),
    progress: buildProgress({
      counts,
      creditBatchRows,
      removalRows,
      statementRows,
    }),
    evidence,
    map: {
      facilities: scopedFacilities.map((facility) => ({
        ...facility,
        attentionCount: attentionCountByFacility.get(facility.id) ?? 0,
        runningRunCount: runningCountByFacility.get(facility.id) ?? 0,
      })),
      facilityCount: scopedFacilities.length,
      plottedFacilityCount: scopedFacilities.filter(
        (facility) => facility.lat != null && facility.lng != null,
      ).length,
      missingFacilityGpsCount: evidence.missingFacilityGps,
      transportLegCount: transportTotals.total,
      transportEndpointGapCount: transportTotals.endpointGaps,
    },
  };
}
