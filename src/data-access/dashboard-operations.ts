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
import type { OrgContext } from "@/lib/auth/server";
import {
  APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE,
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLES,
} from "@/lib/certification/application-evidence";
import { requireOrgScope } from "./utils";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { loadMapTrace } from "./dashboard-map-trace";
import type {
  DashboardMapEdge,
  DashboardMapPoint,
} from "./dashboard-map-trace";

// Re-exported so dashboard-overview imports every map type from one module.
export type {
  DashboardMapDetail,
  DashboardMapEdge,
  DashboardMapKind,
  DashboardMapPoint,
} from "./dashboard-map-trace";

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

export interface DashboardOperations {
  /** Server time the snapshot was built (ISO). */
  generatedAt: string;
  now: DashboardNowItem[];
  progress: DashboardProgressStage[];
  evidence: DashboardEvidenceRow[];
  /** Plottable sites: the facility, its application fields, and feedstock sources. */
  mapPoints: DashboardMapPoint[];
  /** Directional traceability legs connecting the plotted sites. */
  mapEdges: DashboardMapEdge[];
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function facilityHref(path: string, facilityId: string): string {
  return `${path}?facility=${encodeURIComponent(facilityId)}`;
}

function productionRunHref(facilityId: string, productionRunId: string): string {
  return `/production-runs?facility=${encodeURIComponent(
    facilityId,
  )}&run=${encodeURIComponent(productionRunId)}`;
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

async function loadStatusCounts(ctx: OrgContext, facilityId: string) {
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
      .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.facilityId, facilityId), isNull(feedstocks.archivedAt)))
      .groupBy(feedstocks.status),
    db
      .select({ status: productionRuns.status, count: count() })
      .from(productionRuns)
      .where(
        and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, facilityId), isNull(productionRuns.archivedAt)),
      )
      .groupBy(productionRuns.status),
    db
      .select({ status: biocharProducts.status, count: count() })
      .from(biocharProducts)
      .where(
        and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.facilityId, facilityId), isNull(biocharProducts.archivedAt)),
      )
      .groupBy(biocharProducts.status),
    db
      .select({ status: deliveries.status, count: count() })
      .from(deliveries)
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
      .groupBy(deliveries.status),
    db
      .select({ status: applications.status, count: count() })
      .from(applications)
      .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
      .groupBy(applications.status),
    db
      .select({ status: creditBatches.status, count: count() })
      .from(creditBatches)
      .where(
        and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)),
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

interface SubmissionProgressCounts {
  removalTotal: number;
  removalNeedsAttention: number;
  statementTotal: number;
  statementNeedsAttention: number;
}

/** Latest submission row per local entity (highest version wins). */
function latestSubmission(ctx: OrgContext, submissionType: string, localEntityType: string) {
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
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(
      certificationSubmissions.localEntityId,
      desc(certificationSubmissions.version),
    );
}

async function loadSubmissionProgressCounts(
  ctx: OrgContext,
  facilityId: string,
): Promise<SubmissionProgressCounts> {
  const removalLatest = latestSubmission(ctx, "removal", "removal").as(
    "latest_removal_submission",
  );
  const statementLatest = latestSubmission(ctx, "ghg_statement", "ghgStatement").as(
    "latest_statement_submission",
  );

  const [[removalCounts], [statementCounts]] = await Promise.all([
    db
      .select({
        total: sql<number>`count(${certifierRemovals.id})::int`,
        needsAttention: sql<number>`coalesce(sum(case when ${removalLatest.status} is null or ${removalLatest.status} in ('draft', 'rejected') then 1 else 0 end), 0)::int`,
      })
      .from(certifierRemovals)
      .leftJoin(removalLatest, eq(removalLatest.localEntityId, certifierRemovals.id))
      .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId))),
    db
      .select({
        total: sql<number>`count(${certifierGhgStatements.id})::int`,
        needsAttention: sql<number>`coalesce(sum(case when ${statementLatest.status} in ('submitted', 'rejected') then 1 else 0 end), 0)::int`,
      })
      .from(certifierGhgStatements)
      .leftJoin(
        statementLatest,
        eq(statementLatest.localEntityId, certifierGhgStatements.id),
      )
      .where(and(eq(certifierGhgStatements.organizationId, ctx.organizationId), eq(certifierGhgStatements.facilityId, facilityId))),
  ]);

  return {
    removalTotal: Number(removalCounts?.total ?? 0),
    removalNeedsAttention: Number(removalCounts?.needsAttention ?? 0),
    statementTotal: Number(statementCounts?.total ?? 0),
    statementNeedsAttention: Number(statementCounts?.needsAttention ?? 0),
  };
}

async function loadRemovalRows(ctx: OrgContext, facilityId: string): Promise<SubmissionRow[]> {
  const latest = latestSubmission(ctx, "removal", "removal").as("latest_submission");
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
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId)))
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

async function loadStatementRows(ctx: OrgContext, facilityId: string): Promise<SubmissionRow[]> {
  const latest = latestSubmission(ctx, "ghg_statement", "ghgStatement").as(
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
    .where(and(eq(certifierGhgStatements.organizationId, ctx.organizationId), eq(certifierGhgStatements.facilityId, facilityId)))
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

async function loadRunningRuns(ctx: OrgContext, facilityId: string): Promise<RunRow[]> {
  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
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
  ctx: OrgContext,
  facilityId: string,
  sinceDate: string,
): Promise<RunRow[]> {
  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.facilityId, facilityId),
        isNull(productionRuns.archivedAt),
        eq(productionRuns.status, "complete"),
        gte(productionRunDateExpr(), sinceDate),
      ),
    )
    .orderBy(desc(productionRuns.startTime))
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
      href: productionRunHref(facilityId, row.id),
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
      detail: row.lockedAt ? "Submission in progress" : "In verification",
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
      href: productionRunHref(facilityId, row.id),
    });
  }

  return items.slice(0, MAX_NOW_ITEMS);
}

// ============================================
// Progress — the MRV pipeline funnel
// ============================================

function buildProgress(args: {
  counts: Awaited<ReturnType<typeof loadStatusCounts>>;
  submissionProgress: SubmissionProgressCounts;
}): DashboardProgressStage[] {
  const { counts, submissionProgress } = args;

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
      total: submissionProgress.removalTotal,
      needsAttention: submissionProgress.removalNeedsAttention,
      href: "/certification/removals",
    },
    {
      key: "statements",
      label: "GHG statements",
      total: submissionProgress.statementTotal,
      needsAttention: submissionProgress.statementNeedsAttention,
      href: "/certification/ghg-statements",
    },
  ];
}

// ============================================
// Evidence — structural certification gaps
// ============================================

async function loadGpsGapCounts(ctx: OrgContext, facilityId: string) {
  // Mirror `buildApplicationEvidenceGaps` (the certification submission gate) so
  // this dashboard count can't drift from what certification actually blocks on.
  // Visual evidence needs a geotagged photo for EVERY role (stockpile/spreading/
  // incorporation); boundary evidence needs a GIS reference AND a logbook doc —
  // a typed PDF, a weighbridge ticket, or an affidavit. The document-type
  // taxonomy is shared with that builder via
  // `@/lib/certification/application-evidence` so the two cannot drift; the role
  // and logbook semantics below are still hand-maintained in both.
  const visualRoleMissing = (role: string) => sql`not exists (
          select 1
          from ${documents}
          where ${documents.entityType} = ${ENTITY_TYPE_APPLICATION}
            and ${documents.entityId} = ${applications.id}
            and ${documents.documentType} = ${APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE}
            and (${documents.uploadStatus} = ${UPLOAD_STATUS_UPLOADED} or ${documents.fileUrl} is not null)
            and ${documents.metadata}->>'geotagStatus' = ${GEOTAG_STATUS_PRESENT}
            and ${documents.metadata}->>'evidenceRole' = ${role}
        )`;

  const boundaryLogbookMissing = sql`not exists (
          select 1
          from ${documents}
          where ${documents.entityType} = ${ENTITY_TYPE_APPLICATION}
            and ${documents.entityId} = ${applications.id}
            and (${documents.uploadStatus} = ${UPLOAD_STATUS_UPLOADED} or ${documents.fileUrl} is not null)
            and (
              ${documents.documentType} in (${sql.join(
                APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES.map(
                  (type) => sql`${type}`,
                ),
                sql`, `,
              )})
              or (
                ${documents.documentType} = ${APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE}
                and ${documents.metadata}->>'logbookEvidenceType' in (${sql.join(
                  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map(
                    (type) => sql`${type}`,
                  ),
                  sql`, `,
                )})
              )
            )
        )`;

  const applicationEvidenceGap = or(
    and(
      eq(applications.evidenceMethod, EVIDENCE_METHOD_VISUAL),
      or(...APPLICATION_VISUAL_EVIDENCE_ROLES.map(visualRoleMissing))!,
    )!,
    and(
      eq(applications.evidenceMethod, EVIDENCE_METHOD_BOUNDARY),
      or(
        isNull(applications.gisBoundaryReference),
        sql`trim(${applications.gisBoundaryReference}::text) = ''`,
        boundaryLogbookMissing,
      )!,
    )!,
  );

  const [[facilityGps], [feedstockGps], [applicationGps]] = await Promise.all([
    db
      .select({ count: count() })
      .from(facilities)
      .where(
        and(
          eq(facilities.organizationId, ctx.organizationId),
          eq(facilities.id, facilityId),
          or(isNull(facilities.gpsLatitude), isNull(facilities.gpsLongitude)),
        ),
      ),
    db
      .select({ count: count() })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.organizationId, ctx.organizationId),
          eq(feedstocks.facilityId, facilityId),
          isNull(feedstocks.archivedAt),
          or(isNull(feedstocks.gpsLatitude), isNull(feedstocks.gpsLongitude)),
        ),
      ),
    db
      .select({ count: count() })
      .from(applications)
      .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
      .where(
        and(
          eq(applications.organizationId, ctx.organizationId),
          eq(deliveries.facilityId, facilityId),
          isNull(deliveries.archivedAt),
          applicationEvidenceGap,
        ),
      ),
  ]);

  return {
    missingFacilityGps: Number(facilityGps?.count ?? 0),
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    missingApplicationEvidence: Number(applicationGps?.count ?? 0),
  };
}

// Samples anchor on the credit batch (issue #309), so the "missing lab
// evidence" nudge is judged at the batch grain — a batch with zero pooled
// samples has no chemistry behind its carbon figures.
async function loadBatchesWithoutSamplesCount(
  ctx: OrgContext,
  facilityId: string,
): Promise<number> {
  const sampleCounts = db
    .select({
      creditBatchId: samples.creditBatchId,
      sampleCount: sql<number>`count(*)::int`.as("sample_count"),
    })
    .from(samples)
    .where(eq(samples.organizationId, ctx.organizationId))
    .groupBy(samples.creditBatchId)
    .as("sample_counts");

  const [row] = await db
    .select({ count: count() })
    .from(creditBatches)
    .leftJoin(sampleCounts, eq(sampleCounts.creditBatchId, creditBatches.id))
    .where(
      and(
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.archivedAt),
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

async function loadTransportGapTotals(ctx: OrgContext, facilityId: string) {
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
      .where(and(eq(transportLegs.organizationId, ctx.organizationId), eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.facilityId, facilityId)))
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
      .where(and(eq(transportLegs.organizationId, ctx.organizationId), eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.facilityId, facilityId)))
      .groupBy(biocharProducts.facilityId),
    // Sample legs scope via the credit batch's facility (issue #309); legacy
    // run-linked rows fall back to the run's facility.
    db
      .select(transportGapSelect(creditBatches.facilityId))
      .from(transportLegs)
      .innerJoin(
        samples,
        and(
          eq(transportLegs.entityType, "sample"),
          eq(transportLegs.entityId, samples.id),
        ),
      )
      .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
      .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
      .where(
        and(
          eq(transportLegs.organizationId, ctx.organizationId),
          eq(samples.organizationId, ctx.organizationId),
          or(eq(creditBatches.facilityId, facilityId), eq(productionRuns.facilityId, facilityId)),
        ),
      )
      .groupBy(creditBatches.facilityId),
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
  batchesWithoutSamples: number;
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
      key: "application-evidence",
      label: "Application evidence gaps",
      count: gpsGaps.missingApplicationEvidence,
      href: facilityHref("/applications", facilityId),
    },
    {
      key: "batches-samples",
      label: "Credit batches without samples",
      count: args.batchesWithoutSamples,
      href: facilityHref("/credit-batches", facilityId),
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
// Aggregate
// ============================================

export async function getDashboardOperations(
  ctx: OrgContext,
  facilityId: string,
): Promise<DashboardOperations> {
  requireOrgScope(ctx);

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
    submissionProgress,
    gpsGaps,
    batchesWithoutSamples,
    transportGaps,
    mapTrace,
  ] = await Promise.all([
    loadStatusCounts(ctx, facilityId),
    loadRunningRuns(ctx, facilityId),
    loadRecentCompletedRuns(ctx, facilityId, completedSince),
    loadRemovalRows(ctx, facilityId),
    loadStatementRows(ctx, facilityId),
    loadSubmissionProgressCounts(ctx, facilityId),
    loadGpsGapCounts(ctx, facilityId),
    loadBatchesWithoutSamplesCount(ctx, facilityId),
    loadTransportGapTotals(ctx, facilityId),
    loadMapTrace(ctx, facilityId),
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
    progress: buildProgress({ counts, submissionProgress }),
    evidence: buildEvidence({
      facilityId,
      gpsGaps,
      batchesWithoutSamples,
      transportGaps,
    }),
    mapPoints: mapTrace.points,
    mapEdges: mapTrace.edges,
  };
}
