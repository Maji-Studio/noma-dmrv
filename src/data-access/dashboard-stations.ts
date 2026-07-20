/**
 * Dashboard station data access — the "right now" half of the Flow Hero
 * dashboard: per-station counts along the traceability chain (supplier →
 * feedstock → production → biochar → delivery → application), the recent
 * activity feed, and the registry/certification summary block.
 *
 * Range-independent by design — the stations describe where the facility
 * stands now; the period-scoped numbers (KPIs, mass flow) live in
 * `dashboard-overview.ts`. Queries are narrow, indexed, facility-scoped;
 * anything that isn't a cheap count/group-by happens in JS.
 */
import { and, count, countDistinct, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
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
import { requireOrgScope } from "./utils";
import {
  applicationEvidenceGapWhere,
  productsUnlinkedWhere,
  runsMissingMassWhere,
} from "./dashboard-attention";

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

/** Status-ramp tone for a station reason row — never color-only in the UI. */
export type DashboardStationTone = "wait" | "run";

export interface DashboardStationReason {
  tone: DashboardStationTone;
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

interface StatusCountRow {
  status: string;
  count: number;
}

function countByStatus(rows: StatusCountRow[], statuses: string[]): number {
  const wanted = new Set(statuses);
  return rows
    .filter((row) => wanted.has(row.status))
    .reduce((acc, row) => acc + Number(row.count), 0);
}

function totalCount(rows: StatusCountRow[]): number {
  return rows.reduce((acc, row) => acc + Number(row.count), 0);
}

async function loadStatusCounts(ctx: OrgContext, facilityId: string) {
  const [feedstockRows, runRows, productRows, deliveryRows, applicationRows, batchRows] =
    await Promise.all([
      db
        .select({ status: feedstocks.status, count: count() })
        .from(feedstocks)
        .where(
          and(
            eq(feedstocks.organizationId, ctx.organizationId),
            eq(feedstocks.facilityId, facilityId),
            isNull(feedstocks.archivedAt),
          ),
        )
        .groupBy(feedstocks.status),
      db
        .select({ status: productionRuns.status, count: count() })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.organizationId, ctx.organizationId),
            eq(productionRuns.facilityId, facilityId),
            isNull(productionRuns.archivedAt),
          ),
        )
        .groupBy(productionRuns.status),
      db
        .select({ status: biocharProducts.status, count: count() })
        .from(biocharProducts)
        .where(
          and(
            eq(biocharProducts.organizationId, ctx.organizationId),
            eq(biocharProducts.facilityId, facilityId),
            isNull(biocharProducts.archivedAt),
          ),
        )
        .groupBy(biocharProducts.status),
      db
        .select({ status: deliveries.status, count: count() })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.organizationId, ctx.organizationId),
            eq(deliveries.facilityId, facilityId),
            isNull(deliveries.archivedAt),
          ),
        )
        .groupBy(deliveries.status),
      db
        .select({ status: applications.status, count: count() })
        .from(applications)
        .innerJoin(
          deliveries,
          and(
            eq(applications.deliveryId, deliveries.id),
            eq(deliveries.organizationId, ctx.organizationId),
          ),
        )
        .where(
          and(
            eq(applications.organizationId, ctx.organizationId),
            eq(deliveries.facilityId, facilityId),
            isNull(deliveries.archivedAt),
          ),
        )
        .groupBy(applications.status),
      db
        .select({ status: creditBatches.status, count: count() })
        .from(creditBatches)
        .where(
          and(
            eq(creditBatches.organizationId, ctx.organizationId),
            eq(creditBatches.facilityId, facilityId),
            isNull(creditBatches.archivedAt),
          ),
        )
        .groupBy(creditBatches.status),
    ]);

  return {
    feedstocks: feedstockRows,
    productionRuns: runRows,
    biocharProducts: productRows,
    deliveries: deliveryRows,
    applications: applicationRows,
    creditBatches: batchRows,
  };
}

/** Suppliers actually feeding this facility (distinct across its feedstocks). */
async function loadSupplierCount(ctx: OrgContext, facilityId: string): Promise<number> {
  const [row] = await db
    .select({ count: countDistinct(feedstocks.supplierId) })
    .from(feedstocks)
    .where(
      and(
        eq(feedstocks.organizationId, ctx.organizationId),
        eq(feedstocks.facilityId, facilityId),
        isNull(feedstocks.archivedAt),
        isNotNull(feedstocks.supplierId),
      ),
    );
  return Number(row?.count ?? 0);
}

async function loadApplicationEvidenceGapCount(
  ctx: OrgContext,
  facilityId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    )
    .where(applicationEvidenceGapWhere(ctx.organizationId, facilityId));
  return Number(row?.count ?? 0);
}

/** Complete runs missing a mass reading — the production station's badge. */
async function loadRunsMissingMassCount(
  ctx: OrgContext,
  facilityId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(productionRuns)
    .where(runsMissingMassWhere(ctx.organizationId, facilityId));
  return Number(row?.count ?? 0);
}

/** Biochar products not linked to a production run — the biochar station's badge. */
async function loadProductsUnlinkedCount(
  ctx: OrgContext,
  facilityId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(biocharProducts)
    .where(productsUnlinkedWhere(ctx.organizationId, facilityId));
  return Number(row?.count ?? 0);
}

// Samples anchor on the credit batch (issue #309): a batch with zero pooled
// samples has no chemistry behind its carbon figures.
async function loadBatchesWithoutSamplesCount(
  ctx: OrgContext,
  facilityId: string,
): Promise<number> {
  const sampleCounts = db
    .select({
      creditBatchId: samples.creditBatchId,
      sampleCount: countRows().as("sample_count"),
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

async function loadRecentBatches(
  ctx: OrgContext,
  facilityId: string,
): Promise<DashboardCertificationBatch[]> {
  const rows = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
    })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.archivedAt),
      ),
    )
    .orderBy(desc(creditBatches.createdAt))
    .limit(CERTIFICATION_BATCH_ROWS);

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status as DashboardCreditBatchStatus,
  }));
}

// ============================================
// Activity feed
// ============================================

async function loadActivity(
  ctx: OrgContext,
  facilityId: string,
): Promise<DashboardActivityItem[]> {
  const [feedstockRows, runRows, deliveryRows, applicationRows, batchRows] =
    await Promise.all([
      db
        .select({
          id: feedstocks.id,
          code: feedstocks.code,
          date: feedstocks.deliveryDate,
        })
        .from(feedstocks)
        .where(
          and(
            eq(feedstocks.organizationId, ctx.organizationId),
            eq(feedstocks.facilityId, facilityId),
            isNull(feedstocks.archivedAt),
            isNotNull(feedstocks.deliveryDate),
          ),
        )
        .orderBy(desc(feedstocks.deliveryDate))
        .limit(ACTIVITY_PER_ENTITY),
      db
        .select({
          id: productionRuns.id,
          code: productionRuns.code,
          date: productionRuns.endTime,
        })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.organizationId, ctx.organizationId),
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
          id: deliveries.id,
          code: deliveries.code,
          date: deliveries.deliveryDate,
        })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.organizationId, ctx.organizationId),
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
          id: applications.id,
          code: applications.code,
          date: applications.applicationDate,
        })
        .from(applications)
        .innerJoin(
          deliveries,
          and(
            eq(applications.deliveryId, deliveries.id),
            eq(deliveries.organizationId, ctx.organizationId),
          ),
        )
        .where(
          and(
            eq(applications.organizationId, ctx.organizationId),
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
          id: creditBatches.id,
          code: creditBatches.code,
          date: creditBatches.createdAt,
        })
        .from(creditBatches)
        .where(
          and(
            eq(creditBatches.organizationId, ctx.organizationId),
            eq(creditBatches.facilityId, facilityId),
            isNull(creditBatches.archivedAt),
          ),
        )
        .orderBy(desc(creditBatches.createdAt))
        .limit(ACTIVITY_PER_ENTITY),
    ]);

  const toIso = (value: string | Date | null): string | null => {
    if (value == null) return null;
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };

  const items: (DashboardActivityItem & { ms: number })[] = [];
  const push = (
    idPrefix: string,
    rows: { id: string; code: string; date: string | Date | null }[],
    title: string,
    href: string,
  ) => {
    for (const row of rows) {
      const iso = toIso(row.date);
      if (iso == null) continue;
      items.push({
        id: `${idPrefix}-${row.id}`,
        code: row.code,
        title,
        dateIso: iso,
        href,
        ms: Date.parse(iso),
      });
    }
  };

  push("feedstock", feedstockRows, "Feedstock received", facilityHref("/feedstocks", facilityId));
  push("run", runRows, "Production run completed", facilityHref("/production-runs", facilityId));
  push("delivery", deliveryRows, "Delivery completed", facilityHref("/deliveries", facilityId));
  push("application", applicationRows, "Biochar applied to soil", facilityHref("/applications", facilityId));
  for (const row of batchRows) {
    const iso = toIso(row.date);
    if (iso == null) continue;
    items.push({
      id: `batch-${row.id}`,
      code: row.code,
      title: "Credit batch created",
      dateIso: iso,
      href: `/credit-batches/${row.id}`,
      ms: Date.parse(iso),
    });
  }

  return items
    .sort((a, b) => b.ms - a.ms)
    .slice(0, ACTIVITY_TOTAL)
    .map((item) => ({
      id: item.id,
      code: item.code,
      title: item.title,
      dateIso: item.dateIso,
      href: item.href,
    }));
}

// ============================================
// Aggregate
// ============================================

export async function getDashboardStations(
  ctx: OrgContext,
  facilityId: string,
): Promise<DashboardStationsData> {
  requireOrgScope(ctx);

  const [
    counts,
    supplierCount,
    evidenceGaps,
    runsMissingMass,
    productsUnlinked,
    batchesWithoutSamples,
    batches,
    activity,
  ] = await Promise.all([
    loadStatusCounts(ctx, facilityId),
    loadSupplierCount(ctx, facilityId),
    loadApplicationEvidenceGapCount(ctx, facilityId),
    loadRunsMissingMassCount(ctx, facilityId),
    loadProductsUnlinkedCount(ctx, facilityId),
    loadBatchesWithoutSamplesCount(ctx, facilityId),
    loadRecentBatches(ctx, facilityId),
    loadActivity(ctx, facilityId),
  ]);

  const feedstockTotal = totalCount(counts.feedstocks);
  const feedstockMissing = countByStatus(counts.feedstocks, ["missing_data"]);
  const runTotal = totalCount(counts.productionRuns);
  const runningRuns = countByStatus(counts.productionRuns, ["running"]);
  const productTotal = totalCount(counts.biocharProducts);
  const deliveryTotal = totalCount(counts.deliveries);
  const deliveriesUpcoming = countByStatus(counts.deliveries, ["upcoming"]);
  const applicationTotal = totalCount(counts.applications);

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
          ? [{ tone: "wait", text: `${plural(feedstockMissing, "record")} missing data` }]
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
          ? [{ tone: "wait" as const, text: `${plural(runsMissingMass, "run")} missing mass data` }]
          : []),
        ...(runningRuns > 0
          ? [{ tone: "run" as const, text: `${runningRuns} running now` }]
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
          ? [{ tone: "wait", text: `${plural(productsUnlinked, "product")} not linked to a run` }]
          : [],
      href: facilityHref("/biochar-products", facilityId),
    },
    {
      key: "deliveries",
      name: "Delivery",
      total: deliveryTotal,
      totalLabel: plural(deliveryTotal, "delivery", "deliveries"),
      attention: deliveriesUpcoming,
      reasons:
        deliveriesUpcoming > 0
          ? [{ tone: "wait", text: `${plural(deliveriesUpcoming, "upcoming delivery", "upcoming deliveries")}` }]
          : [],
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
          ? [{ tone: "wait", text: `${plural(evidenceGaps, "evidence gap")}` }]
          : [],
      href: facilityHref("/applications", facilityId),
    },
  ];

  return {
    stations,
    runningRuns,
    activity,
    certification: {
      totalBatches: totalCount(counts.creditBatches),
      pendingBatches: countByStatus(counts.creditBatches, ["pending"]),
      batches,
      batchesWithoutSamples,
    },
  };
}
