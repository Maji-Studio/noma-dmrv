/**
 * Dashboard overview data access (visual design plan, Phase 5).
 *
 * One facility-scoped aggregate read powering the dashboard: the 5-KPI strip
 * (value + delta vs the previous equal period + a 12-bucket sparkline series),
 * the needs-attention queue (cheap checks derived from existing MRV records —
 * no separate task lifecycle, the item disappears when the record is fixed),
 * the feedstock mix, and the custody-flow ribbon (the batch Sankey's
 * mass-balance grammar via `buildStageFlow`).
 *
 * Deliberately lean: row-level fetches are facility-scoped and column-narrow,
 * aggregation happens in JS — facilities operate at hundreds of records, not
 * millions, and this keeps the module free of fragile SQL bucketing.
 */
import { and, asc, desc, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  creditBatches,
  deliveries,
  feedstocks,
  feedstockTypes,
  productionRuns,
} from "@/db/schema";
import {
  buildStageFlow,
  type CreditBatchSankeyData,
} from "@/lib/chain-of-custody/sankey";
import { computeClampedDryMass } from "@/lib/calculations/mass-dry";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { getCo2eStoredPreviews } from "./credit-batches";
import {
  getDashboardOperations,
  type DashboardEvidenceRow,
  type DashboardMapEdge,
  type DashboardMapPoint,
  type DashboardNowItem,
  type DashboardProgressStage,
} from "./dashboard-operations";
import { requireAuth } from "./utils";

// Re-exported so components import every dashboard type from one module.
export type {
  DashboardEvidenceRow,
  DashboardMapDetail,
  DashboardMapEdge,
  DashboardMapKind,
  DashboardMapPoint,
  DashboardNowItem,
  DashboardNowKind,
  DashboardNowStatus,
  DashboardProgressStage,
} from "./dashboard-operations";

export type DashboardRange = "30d" | "ytd" | "all";

/** Sparkline resolution — every KPI series carries exactly this many buckets. */
const SERIES_BUCKETS = 12;
/** Per-check row cap for the attention queue (the queue is a sample, not a list page). */
const ATTENTION_PER_CHECK = 4;
/** Total attention-queue cap, flags first. */
const ATTENTION_TOTAL = 8;
/** Feedstock-mix slices shown before collapsing the tail into "Other". */
const MIX_SLICES = 5;
/** Fallback window when range="all" finds no dated records. */
const ALL_RANGE_FALLBACK_DAYS = 365;

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
  | "pyrolysisYield"
  | "appliedToSoil"
  | "co2eStored";

export interface DashboardKpi {
  key: DashboardKpiKey;
  label: string;
  /** Display unit, e.g. "t", "%", "tCO₂e". */
  unit: string;
  /** Null = no data in range (render "—", not 0). */
  value: number | null;
  /** Percent change vs the previous equal-length period; null when not comparable. */
  deltaPercent: number | null;
  /** 12-bucket series across the range, oldest first. */
  series: number[];
  /** One-line context, e.g. "8 runs in period". */
  detail: string;
}

export interface DashboardAttentionItem {
  id: string;
  /** Entity code shown in the mono column, e.g. "PR-26-0042". */
  entityCode: string;
  title: string;
  severity: "flag" | "pending";
  href: string;
}

export interface DashboardFeedstockMixSlice {
  feedstockTypeId: string | null;
  name: string;
  massDryKg: number;
  /** Share of the period's total dry mass, 0–100. */
  percent: number;
}

export interface DashboardOverview {
  range: DashboardRange;
  /** Server time the snapshot was built (ISO) — drives the header "updated" stamp. */
  generatedAt: string;
  kpis: DashboardKpi[];
  attention: DashboardAttentionItem[];
  feedstockMix: DashboardFeedstockMixSlice[];
  flow: CreditBatchSankeyData;
  /** Live signal: running runs + in-flight submissions (range-independent). */
  now: DashboardNowItem[];
  /** MRV pipeline funnel with per-stage needs-attention share. */
  progress: DashboardProgressStage[];
  /** Structural certification gaps (GPS, samples, transport provenance). */
  evidence: DashboardEvidenceRow[];
  /** Plottable sites for the dashboard traceability map. */
  mapPoints: DashboardMapPoint[];
  /** Directional traceability legs between the plotted sites. */
  mapEdges: DashboardMapEdge[];
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
  if (range === "ytd") {
    const startMs = new Date(new Date().getFullYear(), 0, 1).getTime();
    return { startMs, previousStartMs: startMs - (nowMs - startMs), nowMs };
  }
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  return {
    startMs: nowMs - THIRTY_DAYS_MS,
    previousStartMs: nowMs - 2 * THIRTY_DAYS_MS,
    nowMs,
  };
}

/** Date-only columns ("YYYY-MM-DD") parse as UTC midnight — good enough for bucketing. */
function toMs(value: string | Date | null): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

interface DatedValue {
  ms: number;
  value: number;
}

function inCurrentPeriod(ms: number, bounds: RangeBounds, allStartMs: number) {
  const start = bounds.startMs ?? allStartMs;
  return ms >= start && ms <= bounds.nowMs;
}

function inPreviousPeriod(ms: number, bounds: RangeBounds) {
  if (bounds.previousStartMs == null || bounds.startMs == null) return false;
  return ms >= bounds.previousStartMs && ms < bounds.startMs;
}

function bucketSeries(
  points: DatedValue[],
  startMs: number,
  endMs: number,
): number[] {
  const series = new Array<number>(SERIES_BUCKETS).fill(0);
  const span = Math.max(1, endMs - startMs);
  for (const point of points) {
    if (point.ms < startMs || point.ms > endMs) continue;
    const index = Math.min(
      SERIES_BUCKETS - 1,
      Math.max(0, Math.floor(((point.ms - startMs) / span) * SERIES_BUCKETS)),
    );
    series[index] += point.value;
  }
  return series;
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export async function getDashboardOverview(
  userId: string,
  facilityId: string,
  range: DashboardRange,
): Promise<DashboardOverview> {
  requireAuth(userId);

  const bounds = resolveRange(range);
  // Fetch back to the previous-period start so delta needs no second query.
  const fetchStart =
    bounds.previousStartMs == null ? null : new Date(bounds.previousStartMs);

  const [
    [runRows, lotRows, applicationRows, batchRows, feedstockRows],
    attention,
    operations,
  ] = await Promise.all([
    Promise.all([
      db
        .select({
          date: productionRuns.date,
          feedstockMassDryKg: productionRuns.feedstockMassDryKg,
          biocharDryMassKg: productionRuns.biocharDryMassKg,
        })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.facilityId, facilityId),
            isNull(productionRuns.archivedAt),
            ne(productionRuns.status, "void"),
            ...(fetchStart
              ? [gte(productionRuns.date, fetchStart.toISOString().slice(0, 10))]
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
        .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
        .where(
          and(
            eq(deliveries.facilityId, facilityId),
            isNull(deliveries.archivedAt),
            ...(fetchStart ? [gte(applications.applicationDate, fetchStart)] : []),
          ),
        ),
      db
        .select({
          id: creditBatches.id,
          endDate: creditBatches.endDate,
        })
        .from(creditBatches)
        .where(
          and(
            eq(creditBatches.facilityId, facilityId),
            isNull(creditBatches.archivedAt),
            ne(creditBatches.status, "rejected"),
            ...(fetchStart
              ? [gte(creditBatches.endDate, fetchStart.toISOString().slice(0, 10))]
              : []),
          ),
        ),
      db
        .select({
          feedstockTypeId: feedstocks.feedstockTypeId,
          typeName: feedstockTypes.name,
          massDryKg: feedstocks.massDryKg,
          deliveryDate: feedstocks.deliveryDate,
        })
        .from(feedstocks)
        .innerJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
        .where(
          and(
            eq(feedstocks.facilityId, facilityId),
            isNull(feedstocks.archivedAt),
            ...(fetchStart ? [gte(feedstocks.deliveryDate, fetchStart)] : []),
          ),
        ),
    ]),
    getAttentionItems(facilityId),
    getDashboardOperations(userId, facilityId),
  ]);

  // Derived CO₂e stored per batch (issue #285): the same preview figure the
  // credit-batch detail page shows — the stored column no longer exists.
  // The "all" period fetches every batch in the facility (fetchStart null),
  // so the helper's internal PREVIEW_FANOUT_CONCURRENCY chunking is what
  // keeps the per-batch chain-of-custody walks from bursting the pool.
  const batchPreviews = await getCo2eStoredPreviews(
    userId,
    batchRows.map((row) => row.id),
  );
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
  const feedstockPoints = feedstockRows.map((row) => ({
    // Feedstocks may predate the delivery-date backfill; created order keeps
    // them in the "all" range without inventing a date.
    ms: toMs(row.deliveryDate),
    row,
  }));

  // "all" range: anchor the series at the earliest dated record.
  const allDates = [
    ...runPoints.map((p) => p.ms),
    ...lotPoints.map((p) => p.ms),
    ...applicationPoints.map((p) => p.ms),
    ...batchPoints.map((p) => p.ms),
    ...feedstockPoints.map((p) => p.ms).filter((ms): ms is number => ms != null),
  ];
  const allStartMs =
    allDates.length > 0
      ? Math.min(...allDates)
      : bounds.nowMs - ALL_RANGE_FALLBACK_DAYS * 24 * 60 * 60 * 1000;
  const seriesStartMs = bounds.startMs ?? allStartMs;

  // ---- KPI assembly --------------------------------------------------------

  const currentRuns = runPoints.filter((p) =>
    inCurrentPeriod(p.ms, bounds, allStartMs),
  );
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

  // Yield only counts runs that recorded both sides of the conversion.
  const yieldRuns = currentRuns.filter(
    (p) => p.row.feedstockMassDryKg != null && p.row.biocharDryMassKg != null,
  );
  const yieldInKg = sum(yieldRuns.map((p) => p.row.feedstockMassDryKg ?? 0));
  const yieldOutKg = sum(yieldRuns.map((p) => p.row.biocharDryMassKg ?? 0));
  const previousYieldRuns = previousRuns.filter(
    (p) => p.row.feedstockMassDryKg != null && p.row.biocharDryMassKg != null,
  );
  const previousYieldInKg = sum(
    previousYieldRuns.map((p) => p.row.feedstockMassDryKg ?? 0),
  );
  const previousYieldOutKg = sum(
    previousYieldRuns.map((p) => p.row.biocharDryMassKg ?? 0),
  );

  const currentApplications = applicationPoints.filter((p) =>
    inCurrentPeriod(p.ms, bounds, allStartMs),
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

  const currentBatches = batchPoints.filter((p) =>
    inCurrentPeriod(p.ms, bounds, allStartMs),
  );
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

  const yieldSeriesIn = bucketSeries(
    yieldRuns.map((p) => ({ ms: p.ms, value: p.row.feedstockMassDryKg ?? 0 })),
    seriesStartMs,
    bounds.nowMs,
  );
  const yieldSeriesOut = bucketSeries(
    yieldRuns.map((p) => ({ ms: p.ms, value: p.row.biocharDryMassKg ?? 0 })),
    seriesStartMs,
    bounds.nowMs,
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
      series: bucketSeries(
        currentFeedstockRuns.map((p) => ({
          ms: p.ms,
          value: (p.row.feedstockMassDryKg ?? 0) / 1000,
        })),
        seriesStartMs,
        bounds.nowMs,
      ),
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
      series: bucketSeries(
        currentOutputRuns.map((p) => ({
          ms: p.ms,
          value: (p.row.biocharDryMassKg ?? 0) / 1000,
        })),
        seriesStartMs,
        bounds.nowMs,
      ),
      detail:
        currentOutputRuns.length > 0
          ? "dry mass out of the reactors"
          : "no measured runs in period",
    },
    {
      key: "pyrolysisYield",
      label: "Pyrolysis yield",
      unit: "%",
      value: yieldInKg > 0 ? (yieldOutKg / yieldInKg) * 100 : null,
      deltaPercent:
        range === "all" || previousYieldInKg <= 0 || yieldInKg <= 0
          ? null
          : deltaPercent(
              (yieldOutKg / yieldInKg) * 100,
              (previousYieldOutKg / previousYieldInKg) * 100,
            ),
      series: yieldSeriesIn.map((inKg, i) =>
        inKg > 0 ? (yieldSeriesOut[i] / inKg) * 100 : 0,
      ),
      detail:
        yieldInKg > 0
          ? `${(yieldInKg / 1000).toFixed(1)} t in → ${(yieldOutKg / 1000).toFixed(1)} t out`
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
      series: bucketSeries(
        currentApplications.map((p) => ({
          ms: p.ms,
          value: p.row.biocharAppliedDryTons ?? 0,
        })),
        seriesStartMs,
        bounds.nowMs,
      ),
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
      series: bucketSeries(
        currentStoredBatches.map((p) => ({
          ms: p.ms,
          value: storedTonnesOf(p.row.id) ?? 0,
        })),
        seriesStartMs,
        bounds.nowMs,
      ),
      detail:
        currentStoredBatches.length > 0
          ? `${currentStoredBatches.length} ${currentStoredBatches.length === 1 ? "credit batch" : "credit batches"}`
          : "no verified storage in period",
    },
  ];

  // ---- feedstock mix --------------------------------------------------------

  const mixFeedstocks = feedstockPoints.filter(
    (p) =>
      p.ms == null
        ? bounds.startMs == null
        : inCurrentPeriod(p.ms, bounds, allStartMs),
  );
  const mixByType = new Map<string, DashboardFeedstockMixSlice>();
  for (const { row } of mixFeedstocks) {
    const existing = mixByType.get(row.feedstockTypeId);
    if (existing) {
      existing.massDryKg += row.massDryKg;
    } else {
      mixByType.set(row.feedstockTypeId, {
        feedstockTypeId: row.feedstockTypeId,
        name: row.typeName,
        massDryKg: row.massDryKg,
        percent: 0,
      });
    }
  }
  const mixSorted = Array.from(mixByType.values()).sort(
    (a, b) => b.massDryKg - a.massDryKg,
  );
  const mixHead = mixSorted.slice(0, MIX_SLICES);
  const mixTailKg = sum(mixSorted.slice(MIX_SLICES).map((s) => s.massDryKg));
  if (mixTailKg > 0) {
    mixHead.push({
      feedstockTypeId: null,
      name: "Other",
      massDryKg: mixTailKg,
      percent: 0,
    });
  }
  const mixTotalKg = sum(mixHead.map((s) => s.massDryKg));
  const feedstockMix = mixHead.map((slice) => ({
    ...slice,
    percent: mixTotalKg > 0 ? (slice.massDryKg / mixTotalKg) * 100 : 0,
  }));

  // ---- custody flow ribbon --------------------------------------------------

  const currentLots = lotPoints.filter((p) =>
    inCurrentPeriod(p.ms, bounds, allStartMs),
  );
  // The flow is dry kg end to end: `massKg` is the lot's wet mass, so derive
  // dry via the recorded moisture (biochar runs 1–2%); a lot without a
  // moisture reading counts at wet mass rather than vanishing into the
  // "not bagged into lots" exit.
  const lotDryKg = (row: (typeof lotRows)[number]) =>
    computeClampedDryMass(row.massKg, row.moistureContentPercent) ??
    row.massKg ??
    0;
  const flow = buildStageFlow({
    feedstockInKg: feedstockInCurrentKg,
    runOutputKg: outputCurrentKg,
    lotMassKg: sum(currentLots.map((p) => lotDryKg(p.row))),
    appliedKg: tonnesToKg(appliedCurrentTons),
    counts: {
      feedstocks: mixFeedstocks.length,
      productionRuns: currentRuns.length,
      biocharLots: currentLots.length,
      applications: currentApplications.length,
    },
  });

  return {
    range,
    generatedAt: operations.generatedAt,
    kpis,
    attention,
    feedstockMix,
    flow,
    now: operations.now,
    progress: operations.progress,
    evidence: operations.evidence,
    mapPoints: operations.mapPoints,
    mapEdges: operations.mapEdges,
  };
}

// ============================================
// Needs-attention queue
// ============================================

/**
 * Cheap record checks derived from existing MRV data. Each check is one
 * narrow indexed query with a row cap; an item disappears the moment the
 * underlying record is fixed (no independent lifecycle).
 */
async function getAttentionItems(
  facilityId: string,
): Promise<DashboardAttentionItem[]> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [runsMissingMass, unlinkedLots, feedstocksMissingData, upcomingDeliveries, batchesAwaitingVerification] =
    await Promise.all([
      db
        .select({ id: productionRuns.id, code: productionRuns.code })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.facilityId, facilityId),
            isNull(productionRuns.archivedAt),
            eq(productionRuns.status, "complete"),
            or(
              isNull(productionRuns.biocharDryMassKg),
              isNull(productionRuns.feedstockMassDryKg),
            ),
          ),
        )
        .orderBy(desc(productionRuns.date))
        .limit(ATTENTION_PER_CHECK),
      db
        .select({ id: biocharProducts.id, code: biocharProducts.code })
        .from(biocharProducts)
        .where(
          and(
            eq(biocharProducts.facilityId, facilityId),
            isNull(biocharProducts.archivedAt),
            isNull(biocharProducts.linkedProductionRunId),
          ),
        )
        .orderBy(desc(biocharProducts.productionDate))
        .limit(ATTENTION_PER_CHECK),
      db
        .select({ id: feedstocks.id, code: feedstocks.code })
        .from(feedstocks)
        .where(
          and(
            eq(feedstocks.facilityId, facilityId),
            isNull(feedstocks.archivedAt),
            eq(feedstocks.status, "missing_data"),
          ),
        )
        .orderBy(desc(feedstocks.createdAt))
        .limit(ATTENTION_PER_CHECK),
      db
        .select({ id: deliveries.id, code: deliveries.code })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.facilityId, facilityId),
            isNull(deliveries.archivedAt),
            eq(deliveries.status, "upcoming"),
          ),
        )
        .orderBy(asc(deliveries.deliveryDate))
        .limit(ATTENTION_PER_CHECK),
      db
        .select({ id: creditBatches.id, code: creditBatches.code })
        .from(creditBatches)
        .where(
          and(
            eq(creditBatches.facilityId, facilityId),
            isNull(creditBatches.archivedAt),
            eq(creditBatches.status, "pending"),
            lt(creditBatches.endDate, todayStr),
          ),
        )
        .orderBy(asc(creditBatches.endDate))
        .limit(ATTENTION_PER_CHECK),
    ]);

  const facilityQuery = `?facility=${facilityId}`;
  const flags: DashboardAttentionItem[] = [
    ...runsMissingMass.map((row) => ({
      id: `run-mass-${row.id}`,
      entityCode: row.code,
      title: "Complete run missing mass data",
      severity: "flag" as const,
      href: productionRunHref(facilityId, row.id),
    })),
    ...unlinkedLots.map((row) => ({
      id: `lot-unlinked-${row.id}`,
      entityCode: row.code,
      title: "Production run not linked",
      severity: "flag" as const,
      href: `/biochar-products${facilityQuery}`,
    })),
    ...feedstocksMissingData.map((row) => ({
      id: `feedstock-missing-${row.id}`,
      entityCode: row.code,
      title: "Feedstock record missing data",
      severity: "flag" as const,
      href: `/feedstocks${facilityQuery}`,
    })),
  ];
  const pending: DashboardAttentionItem[] = [
    ...batchesAwaitingVerification.map((row) => ({
      id: `batch-pending-${row.id}`,
      entityCode: row.code,
      title: "Period ended · awaiting verification",
      severity: "pending" as const,
      href: `/credit-batches/${row.id}`,
    })),
    ...upcomingDeliveries.map((row) => ({
      id: `delivery-upcoming-${row.id}`,
      entityCode: row.code,
      title: "Upcoming delivery",
      severity: "pending" as const,
      href: `/deliveries${facilityQuery}`,
    })),
  ];

  return [...flags, ...pending].slice(0, ATTENTION_TOTAL);
}
