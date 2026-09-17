/**
 * Dashboard overview data access — the Flow Hero dashboard's single aggregate
 * read. Period-scoped numbers (the 4-KPI band with deltas vs the previous
 * equal period, and the 5-segment mass flow along the traceability chain)
 * plus the range-independent station/activity/certification snapshot from
 * `dashboard-stations.ts` and the needs-attention queue (cheap checks derived
 * from existing MRV records — no separate task lifecycle, an item disappears
 * when the record is fixed).
 *
 * Deliberately lean: row-level fetches are facility-scoped and column-narrow,
 * aggregation happens in JS — facilities operate at hundreds of records, not
 * millions, and this keeps the module free of fragile SQL bucketing. Round
 * trips are budgeted by `tests/dashboard-query-budget.test.ts`.
 */
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  creditBatches,
  deliveries,
  feedstocks,
  productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { computeClampedDryMass } from "@/lib/calculations/mass-dry";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  ne,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { getCo2eStoredPreviews } from "./credit-batches";
import {
  applicationEvidenceGapWhere,
  feedstocksMissingDataWhere,
  overdueBatchesWhere,
  productsUnlinkedWhere,
  runsMissingMassWhere,
} from "./dashboard-attention";
import {
  getDashboardStations,
  type DashboardStationsData,
} from "./dashboard-stations";
import {
  buildDashboardStructuralGaps,
  loadDashboardStructuralGapCounts,
  type DashboardStructuralGap,
} from "./dashboard-structural-gaps";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

// Re-exported so components import every dashboard type from one module.
export type {
  DashboardActivityItem,
  DashboardCertification,
  DashboardCertificationBatch,
  DashboardCreditBatchStatus,
  DashboardStation,
  DashboardStationKey,
  DashboardStationReason,
  DashboardStationState
} from "./dashboard-stations";

export type DashboardRange = "week" | "month" | "all";

/** Per-check row cap for the attention queue (the queue is a sample, not a list page). */
const ATTENTION_PER_CHECK = 4;
/** Total attention-queue cap, flags first. */
const ATTENTION_TOTAL = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

function productionRunHref(facilityId: string, productionRunId: string): string {
  const params = new URLSearchParams({
    facility: facilityId,
    run: productionRunId,
  });
  return `/production-runs?${params.toString()}`;
}

export type DashboardKpiKey =
  | "feedstockProcessed"
  | "biocharProduced"
  | "appliedToSoil"
  | "co2eStored";

export interface DashboardKpi {
  key: DashboardKpiKey;
  label: string;
  /** Display unit, e.g. "t", "tCO₂e". */
  unit: string;
  /** Null = no data in range (render "Not available", not 0). */
  value: number | null;
  /** Percent change vs the previous equal-length period; null when not comparable. */
  deltaPercent: number | null;
  /** One-line context, e.g. "8 runs in period". */
  detail: string;
}

export type DashboardMassFlowKey =
  | "delivered"
  | "intoRuns"
  | "produced"
  | "bagged"
  | "applied";

/**
 * One traceability-chain segment (supplier→feedstock, …, delivery→application)
 * for the selected period — the scene's mass chips and flow ribbons.
 */
export interface DashboardMassFlowSegment {
  key: DashboardMassFlowKey;
  /** Dry tonnes moved through the segment in the period. */
  tonnes: number;
}

export interface DashboardAttentionItem {
  id: string;
  /** Entity code shown in the mono column, e.g. "PR-26-0042". */
  entityCode: string;
  /** Canonical record date shown beside the entity code. */
  date: string | Date | null;
  title: string;
  href: string;
}

export interface DashboardOverview extends DashboardStationsData {
  range: DashboardRange;
  /** Server time the snapshot was built (ISO) — drives the header "updated" stamp. */
  generatedAt: string;
  kpis: DashboardKpi[];
  /** Chain segments in flow order, supplier → application. */
  massFlow: DashboardMassFlowSegment[];
  /** Capped sample of open items shown as rows (flags first). */
  attention: DashboardAttentionItem[];
  /** Cross-cutting certification blockers, kept separate from station badges. */
  structuralGaps: DashboardStructuralGap[];
  /** Exact uncapped count of open items — the "N open" figure. */
  attentionTotal: number;
}

interface RangeBounds {
  /** Current-period start (ms); null = unbounded ("all"). */
  startMs: number | null;
  /** Previous-period start (ms); null when no delta comparison applies. */
  previousStartMs: number | null;
  nowMs: number;
}

function resolveRange(range: DashboardRange): RangeBounds {
  const nowMs = Date.now();
  if (range === "all") {
    return { startMs: null, previousStartMs: null, nowMs };
  }
  const spanMs = (range === "week" ? WEEK_DAYS : MONTH_DAYS) * DAY_MS;
  return {
    startMs: nowMs - spanMs,
    previousStartMs: nowMs - 2 * spanMs,
    nowMs,
  };
}

/** Date-only columns ("YYYY-MM-DD") parse as UTC midnight — good enough for bucketing. */
function toMs(value: string | Date | null): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function inCurrentPeriod(ms: number, bounds: RangeBounds) {
  return (bounds.startMs == null || ms >= bounds.startMs) && ms <= bounds.nowMs;
}

function inPreviousPeriod(ms: number, bounds: RangeBounds) {
  if (bounds.previousStartMs == null || bounds.startMs == null) return false;
  return ms >= bounds.previousStartMs && ms < bounds.startMs;
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export async function getDashboardOverview(
  ctx: OrgContext,
  facilityId: string,
  range: DashboardRange,
): Promise<DashboardOverview> {
  requireOrgScope(ctx);

  const bounds = resolveRange(range);
  // One clock read for the overdue-batch list and its uncapped count.
  const todayStr = new Date().toISOString().slice(0, 10);
  // Fetch back to the previous-period start so delta needs no second query.
  const fetchStart =
    bounds.previousStartMs == null ? null : new Date(bounds.previousStartMs);

  // Derived CO₂e stored per batch (issue #285): the same preview figure the
  // credit-batch detail page shows — the stored column no longer exists.
  // The walk is set-based (one lineage read for every batch id), so it starts
  // as soon as the batch rows are known instead of after the whole fan-out.
  const batchesWithPreviews = db
    .select({
      id: creditBatches.id,
      endDate: creditBatches.endDate,
    })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, facilityId),
        isNull(creditBatches.archivedAt),
        ne(creditBatches.status, "rejected"),
        ...(fetchStart
          ? [gte(creditBatches.endDate, fetchStart.toISOString().slice(0, 10))]
          : []),
      ),
    )
    .then(async (rows) => ({
      rows,
      previews: await getCo2eStoredPreviews(
        ctx,
        rows.map((row) => row.id),
      ),
    }));

  const [
    [runRows, lotRows, applicationRows, { rows: batchRows, previews: batchPreviews }, feedstockRows],
    attentionItems,
    { overdueBatches, ...stationsData },
    structuralGapCounts,
  ] =
    await Promise.all([
      Promise.all([
        db
          .select({
            date: productionRunDateExpr(),
            feedstockMassDryKg: productionRuns.feedstockMassDryKg,
            biocharDryMassKg: productionRuns.biocharDryMassKg,
          })
          .from(productionRuns)
          .where(
            and(
              eq(productionRuns.organizationId, ctx.organizationId),
              eq(productionRuns.facilityId, facilityId),
              isNull(productionRuns.archivedAt),
              eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
              ...(fetchStart
                ? [gte(productionRunDateExpr(), fetchStart.toISOString().slice(0, 10))]
                : []),
            ),
          ),
        db
          .select({
            productionDate: biocharProducts.productionDate,
            massKg: biocharProducts.massKg,
            moistureContentPercent: biocharProducts.moistureContentPercent,
          })
          .from(biocharProducts)
          .where(
            and(
              eq(biocharProducts.organizationId, ctx.organizationId),
              eq(biocharProducts.facilityId, facilityId),
              isNull(biocharProducts.archivedAt),
              ne(biocharProducts.status, "draft"),
              ...(fetchStart ? [gte(biocharProducts.productionDate, fetchStart)] : []),
            ),
          ),
        db
          .select({
            applicationDate: applications.applicationDate,
            biocharAppliedDryTons: applications.biocharAppliedDryTons,
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
              // Only material actually applied to soil counts toward KPI/mass
              // flow; `delivered` applications are not yet on the field.
              eq(applications.status, "applied"),
              ...(fetchStart ? [gte(applications.applicationDate, fetchStart)] : []),
            ),
          ),
        batchesWithPreviews,
        db
          .select({
            massDryKg: feedstocks.massDryKg,
            deliveryDate: feedstocks.deliveryDate,
          })
          .from(feedstocks)
          .where(
            and(
              eq(feedstocks.organizationId, ctx.organizationId),
              eq(feedstocks.facilityId, facilityId),
              isNull(feedstocks.archivedAt),
              ...(fetchStart ? [gte(feedstocks.deliveryDate, fetchStart)] : []),
            ),
          ),
      ]),
      getAttentionItems(ctx, facilityId, todayStr),
      getDashboardStations(ctx, facilityId, todayStr),
      loadDashboardStructuralGapCounts(ctx, facilityId),
    ]);

  const storedTonnesOf = (batchId: string): number | null =>
    batchPreviews[batchId]?.co2eStoredTonnes ?? null;

  // ---- normalize to dated points -----------------------------------------

  const runPoints = runRows
    .map((row) => ({ ms: toMs(row.date), row }))
    .filter((p): p is { ms: number; row: (typeof runRows)[number] } => p.ms != null);
  const lotPoints = lotRows
    .map((row) => ({ ms: toMs(row.productionDate), row }))
    .filter((p): p is { ms: number; row: (typeof lotRows)[number] } => p.ms != null);
  const applicationPoints = applicationRows
    .map((row) => ({ ms: toMs(row.applicationDate), row }))
    .filter(
      (p): p is { ms: number; row: (typeof applicationRows)[number] } =>
        p.ms != null,
    );
  const batchPoints = batchRows
    .map((row) => ({ ms: toMs(row.endDate), row }))
    .filter((p): p is { ms: number; row: (typeof batchRows)[number] } => p.ms != null);

  // ---- KPI assembly --------------------------------------------------------

  const currentRuns = runPoints.filter((p) => inCurrentPeriod(p.ms, bounds));
  const previousRuns = runPoints.filter((p) => inPreviousPeriod(p.ms, bounds));

  const currentFeedstockRuns = currentRuns.filter(
    (p) => p.row.feedstockMassDryKg != null,
  );
  const previousFeedstockRuns = previousRuns.filter(
    (p) => p.row.feedstockMassDryKg != null,
  );
  const currentOutputRuns = currentRuns.filter(
    (p) => p.row.biocharDryMassKg != null,
  );
  const previousOutputRuns = previousRuns.filter(
    (p) => p.row.biocharDryMassKg != null,
  );

  const feedstockInCurrentKg = sum(
    currentFeedstockRuns.map((p) => p.row.feedstockMassDryKg ?? 0),
  );
  const feedstockInPreviousKg = sum(
    previousFeedstockRuns.map((p) => p.row.feedstockMassDryKg ?? 0),
  );
  const outputCurrentKg = sum(
    currentOutputRuns.map((p) => p.row.biocharDryMassKg ?? 0),
  );
  const outputPreviousKg = sum(
    previousOutputRuns.map((p) => p.row.biocharDryMassKg ?? 0),
  );

  const currentApplications = applicationPoints.filter((p) =>
    inCurrentPeriod(p.ms, bounds),
  );
  const previousApplications = applicationPoints.filter((p) =>
    inPreviousPeriod(p.ms, bounds),
  );
  const appliedCurrentTons = sum(
    currentApplications.map((p) => p.row.biocharAppliedDryTons ?? 0),
  );
  const appliedPreviousTons = sum(
    previousApplications.map((p) => p.row.biocharAppliedDryTons ?? 0),
  );

  const currentBatches = batchPoints.filter((p) => inCurrentPeriod(p.ms, bounds));
  const previousBatches = batchPoints.filter((p) => inPreviousPeriod(p.ms, bounds));
  const currentStoredBatches = currentBatches.filter(
    (p) => storedTonnesOf(p.row.id) != null,
  );
  const previousStoredBatches = previousBatches.filter(
    (p) => storedTonnesOf(p.row.id) != null,
  );
  const storedCurrentTons = sum(
    currentStoredBatches.map((p) => storedTonnesOf(p.row.id) ?? 0),
  );
  const storedPreviousTons = sum(
    previousStoredBatches.map((p) => storedTonnesOf(p.row.id) ?? 0),
  );

  const kpis: DashboardKpi[] = [
    {
      key: "feedstockProcessed",
      label: "Feedstock processed",
      unit: "t",
      value:
        currentFeedstockRuns.length > 0 ? feedstockInCurrentKg / 1000 : null,
      deltaPercent:
        range === "all" || currentFeedstockRuns.length === 0
          ? null
          : deltaPercent(feedstockInCurrentKg, feedstockInPreviousKg),
      detail:
        currentFeedstockRuns.length > 0
          ? `dry mass into ${currentFeedstockRuns.length} ${currentFeedstockRuns.length === 1 ? "run" : "runs"}`
          : "no measured runs in period",
    },
    {
      key: "biocharProduced",
      label: "Biochar produced",
      unit: "t",
      value: currentOutputRuns.length > 0 ? outputCurrentKg / 1000 : null,
      deltaPercent:
        range === "all" || currentOutputRuns.length === 0
          ? null
          : deltaPercent(outputCurrentKg, outputPreviousKg),
      detail:
        currentOutputRuns.length > 0
          ? "dry mass out of the reactors"
          : "no measured runs in period",
    },
    {
      key: "appliedToSoil",
      label: "Applied to soil",
      unit: "t",
      value: currentApplications.length > 0 ? appliedCurrentTons : null,
      deltaPercent:
        range === "all"
          ? null
          : deltaPercent(appliedCurrentTons, appliedPreviousTons),
      detail: `${currentApplications.length} ${currentApplications.length === 1 ? "application" : "applications"}`,
    },
    {
      key: "co2eStored",
      label: "CO₂e stored",
      unit: "t",
      value: currentStoredBatches.length > 0 ? storedCurrentTons : null,
      deltaPercent:
        range === "all" || currentStoredBatches.length === 0
          ? null
          : deltaPercent(storedCurrentTons, storedPreviousTons),
      detail:
        currentStoredBatches.length > 0
          ? `${currentStoredBatches.length} ${currentStoredBatches.length === 1 ? "credit batch" : "credit batches"}`
          : "no verified storage in period",
    },
  ];

  // ---- mass flow along the chain -------------------------------------------

  const feedstockPoints = feedstockRows.map((row) => ({
    ms: toMs(row.deliveryDate),
    row,
  }));
  // Feedstocks may predate the delivery-date backfill; undated rows only
  // count in the unbounded "all" period rather than inventing a date.
  const deliveredKg = sum(
    feedstockPoints
      .filter((p) =>
        p.ms == null ? bounds.startMs == null : inCurrentPeriod(p.ms, bounds),
      )
      .map((p) => p.row.massDryKg),
  );
  const currentLots = lotPoints.filter((p) => inCurrentPeriod(p.ms, bounds));
  // Dry kg end to end: `massKg` is the lot's wet mass, so derive dry via the
  // recorded moisture (biochar runs 1–2%); a lot without a moisture reading
  // counts at wet mass rather than vanishing from the segment.
  const lotDryKg = (row: (typeof lotRows)[number]) =>
    computeClampedDryMass(row.massKg, row.moistureContentPercent) ??
    row.massKg ??
    0;
  const baggedKg = sum(currentLots.map((p) => lotDryKg(p.row)));

  const massFlow: DashboardMassFlowSegment[] = [
    { key: "delivered", tonnes: deliveredKg / 1000 },
    { key: "intoRuns", tonnes: feedstockInCurrentKg / 1000 },
    { key: "produced", tonnes: outputCurrentKg / 1000 },
    { key: "bagged", tonnes: baggedKg / 1000 },
    { key: "applied", tonnes: tonnesToKg(appliedCurrentTons) / 1000 },
  ];

  // Every attention check except overdue batches maps 1:1 to a flow station,
  // and the station badge counts are exact (uncapped) — so the true queue size
  // is their sum plus the batch-only count, without re-running the row queries.
  const structuralGaps = buildDashboardStructuralGaps(
    structuralGapCounts,
    facilityId,
  );
  const structuralGapTotal = structuralGaps.reduce(
    (total, gap) => total + gap.count,
    0,
  );
  const attentionTotal =
    stationsData.stations.reduce((acc, station) => acc + station.attention, 0) +
    overdueBatches +
    structuralGapTotal;

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis,
    massFlow,
    attention: attentionItems,
    structuralGaps,
    attentionTotal,
    ...stationsData,
  };
}

// ============================================
// Needs-attention queue
// ============================================

type AttentionKind =
  | "run-mass"
  | "lot-unlinked"
  | "feedstock-missing"
  | "application-evidence"
  | "batch-pending";

function attentionKind(kind: AttentionKind): SQL<AttentionKind> {
  return sql<AttentionKind>`${kind}::text`;
}

const MS_PER_SECOND = 1_000;

/**
 * Record dates come from two column families. A `date` column stays the
 * 'YYYY-MM-DD' text it always was; a `timestamp` column travels as epoch
 * milliseconds and is rebuilt as a `Date` in JS, so the UTC instant survives
 * the union instead of turning into zone-less text.
 */
function dayColumn(column: SQLWrapper): SQL<string | null> {
  return sql<string | null>`${column}::text`;
}
const noDay = sql<string | null>`null::text`;
function instantColumn(column: SQLWrapper): SQL<number | null> {
  return sql<number | null>`(extract(epoch from ${column}) * ${MS_PER_SECOND})`.mapWith(
    (value) => (value == null ? null : Number(value)),
  );
}
const noInstant = sql<number | null>`null::double precision`;
/** Position within the branch's own ORDER BY; `union all` does not keep it. */
function branchOrdinal(orderBy: SQL): SQL<number> {
  return sql<number>`row_number() over (order by ${orderBy})`.mapWith(Number);
}

interface AttentionRow {
  kind: AttentionKind;
  id: string;
  code: string;
  dateDay: string | null;
  dateMs: number | null;
  ord: number;
}

const ATTENTION_TITLES: Record<AttentionKind, string> = {
  "run-mass": "Complete run missing mass data",
  "lot-unlinked": "Production run not linked",
  "feedstock-missing": "Feedstock record missing data",
  "application-evidence": "Application missing evidence",
  "batch-pending": "Period ended · awaiting verification",
};

/** Flags sort before pending batches; within a kind the branch ordinal holds. */
const ATTENTION_ORDER: AttentionKind[] = [
  "run-mass",
  "lot-unlinked",
  "feedstock-missing",
  "application-evidence",
  "batch-pending",
];

function attentionHref(
  kind: AttentionKind,
  id: string,
  facilityId: string,
): string {
  const facilityQuery = `?facility=${facilityId}`;
  switch (kind) {
    case "run-mass":
      return productionRunHref(facilityId, id);
    case "lot-unlinked":
      return `/biochar-products${facilityQuery}`;
    case "feedstock-missing":
      return `/feedstocks${facilityQuery}`;
    case "application-evidence":
      return `/applications${facilityQuery}`;
    case "batch-pending":
      return creditBatchDeepLinkHref(id, facilityId);
  }
}

/**
 * Cheap record checks derived from existing MRV data, fetched as one
 * `union all` of capped, narrow, indexed selects. An item disappears the
 * moment the underlying record is fixed (no independent lifecycle). The
 * uncapped overdue-batch count comes from the station aggregates.
 */
async function getAttentionItems(
  ctx: OrgContext,
  facilityId: string,
  todayStr: string,
): Promise<DashboardAttentionItem[]> {
  const orgId = ctx.organizationId;

  const rows: AttentionRow[] = await unionAll(
    db
      .select({
        kind: attentionKind("run-mass"),
        id: productionRuns.id,
        code: productionRuns.code,
        dateDay: dayColumn(productionRunDateExpr()),
        dateMs: noInstant,
        ord: branchOrdinal(desc(productionRuns.startTime)),
      })
      .from(productionRuns)
      .where(runsMissingMassWhere(orgId, facilityId))
      .orderBy(desc(productionRuns.startTime))
      .limit(ATTENTION_PER_CHECK),
    db
      .select({
        kind: attentionKind("lot-unlinked"),
        id: biocharProducts.id,
        code: biocharProducts.code,
        dateDay: noDay,
        dateMs: instantColumn(biocharProducts.productionDate),
        ord: branchOrdinal(desc(biocharProducts.productionDate)),
      })
      .from(biocharProducts)
      .where(productsUnlinkedWhere(orgId, facilityId))
      .orderBy(desc(biocharProducts.productionDate))
      .limit(ATTENTION_PER_CHECK),
    db
      .select({
        kind: attentionKind("feedstock-missing"),
        id: feedstocks.id,
        code: feedstocks.code,
        dateDay: noDay,
        dateMs: instantColumn(
          sql`coalesce(${feedstocks.deliveryDate}, ${feedstocks.createdAt})`,
        ),
        ord: branchOrdinal(desc(feedstocks.createdAt)),
      })
      .from(feedstocks)
      .where(feedstocksMissingDataWhere(orgId, facilityId))
      .orderBy(desc(feedstocks.createdAt))
      .limit(ATTENTION_PER_CHECK),
    db
      .select({
        kind: attentionKind("application-evidence"),
        id: applications.id,
        code: applications.code,
        dateDay: noDay,
        dateMs: instantColumn(applications.applicationDate),
        ord: branchOrdinal(desc(applications.applicationDate)),
      })
      .from(applications)
      .innerJoin(
        deliveries,
        and(
          eq(applications.deliveryId, deliveries.id),
          eq(deliveries.organizationId, orgId),
        ),
      )
      .where(applicationEvidenceGapWhere(orgId, facilityId))
      .orderBy(desc(applications.applicationDate))
      .limit(ATTENTION_PER_CHECK),
    db
      .select({
        kind: attentionKind("batch-pending"),
        id: creditBatches.id,
        code: creditBatches.code,
        dateDay: dayColumn(creditBatches.endDate),
        dateMs: noInstant,
        ord: branchOrdinal(asc(creditBatches.endDate)),
      })
      .from(creditBatches)
      // Redundant org predicate for the lexical guard (see note above).
      .where(
        and(
          overdueBatchesWhere(orgId, facilityId, todayStr),
          eq(creditBatches.organizationId, orgId),
        ),
      )
      .orderBy(asc(creditBatches.endDate))
      .limit(ATTENTION_PER_CHECK),
  );

  const rank = (kind: AttentionKind) => ATTENTION_ORDER.indexOf(kind);
  return rows
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.ord - b.ord)
    .slice(0, ATTENTION_TOTAL)
    .map((row) => ({
      id: `${row.kind}-${row.id}`,
      entityCode: row.code,
      date: row.dateDay ?? (row.dateMs == null ? null : new Date(row.dateMs)),
      title: ATTENTION_TITLES[row.kind],
      href: attentionHref(row.kind, row.id, facilityId),
    }));
}
