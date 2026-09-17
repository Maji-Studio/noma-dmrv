/**
 * Dashboard station data access — the "right now" half of the Flow Hero
 * dashboard: per-station counts along the traceability chain (supplier →
 * feedstock → production → biochar → delivery → application), the recent
 * activity feed, and the registry/certification summary block.
 *
 * Range-independent by design — the stations describe where the facility
 * stands now; the period-scoped numbers (KPIs, mass flow) live in
 * `dashboard-overview.ts`. Two round trips: one statement of filtered
 * aggregates for every count, one `union all` for the newest rows per entity;
 * the merge sort and labelling happen in JS.
 */
import { db } from "@/db";
import { countRows } from "@/db/aggregate";
import {
  applications,
  biocharProducts,
  creditBatches,
  deliveries,
  feedstocks,
  productionRuns,
  samples,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import type { StatusStateClass } from "@/lib/status-state";
import {
  and,
  countDistinct,
  desc,
  eq,
  isNotNull,
  isNull,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import {
  applicationEvidenceGapWhere,
  overdueBatchesWhere,
  productsUnlinkedWhere,
  runsMissingMassWhere,
} from "./dashboard-attention";
import { requireOrgScope } from "./utils";

/** Total rows the activity feed keeps after the merge sort. */
const ACTIVITY_TOTAL = 8;
/**
 * Rows per entity pulled before the merge. Must be ≥ ACTIVITY_TOTAL: fewer and
 * a single busy entity's newest events get truncated pre-merge, letting older
 * events from other entities slip into the global top-N.
 */
const ACTIVITY_PER_ENTITY = ACTIVITY_TOTAL;
/** Recent credit batches listed in the certification block. */
const CERTIFICATION_BATCH_ROWS = 4;

export type DashboardStationKey =
  | "suppliers"
  | "feedstock"
  | "production"
  | "products"
  | "deliveries"
  | "applications";

/** Canonical status state for a station reason row — never color-only in the UI. */
export type DashboardStationState = Extract<
  StatusStateClass,
  "error" | "warning" | "in-progress"
>;

export interface DashboardStationReason {
  state: DashboardStationState;
  text: string;
}

export interface DashboardStation {
  key: DashboardStationKey;
  name: string;
  /** Total records behind the station, e.g. "12 runs". */
  total: number;
  totalLabel: string;
  /** Records needing operator follow-through (drives the badge). */
  attention: number;
  /** Short reason rows behind the attention count (tooltip + attention view). */
  reasons: DashboardStationReason[];
  href: string;
}

export interface DashboardActivityItem {
  id: string;
  /** Entity code shown mono, e.g. "PR-26-0042". */
  code: string;
  title: string;
  /** ISO date the event happened (date-only precision is fine). */
  dateIso: string;
  href: string;
}

export type DashboardCreditBatchStatus =
  | "draft"
  | "pending"
  | "verified"
  | "issued"
  | "rejected";

export interface DashboardCertificationBatch {
  id: string;
  code: string;
  status: DashboardCreditBatchStatus;
}

export interface DashboardCertification {
  totalBatches: number;
  pendingBatches: number;
  /** Latest batches, newest first. */
  batches: DashboardCertificationBatch[];
  /** Batches with zero pooled lab samples — the classic certification blocker. */
  batchesWithoutSamples: number;
}

export interface DashboardStationsData {
  stations: DashboardStation[];
  /** Runs currently in "running" status (scene chip). */
  runningRuns: number;
  activity: DashboardActivityItem[];
  certification: DashboardCertification;
}

function facilityHref(path: string, facilityId: string): string {
  return `${path}?facility=${encodeURIComponent(facilityId)}`;
}

function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? `${singular}s`)}`;
}

/** Milliseconds since the epoch for a timestamp column, for cross-entity sorting. */
function epochMs(column: SQLWrapper): SQL<number> {
  return sql<number>`(extract(epoch from ${column}) * 1000)`.mapWith(Number);
}

/**
 * Every station and certification count in one statement: each entity is one
 * filtered-aggregate subquery scanned once, and the cross join of their
 * single rows is the snapshot. `overdueBatches` feeds the attention total in
 * `dashboard-overview.ts`; it is not a station badge.
 */
async function loadStationAggregates(
  ctx: OrgContext,
  facilityId: string,
  todayStr: string,
) {
  const orgId = ctx.organizationId;
  const feedstockAgg = db
    .select({
      total: countRows().as("feedstock_total"),
      missingData: countRows(eq(feedstocks.status, "missing_data")).as(
        "feedstock_missing_data",
      ),
      // count(distinct …) skips null supplier ids by itself.
      suppliers: countDistinct(feedstocks.supplierId).mapWith(Number).as(
        "feedstock_suppliers",
      ),
    })
    .from(feedstocks)
    .where(
      and(
        eq(feedstocks.organizationId, orgId),
        eq(feedstocks.facilityId, facilityId),
        isNull(feedstocks.archivedAt),
      ),
    )
    .as("feedstock_agg");
  const runAgg = db
    .select({
      total: countRows().as("run_total"),
      running: countRows(eq(productionRuns.status, "running")).as("run_running"),
      missingMass: countRows(runsMissingMassWhere(orgId, facilityId)).as(
        "run_missing_mass",
      ),
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.organizationId, orgId),
        eq(productionRuns.facilityId, facilityId),
        isNull(productionRuns.archivedAt),
      ),
    )
    .as("run_agg");
  const productAgg = db
    .select({
      total: countRows().as("product_total"),
      unlinked: countRows(productsUnlinkedWhere(orgId, facilityId)).as(
        "product_unlinked",
      ),
    })
    .from(biocharProducts)
    .where(
      and(
        eq(biocharProducts.organizationId, orgId),
        eq(biocharProducts.facilityId, facilityId),
        isNull(biocharProducts.archivedAt),
      ),
    )
    .as("product_agg");
  const deliveryAgg = db
    .select({ total: countRows().as("delivery_total") })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.organizationId, orgId),
        eq(deliveries.facilityId, facilityId),
        isNull(deliveries.archivedAt),
      ),
    )
    .as("delivery_agg");
  const applicationAgg = db
    .select({
      total: countRows().as("application_total"),
      evidenceGaps: countRows(applicationEvidenceGapWhere(orgId, facilityId)).as(
        "application_evidence_gaps",
      ),
    })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, orgId),
      ),
    )
    .where(
      and(
        eq(applications.organizationId, orgId),
        eq(deliveries.facilityId, facilityId),
        isNull(deliveries.archivedAt),
      ),
    )
    .as("application_agg");
  // Samples anchor on the credit batch (issue #309): a batch with zero pooled
  // samples has no chemistry behind its carbon figures.
  const sampleCounts = db
    .select({
      creditBatchId: samples.creditBatchId,
      sampleCount: countRows().as("sample_count"),
    })
    .from(samples)
    .where(eq(samples.organizationId, orgId))
    .groupBy(samples.creditBatchId)
    .as("sample_counts");
  const batchAgg = db
    .select({
      total: countRows().as("batch_total"),
      pending: countRows(eq(creditBatches.status, "pending")).as("batch_pending"),
      withoutSamples: countRows(
        sql`coalesce(${sampleCounts.sampleCount}, 0) = 0`,
      ).as("batch_without_samples"),
      overdue: countRows(
        overdueBatchesWhere(orgId, facilityId, todayStr),
      ).as("batch_overdue"),
    })
    .from(creditBatches)
    .leftJoin(sampleCounts, eq(sampleCounts.creditBatchId, creditBatches.id))
    .where(
      and(
        eq(creditBatches.organizationId, orgId),
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.archivedAt),
      ),
    )
    .as("batch_agg");

  const [row] = await db
    .select({
      feedstockTotal: feedstockAgg.total,
      feedstockMissingData: feedstockAgg.missingData,
      supplierCount: feedstockAgg.suppliers,
      runTotal: runAgg.total,
      runningRuns: runAgg.running,
      runsMissingMass: runAgg.missingMass,
      productTotal: productAgg.total,
      productsUnlinked: productAgg.unlinked,
      deliveryTotal: deliveryAgg.total,
      applicationTotal: applicationAgg.total,
      evidenceGaps: applicationAgg.evidenceGaps,
      batchTotal: batchAgg.total,
      pendingBatches: batchAgg.pending,
      batchesWithoutSamples: batchAgg.withoutSamples,
      overdueBatches: batchAgg.overdue,
    })
    .from(feedstockAgg)
    .crossJoin(runAgg)
    .crossJoin(productAgg)
    .crossJoin(deliveryAgg)
    .crossJoin(applicationAgg)
    .crossJoin(batchAgg);
  if (!row) throw new Error("station aggregate returned no row");
  return row;
}

// ============================================
// Activity feed
// ============================================

type ActivityKind = "feedstock" | "run" | "delivery" | "application" | "batch";

function activityKind(kind: ActivityKind): SQL<ActivityKind> {
  return sql<ActivityKind>`${kind}::text`;
}

interface ActivityRow {
  kind: ActivityKind;
  id: string;
  code: string;
  /** Credit batch status; null for every other kind. */
  status: string | null;
  sortMs: number;
}

/**
 * Newest events per entity, fetched as one `union all` so the merge sort in
 * JS sees each entity's own top-N. The batch rows double as the
 * certification block's recent-batch list (same filter, same order).
 */
async function loadActivityRows(
  ctx: OrgContext,
  facilityId: string,
): Promise<ActivityRow[]> {
  const orgId = ctx.organizationId;
  const noStatus = sql<string | null>`null::text`;
  return unionAll(
    db
      .select({
        kind: activityKind("feedstock"),
        id: feedstocks.id,
        code: feedstocks.code,
        status: noStatus,
        sortMs: epochMs(feedstocks.deliveryDate),
      })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.organizationId, orgId),
          eq(feedstocks.facilityId, facilityId),
          isNull(feedstocks.archivedAt),
          isNotNull(feedstocks.deliveryDate),
        ),
      )
      .orderBy(desc(feedstocks.deliveryDate))
      .limit(ACTIVITY_PER_ENTITY),
    db
      .select({
        kind: activityKind("run"),
        id: productionRuns.id,
        code: productionRuns.code,
        status: noStatus,
        sortMs: epochMs(productionRuns.endTime),
      })
      .from(productionRuns)
      .where(
        and(
          eq(productionRuns.organizationId, orgId),
          eq(productionRuns.facilityId, facilityId),
          isNull(productionRuns.archivedAt),
          eq(productionRuns.status, "complete"),
          isNotNull(productionRuns.endTime),
        ),
      )
      .orderBy(desc(productionRuns.endTime))
      .limit(ACTIVITY_PER_ENTITY),
    db
      .select({
        kind: activityKind("delivery"),
        id: deliveries.id,
        code: deliveries.code,
        status: noStatus,
        sortMs: epochMs(deliveries.deliveryDate),
      })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.organizationId, orgId),
          eq(deliveries.facilityId, facilityId),
          isNull(deliveries.archivedAt),
          eq(deliveries.status, "delivered"),
          isNotNull(deliveries.deliveryDate),
        ),
      )
      .orderBy(desc(deliveries.deliveryDate))
      .limit(ACTIVITY_PER_ENTITY),
    db
      .select({
        kind: activityKind("application"),
        id: applications.id,
        code: applications.code,
        status: noStatus,
        sortMs: epochMs(applications.applicationDate),
      })
      .from(applications)
      .innerJoin(
        deliveries,
        and(
          eq(applications.deliveryId, deliveries.id),
          eq(deliveries.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(applications.organizationId, orgId),
          eq(deliveries.facilityId, facilityId),
          isNull(deliveries.archivedAt),
          // "Biochar applied to soil" — only applications actually applied,
          // not ones still in the `delivered` state.
          eq(applications.status, "applied"),
          isNotNull(applications.applicationDate),
        ),
      )
      .orderBy(desc(applications.applicationDate))
      .limit(ACTIVITY_PER_ENTITY),
    db
      .select({
        kind: activityKind("batch"),
        id: creditBatches.id,
        code: creditBatches.code,
        status: sql<string | null>`${creditBatches.status}::text`,
        sortMs: epochMs(creditBatches.createdAt),
      })
      .from(creditBatches)
      .where(
        and(
          eq(creditBatches.organizationId, orgId),
          eq(creditBatches.facilityId, facilityId),
          isNull(creditBatches.archivedAt),
        ),
      )
      .orderBy(desc(creditBatches.createdAt))
      .limit(ACTIVITY_PER_ENTITY),
  );
}

const ACTIVITY_TITLES: Record<ActivityKind, string> = {
  feedstock: "Feedstock received",
  run: "Production run completed",
  delivery: "Delivery completed",
  application: "Biochar applied to soil",
  batch: "Credit batch created",
};

function activityHref(
  kind: ActivityKind,
  id: string,
  facilityId: string,
): string {
  switch (kind) {
    case "feedstock":
      return facilityHref("/feedstocks", facilityId);
    case "run":
      return facilityHref("/production-runs", facilityId);
    case "delivery":
      return facilityHref("/deliveries", facilityId);
    case "application":
      return facilityHref("/applications", facilityId);
    case "batch":
      return creditBatchDeepLinkHref(id, facilityId);
  }
}

function buildActivity(
  rows: ActivityRow[],
  facilityId: string,
): DashboardActivityItem[] {
  return rows
    .filter((row) => Number.isFinite(row.sortMs))
    .sort((a, b) => b.sortMs - a.sortMs)
    .slice(0, ACTIVITY_TOTAL)
    .map((row) => ({
      id: `${row.kind}-${row.id}`,
      code: row.code,
      title: ACTIVITY_TITLES[row.kind],
      dateIso: new Date(row.sortMs).toISOString(),
      href: activityHref(row.kind, row.id, facilityId),
    }));
}

function buildRecentBatches(rows: ActivityRow[]): DashboardCertificationBatch[] {
  return rows
    .filter((row) => row.kind === "batch")
    .sort((a, b) => b.sortMs - a.sortMs)
    .slice(0, CERTIFICATION_BATCH_ROWS)
    .map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status as DashboardCreditBatchStatus,
    }));
}

// ============================================
// Aggregate
// ============================================

/** Station snapshot plus the batch-only attention count the overview adds to the queue size. */
export interface DashboardStationsSnapshot extends DashboardStationsData {
  /** Pending credit batches whose measurement period has closed (uncapped). */
  overdueBatches: number;
}

export async function getDashboardStations(
  ctx: OrgContext,
  facilityId: string,
): Promise<DashboardStationsSnapshot> {
  requireOrgScope(ctx);
  const todayStr = new Date().toISOString().slice(0, 10);

  const [counts, activityRows] = await Promise.all([
    loadStationAggregates(ctx, facilityId, todayStr),
    loadActivityRows(ctx, facilityId),
  ]);

  const {
    feedstockTotal,
    feedstockMissingData: feedstockMissing,
    supplierCount,
    runTotal,
    runningRuns,
    runsMissingMass,
    productTotal,
    productsUnlinked,
    deliveryTotal,
    applicationTotal,
    evidenceGaps,
  } = counts;

  const stations: DashboardStation[] = [
    {
      key: "suppliers",
      name: "Suppliers",
      total: supplierCount,
      totalLabel: plural(supplierCount, "supplier"),
      attention: 0,
      reasons: [],
      href: facilityHref("/suppliers", facilityId),
    },
    {
      key: "feedstock",
      name: "Feedstock",
      total: feedstockTotal,
      totalLabel: plural(feedstockTotal, "feedstock"),
      attention: feedstockMissing,
      reasons:
        feedstockMissing > 0
          ? [{ state: "warning", text: `${plural(feedstockMissing, "record")} missing data` }]
          : [],
      href: facilityHref("/feedstocks", facilityId),
    },
    {
      key: "production",
      name: "Production",
      total: runTotal,
      totalLabel: plural(runTotal, "run"),
      attention: runsMissingMass,
      reasons: [
        ...(runsMissingMass > 0
          ? [{ state: "warning" as const, text: `${plural(runsMissingMass, "run")} missing mass data` }]
          : []),
        ...(runningRuns > 0
          ? [{ state: "in-progress" as const, text: `${runningRuns} running now` }]
          : []),
      ],
      href: facilityHref("/production-runs", facilityId),
    },
    {
      key: "products",
      name: "Biochar",
      total: productTotal,
      totalLabel: plural(productTotal, "product"),
      attention: productsUnlinked,
      reasons:
        productsUnlinked > 0
          ? [{ state: "warning", text: `${plural(productsUnlinked, "product")} not linked to a run` }]
          : [],
      href: facilityHref("/biochar-products", facilityId),
    },
    {
      key: "deliveries",
      name: "Delivery",
      total: deliveryTotal,
      totalLabel: plural(deliveryTotal, "delivery", "deliveries"),
      attention: 0,
      reasons: [],
      href: facilityHref("/deliveries", facilityId),
    },
    {
      key: "applications",
      name: "Application",
      total: applicationTotal,
      totalLabel: plural(applicationTotal, "application"),
      attention: evidenceGaps,
      reasons:
        evidenceGaps > 0
          ? [{ state: "warning", text: `${plural(evidenceGaps, "evidence gap")}` }]
          : [],
      href: facilityHref("/applications", facilityId),
    },
  ];

  return {
    stations,
    runningRuns,
    activity: buildActivity(activityRows, facilityId),
    certification: {
      totalBatches: counts.batchTotal,
      pendingBatches: counts.pendingBatches,
      batches: buildRecentBatches(activityRows),
      batchesWithoutSamples: counts.batchesWithoutSamples,
    },
    overdueBatches: counts.overdueBatches,
  };
}
