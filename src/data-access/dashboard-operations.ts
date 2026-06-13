/**
 * Dashboard operations data access — the action-oriented half of the facility
 * dashboard (restored from the operator-dashboard design, re-scoped to a
 * single facility):
 *
 *   - **Now**      live signal: running production runs, in-flight registry /
 *                  verifier submissions, and runs completed in the last fortnight.
 *   - **Progress** the MRV pipeline funnel feedstock → … → GHG statements, each
 *                  stage carrying a needs-attention share derived from status.
 *   - **Evidence** structural gaps that block certification: GPS holes, runs
 *                  without lab samples, and transport-leg provenance gaps.
 *
 * Range-independent by design — this is "where does the facility stand right
 * now", not "what happened in the selected window" (that's the KPI strip).
 * Queries are narrow, indexed, and facility-scoped; aggregation that isn't a
 * cheap `count`/`sum` happens in JS.
 */
import {
  and,
  count,
  desc,
  eq,
  gte,
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
  creditBatches,
  deliveries,
  documents,
  facilities,
  feedstocks,
  productionRuns,
  samples,
  transportLegs,
} from "@/db/schema";
import { requireAuth } from "./utils";

const ISOMETRIC = "isometric";
/** Per-section row cap — the dashboard samples, it is not a list page. */
const ROW_LIMIT = 8;
/** Total rows shown in the "Now" panel. */
const MAX_NOW_ITEMS = 8;
/** A completed run stops being "now" after this many days. */
const NOW_COMPLETED_LOOKBACK_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVIDENCE_METHOD_VISUAL = "visual";
const EVIDENCE_METHOD_BOUNDARY = "boundary";
const ENTITY_TYPE_APPLICATION = "application";
const DOC_TYPE_PHOTO = "photo";
const DOC_TYPE_PDF = "pdf";
const UPLOAD_STATUS_UPLOADED = "uploaded";
const GEOTAG_STATUS_PRESENT = "present";

export type DashboardNowKind = "production" | "registry" | "verifier";
export type DashboardNowStatus = "running" | "complete" | "submitted" | "locked";

export interface DashboardNowItem {
  id: string;
  kind: DashboardNowKind;
  /** Entity code or short id, shown mono. */
  code: string;
  detail: string;
  status: DashboardNowStatus;
  href: string;
}

export interface DashboardProgressStage {
  key: string;
  label: string;
  /** Total records in the stage. */
  total: number;
  /** Records in a state that still needs operator follow-through. */
  needsAttention: number;
  href: string;
}

export interface DashboardEvidenceRow {
  key: string;
  label: string;
  /** Records failing the check; 0 = clear. */
  count: number;
  href: string;
}

export type DashboardMapKind = "facility" | "application" | "feedstock";

export interface DashboardMapPoint {
  id: string;
  kind: DashboardMapKind;
  /** Marker title (entity code / facility name). */
  label: string;
  /** Secondary line (status / kind context). */
  sublabel: string;
  lat: number;
  lng: number;
}

export interface DashboardOperations {
  /** Server time the snapshot was built (ISO). */
  generatedAt: string;
  now: DashboardNowItem[];
  progress: DashboardProgressStage[];
  evidence: DashboardEvidenceRow[];
  /** Plottable sites: the facility, its application fields, and feedstock sources. */
  mapPoints: DashboardMapPoint[];
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function facilityHref(path: string, facilityId: string): string {
  return `${path}?facility=${encodeURIComponent(facilityId)}`;
}

function removalHref(facilityId: string, removalId: string): string {
  return `/certification/removals?facility=${encodeURIComponent(
    facilityId,
  )}&removal=${encodeURIComponent(removalId)}`;
}

function statementHref(facilityId: string, statementId: string): string {
  return `/certification/ghg-statements?facility=${encodeURIComponent(
    facilityId,
  )}&statement=${encodeURIComponent(statementId)}`;
}

// ============================================
// Status pipeline
// ============================================

interface StatusCount {
  status: string;
  count: number;
}

function countByStatus(rows: StatusCount[], statuses: string[]): number {
  const wanted = new Set(statuses);
  return rows
    .filter((row) => wanted.has(row.status))
    .reduce((acc, row) => acc + row.count, 0);
}

async function loadStatusCounts(facilityId: string) {
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
      .where(and(eq(feedstocks.facilityId, facilityId), isNull(feedstocks.archivedAt)))
      .groupBy(feedstocks.status),
    db
      .select({ status: productionRuns.status, count: count() })
      .from(productionRuns)
      .where(
        and(eq(productionRuns.facilityId, facilityId), isNull(productionRuns.archivedAt)),
      )
      .groupBy(productionRuns.status),
    db
      .select({ status: biocharProducts.status, count: count() })
      .from(biocharProducts)
      .where(
        and(eq(biocharProducts.facilityId, facilityId), isNull(biocharProducts.archivedAt)),
      )
      .groupBy(biocharProducts.status),
    db
      .select({ status: deliveries.status, count: count() })
      .from(deliveries)
      .where(and(eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
      .groupBy(deliveries.status),
    db
      .select({ status: applications.status, count: count() })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(and(eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
      .groupBy(applications.status),
    db
      .select({ status: creditBatches.status, count: count() })
      .from(creditBatches)
      .where(
        and(eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)),
      )
      .groupBy(creditBatches.status),
  ]);

  const toCounts = (rows: { status: string; count: number }[]): StatusCount[] =>
    rows.map((row) => ({ status: row.status, count: Number(row.count) }));

  return {
    feedstocks: toCounts(feedstockRows),
    productionRuns: toCounts(productionRows),
    biocharProducts: toCounts(productRows),
    deliveries: toCounts(deliveryRows),
    applications: toCounts(applicationRows),
    creditBatches: toCounts(creditBatchRows),
  };
}

// ============================================
// Certification submission rows (Now + Progress)
// ============================================

interface SubmissionRow {
  id: string;
  status: string | null;
  submittedAt: Date | null;
  lockedAt: Date | null;
  externalId: string | null;
  /** Removal window end / statement reporting-period end (date-only). */
  periodEndOn: string | null;
}

/** Latest submission row per local entity (highest version wins). */
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

async function loadRemovalRows(facilityId: string): Promise<SubmissionRow[]> {
  const latest = latestSubmission("removal", "removal").as("latest_submission");
  const rows = await db
    .select({
      id: certifierRemovals.id,
      completedOn: certifierRemovals.completedOn,
      status: latest.status,
      submittedAt: latest.submittedAt,
      lockedAt: latest.lockedAt,
      externalId: latest.externalId,
    })
    .from(certifierRemovals)
    .leftJoin(latest, eq(latest.localEntityId, certifierRemovals.id))
    .where(eq(certifierRemovals.facilityId, facilityId))
    .orderBy(desc(certifierRemovals.createdAt))
    .limit(ROW_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    lockedAt: row.lockedAt,
    externalId: row.externalId,
    periodEndOn: row.completedOn,
  }));
}

async function loadStatementRows(facilityId: string): Promise<SubmissionRow[]> {
  const latest = latestSubmission("ghg_statement", "ghgStatement").as(
    "latest_submission",
  );
  const rows = await db
    .select({
      id: certifierGhgStatements.id,
      reportingPeriodEndOn: certifierGhgStatements.reportingPeriodEndOn,
      status: latest.status,
      submittedAt: latest.submittedAt,
      lockedAt: latest.lockedAt,
      externalId: latest.externalId,
    })
    .from(certifierGhgStatements)
    .leftJoin(latest, eq(latest.localEntityId, certifierGhgStatements.id))
    .where(eq(certifierGhgStatements.facilityId, facilityId))
    .orderBy(desc(certifierGhgStatements.reportingPeriodEndOn))
    .limit(ROW_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    lockedAt: row.lockedAt,
    externalId: row.externalId,
    periodEndOn: row.reportingPeriodEndOn,
  }));
}

// ============================================
// Now — live production
// ============================================

interface RunRow {
  id: string;
  code: string;
  date: string;
}

async function loadRunningRuns(facilityId: string): Promise<RunRow[]> {
  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.facilityId, facilityId),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "running"),
      ),
    )
    .orderBy(desc(productionRuns.startTime))
    .limit(ROW_LIMIT);
}

async function loadRecentCompletedRuns(
  facilityId: string,
  sinceDate: string,
): Promise<RunRow[]> {
  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.facilityId, facilityId),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "complete"),
        gte(productionRuns.date, sinceDate),
      ),
    )
    .orderBy(desc(productionRuns.date))
    .limit(ROW_LIMIT);
}

function isInFlight(row: SubmissionRow): boolean {
  return row.status === "submitted" || row.lockedAt != null;
}

function buildNow(args: {
  facilityId: string;
  runningRuns: RunRow[];
  recentCompletedRuns: RunRow[];
  removalRows: SubmissionRow[];
  statementRows: SubmissionRow[];
}): DashboardNowItem[] {
  const { facilityId } = args;
  const items: DashboardNowItem[] = [];

  for (const row of args.runningRuns) {
    items.push({
      id: `now-running-${row.id}`,
      kind: "production",
      code: row.code,
      detail: "Running now",
      status: "running",
      href: facilityHref(`/production-runs/${row.id}`, facilityId),
    });
  }

  for (const row of args.removalRows) {
    if (!isInFlight(row)) continue;
    items.push({
      id: `now-removal-${row.id}`,
      kind: "registry",
      code: row.externalId ?? row.id.slice(0, 8),
      detail: row.lockedAt ? "Submission in progress" : "Submitted to registry",
      status: row.lockedAt ? "locked" : "submitted",
      href: removalHref(facilityId, row.id),
    });
  }

  for (const row of args.statementRows) {
    if (!isInFlight(row)) continue;
    items.push({
      id: `now-statement-${row.id}`,
      kind: "verifier",
      code: row.externalId ?? row.id.slice(0, 8),
      detail: row.lockedAt ? "Submission in progress" : "Awaiting verifier",
      status: row.lockedAt ? "locked" : "submitted",
      href: statementHref(facilityId, row.id),
    });
  }

  for (const row of args.recentCompletedRuns) {
    items.push({
      id: `now-complete-${row.id}`,
      kind: "production",
      code: row.code,
      detail: `Completed ${row.date}`,
      status: "complete",
      href: facilityHref(`/production-runs/${row.id}`, facilityId),
    });
  }

  return items.slice(0, MAX_NOW_ITEMS);
}

// ============================================
// Progress — the MRV pipeline funnel
// ============================================

function buildProgress(args: {
  counts: Awaited<ReturnType<typeof loadStatusCounts>>;
  removalRows: SubmissionRow[];
  statementRows: SubmissionRow[];
}): DashboardProgressStage[] {
  const { counts } = args;
  const removalAttention = args.removalRows.filter(
    (row) => !row.status || row.status === "draft" || row.status === "rejected",
  ).length;
  const statementAttention = args.statementRows.filter(
    (row) => row.status === "submitted" || row.status === "rejected",
  ).length;

  return [
    {
      key: "feedstock",
      label: "Feedstock",
      total: countByStatus(counts.feedstocks, ["missing_data", "complete"]),
      needsAttention: countByStatus(counts.feedstocks, ["missing_data"]),
      href: "/feedstocks",
    },
    {
      key: "production",
      label: "Production",
      total: countByStatus(counts.productionRuns, [
        "draft",
        "running",
        "complete",
        "void",
      ]),
      needsAttention: countByStatus(counts.productionRuns, ["draft", "running"]),
      href: "/production-runs",
    },
    {
      key: "products",
      label: "Products",
      total: countByStatus(counts.biocharProducts, [
        "draft",
        "testing",
        "ready",
        "sold",
      ]),
      needsAttention: countByStatus(counts.biocharProducts, ["draft", "testing"]),
      href: "/biochar-products",
    },
    {
      key: "deliveries",
      label: "Deliveries",
      total: countByStatus(counts.deliveries, ["upcoming", "delivered"]),
      needsAttention: countByStatus(counts.deliveries, ["upcoming"]),
      href: "/deliveries",
    },
    {
      key: "applications",
      label: "Applications",
      total: countByStatus(counts.applications, ["delivered", "applied"]),
      needsAttention: countByStatus(counts.applications, ["delivered"]),
      href: "/applications",
    },
    {
      key: "creditBatches",
      label: "Credit batches",
      total: countByStatus(counts.creditBatches, [
        "draft",
        "pending",
        "verified",
        "issued",
        "rejected",
      ]),
      needsAttention: countByStatus(counts.creditBatches, [
        "draft",
        "pending",
        "rejected",
      ]),
      href: "/credit-batches",
    },
    {
      key: "removals",
      label: "Removals",
      total: args.removalRows.length,
      needsAttention: removalAttention,
      href: "/certification/removals",
    },
    {
      key: "statements",
      label: "GHG statements",
      total: args.statementRows.length,
      needsAttention: statementAttention,
      href: "/certification/ghg-statements",
    },
  ];
}

// ============================================
// Evidence — structural certification gaps
// ============================================

async function loadGpsGapCounts(facilityId: string) {
  const applicationEvidenceGap = or(
    and(
      eq(applications.evidenceMethod, EVIDENCE_METHOD_VISUAL),
      or(
        isNull(applications.gpsLatitude),
        isNull(applications.gpsLongitude),
        sql`not exists (
          select 1
          from ${documents}
          where ${documents.entityType} = ${ENTITY_TYPE_APPLICATION}
            and ${documents.entityId} = ${applications.id}
            and ${documents.documentType} = ${DOC_TYPE_PHOTO}
            and (${documents.uploadStatus} = ${UPLOAD_STATUS_UPLOADED} or ${documents.fileUrl} is not null)
            and ${documents.metadata}->>'geotagStatus' = ${GEOTAG_STATUS_PRESENT}
        )`,
      )!,
    )!,
    and(
      eq(applications.evidenceMethod, EVIDENCE_METHOD_BOUNDARY),
      or(
        isNull(applications.gisBoundaryReference),
        sql`trim(${applications.gisBoundaryReference}::text) = ''`,
        sql`not exists (
          select 1
          from ${documents}
          where ${documents.entityType} = ${ENTITY_TYPE_APPLICATION}
            and ${documents.entityId} = ${applications.id}
            and ${documents.documentType} = ${DOC_TYPE_PDF}
            and (${documents.uploadStatus} = ${UPLOAD_STATUS_UPLOADED} or ${documents.fileUrl} is not null)
        )`,
      )!,
    )!,
  );

  const [[facilityGps], [feedstockGps], [applicationGps]] = await Promise.all([
    db
      .select({ count: count() })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, facilityId),
          or(isNull(facilities.gpsLatitude), isNull(facilities.gpsLongitude)),
        ),
      ),
    db
      .select({ count: count() })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.facilityId, facilityId),
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
          eq(deliveries.facilityId, facilityId),
          isNull(deliveries.archivedAt),
          applicationEvidenceGap,
        ),
      ),
  ]);

  return {
    missingFacilityGps: Number(facilityGps?.count ?? 0),
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    missingApplicationGps: Number(applicationGps?.count ?? 0),
  };
}

async function loadRunsWithoutSamplesCount(facilityId: string): Promise<number> {
  const sampleCounts = db
    .select({
      productionRunId: samples.productionRunId,
      sampleCount: sql<number>`count(*)::int`.as("sample_count"),
    })
    .from(samples)
    .groupBy(samples.productionRunId)
    .as("sample_counts");

  const [row] = await db
    .select({ count: count() })
    .from(productionRuns)
    .leftJoin(sampleCounts, eq(sampleCounts.productionRunId, productionRuns.id))
    .where(
      and(
        eq(productionRuns.facilityId, facilityId),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "complete"),
        sql`coalesce(${sampleCounts.sampleCount}, 0) = 0`,
      ),
    );
  return Number(row?.count ?? 0);
}

function transportGapSelect(facilityIdColumn: AnyColumn) {
  return {
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
    // Keep the column referenced so the grouped query is valid.
    facilityId: sql<string>`${facilityIdColumn}`.as("facility_id"),
  };
}

async function loadTransportGapTotals(facilityId: string) {
  const [feedstockRows, biocharRows, sampleRows] = await Promise.all([
    db
      .select(transportGapSelect(feedstocks.facilityId))
      .from(transportLegs)
      .innerJoin(
        feedstocks,
        and(
          eq(transportLegs.entityType, "feedstock"),
          eq(transportLegs.entityId, feedstocks.id),
        ),
      )
      .where(eq(feedstocks.facilityId, facilityId))
      .groupBy(feedstocks.facilityId),
    db
      .select(transportGapSelect(biocharProducts.facilityId))
      .from(transportLegs)
      .innerJoin(
        biocharProducts,
        and(
          eq(transportLegs.entityType, "biochar"),
          eq(transportLegs.entityId, biocharProducts.id),
        ),
      )
      .where(eq(biocharProducts.facilityId, facilityId))
      .groupBy(biocharProducts.facilityId),
    db
      .select(transportGapSelect(productionRuns.facilityId))
      .from(transportLegs)
      .innerJoin(
        samples,
        and(
          eq(transportLegs.entityType, "sample"),
          eq(transportLegs.entityId, samples.id),
        ),
      )
      .innerJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
      .where(eq(productionRuns.facilityId, facilityId))
      .groupBy(productionRuns.facilityId),
  ]);

  const all = [...feedstockRows, ...biocharRows, ...sampleRows];
  return {
    endpointGaps: all.reduce((acc, row) => acc + Number(row.endpointGaps ?? 0), 0),
    distanceEvidenceGaps: all.reduce(
      (acc, row) => acc + Number(row.distanceEvidenceGaps ?? 0),
      0,
    ),
  };
}

function buildEvidence(args: {
  facilityId: string;
  gpsGaps: Awaited<ReturnType<typeof loadGpsGapCounts>>;
  runsWithoutSamples: number;
  transportGaps: Awaited<ReturnType<typeof loadTransportGapTotals>>;
}): DashboardEvidenceRow[] {
  const { facilityId, gpsGaps, transportGaps } = args;
  return [
    {
      key: "facility-gps",
      label: "Facility GPS missing",
      count: gpsGaps.missingFacilityGps,
      href: facilityHref("/facilities", facilityId),
    },
    {
      key: "feedstock-gps",
      label: "Feedstock GPS missing",
      count: gpsGaps.missingFeedstockGps,
      href: facilityHref("/feedstocks", facilityId),
    },
    {
      key: "application-gps",
      label: "Application GPS missing",
      count: gpsGaps.missingApplicationGps,
      href: facilityHref("/applications", facilityId),
    },
    {
      key: "runs-samples",
      label: "Runs without samples",
      count: args.runsWithoutSamples,
      href: facilityHref("/production-runs", facilityId),
    },
    {
      key: "transport-endpoints",
      label: "Transport endpoint gaps",
      count: transportGaps.endpointGaps,
      href: facilityHref("/chain-of-custody", facilityId),
    },
    {
      key: "transport-distance",
      label: "Distances not document-backed",
      count: transportGaps.distanceEvidenceGaps,
      href: facilityHref("/chain-of-custody", facilityId),
    },
  ];
}

// ============================================
// Map points — the facility and its plottable sites
// ============================================

/** Cap per source — the dashboard map is an overview, not the custody viewer. */
const MAP_POINT_LIMIT = 60;

/** Coerce a (numeric|string) lat/lng pair to finite numbers, dropping 0,0. */
function coordPair(lat: unknown, lng: unknown): [number, number] | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la === 0 && ln === 0) return null;
  return [la, ln];
}

async function loadMapPoints(facilityId: string): Promise<DashboardMapPoint[]> {
  const [facilityRows, applicationRows, feedstockRows] = await Promise.all([
    db
      .select({
        id: facilities.id,
        code: facilities.code,
        name: facilities.name,
        lat: facilities.gpsLatitude,
        lng: facilities.gpsLongitude,
      })
      .from(facilities)
      .where(eq(facilities.id, facilityId))
      .limit(1),
    db
      .select({
        id: applications.id,
        code: applications.code,
        status: applications.status,
        lat: applications.gpsLatitude,
        lng: applications.gpsLongitude,
      })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(and(eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
      .orderBy(desc(applications.applicationDate))
      .limit(MAP_POINT_LIMIT),
    db
      .select({
        id: feedstocks.id,
        code: feedstocks.code,
        status: feedstocks.status,
        lat: feedstocks.gpsLatitude,
        lng: feedstocks.gpsLongitude,
      })
      .from(feedstocks)
      .where(and(eq(feedstocks.facilityId, facilityId), isNull(feedstocks.archivedAt)))
      .orderBy(desc(feedstocks.deliveryDate))
      .limit(MAP_POINT_LIMIT),
  ]);

  const points: DashboardMapPoint[] = [];

  const facility = facilityRows[0];
  if (facility) {
    const coord = coordPair(facility.lat, facility.lng);
    if (coord) {
      points.push({
        id: `facility-${facility.id}`,
        kind: "facility",
        label: facility.name,
        sublabel: `Facility · ${facility.code}`,
        lat: coord[0],
        lng: coord[1],
      });
    }
  }

  for (const row of applicationRows) {
    const coord = coordPair(row.lat, row.lng);
    if (!coord) continue;
    points.push({
      id: `application-${row.id}`,
      kind: "application",
      label: row.code,
      sublabel: `Application · ${row.status}`,
      lat: coord[0],
      lng: coord[1],
    });
  }

  for (const row of feedstockRows) {
    const coord = coordPair(row.lat, row.lng);
    if (!coord) continue;
    points.push({
      id: `feedstock-${row.id}`,
      kind: "feedstock",
      label: row.code,
      sublabel: `Feedstock · ${row.status}`,
      lat: coord[0],
      lng: coord[1],
    });
  }

  return points;
}

// ============================================
// Aggregate
// ============================================

export async function getDashboardOperations(
  userId: string,
  facilityId: string,
): Promise<DashboardOperations> {
  requireAuth(userId);

  const now = new Date();
  const completedSince = toDateOnly(
    new Date(now.getTime() - NOW_COMPLETED_LOOKBACK_DAYS * MS_PER_DAY),
  );

  const [
    counts,
    runningRuns,
    recentCompletedRuns,
    removalRows,
    statementRows,
    gpsGaps,
    runsWithoutSamples,
    transportGaps,
    mapPoints,
  ] = await Promise.all([
    loadStatusCounts(facilityId),
    loadRunningRuns(facilityId),
    loadRecentCompletedRuns(facilityId, completedSince),
    loadRemovalRows(facilityId),
    loadStatementRows(facilityId),
    loadGpsGapCounts(facilityId),
    loadRunsWithoutSamplesCount(facilityId),
    loadTransportGapTotals(facilityId),
    loadMapPoints(facilityId),
  ]);

  return {
    generatedAt: now.toISOString(),
    now: buildNow({
      facilityId,
      runningRuns,
      recentCompletedRuns,
      removalRows,
      statementRows,
    }),
    progress: buildProgress({ counts, removalRows, statementRows }),
    evidence: buildEvidence({
      facilityId,
      gpsGaps,
      runsWithoutSamples,
      transportGaps,
    }),
    mapPoints,
  };
}
