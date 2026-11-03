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
import { removalResubmitHref } from "@/lib/removal-correction-copy";
import { RECORD_LINKS, recordHref } from "@/lib/record-links";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  creditBatches,
  deliveries,
  facilities,
  feedstocks,
  productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { addDaysIso, formatFacilityDate, formatUtcDate, UNKNOWN_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { sourceBiocharMassFlowKg } from "@/lib/biochar-product-mass";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";

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
import { sourceAllocationAggregate } from "./biochar-products";
import {
  batchRemovalDisplayFactsSql,
  removalDisplayFromFacts,
  type BatchRemovalDisplayFacts,
} from "./credit-batch-removal-display";
import {
  applicationEvidenceGapWhere,
  ATTENTION_PER_CHECK,
  capOrGroup,
  creditBatchAttention,
  feedstocksMissingDataWhere,
  PERIOD_ENDED_NOT_SUBMITTED_TITLE,
  pendingBatchesWhere,
  runsMissingMassWhere,
} from "./dashboard-attention";
import { facilityListHref } from "@/lib/dashboard-links";
import { RETURNED_BY_ISOMETRIC_LABEL } from "@/lib/certification/emission-entry-messages";
import { loadReturnedRemovalIds } from "./dashboard-returned-removals";
import {
  withCrossCuttingAttention,
  type DashboardBatchAttentionCounts,
} from "./dashboard-station-attention";
import {
  epochMs,
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

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

export type DashboardKpiKey =
  | "feedstockProcessed"
  | "biocharProduced"
  | "appliedToSoil"
  | "co2eStored";

/**
 * Each KPI counts by its own record date (#1532 F9): runs by the day they
 * started, applications by their application date, the CO₂e estimate by the
 * day its credit batch's period ends. The clocks stay as they are; the hint
 * says which one each figure uses, so a month can show applications next to
 * no estimate.
 */
export const KPI_HINTS: Record<DashboardKpiKey, string> = {
  feedstockProcessed: "Dry feedstock mass into complete runs, counted on the day each run started.",
  biocharProduced: "Dry biochar mass out of complete runs, counted on the day each run started.",
  appliedToSoil: "Dry mass of biochar applied to soil at customer sites, counted on the application date.",
  co2eStored:
    "Carbon stored in the credit batches' biochar, before project emissions are subtracted. Counted on the day each batch's period ends, so it can trail the runs and applications behind it.",
};

export interface DashboardKpi {
  key: DashboardKpiKey;
  label: string;
  /** Optional explanation shown beside the label in an InfoHint. */
  hint?: string;
  /** Display unit, e.g. "t", "tCO₂e". */
  unit: string;
  /** Null = no data in range (the band shows `detail` as the reason, never 0). */
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
  /**
   * Entity code shown in the mono column, e.g. "PR-26-0042"; on a grouped row
   * the list it links to, e.g. "Production runs".
   */
  entityCode: string;
  /** Records a grouped row stands for; absent on a single record's row. */
  count?: number;
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
  /** Every open row: a record, or one grouped row per over-cap check. */
  attention: DashboardAttentionItem[];
  /** Cross-cutting certification blockers: one grouped row each, also counted on the station whose form fixes them. */
  structuralGaps: DashboardStructuralGap[];
  /**
   * The "N open" figure: records, counted exactly. A single row is one, a
   * grouped row its count, a structural gap its affected records.
   */
  attentionTotal: number;
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
  const allocationAggregate = sourceAllocationAggregate(ctx);

  const now = new Date();
  const [facility] = await db
    .select({ timezone: facilities.timezone })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));
  const timezone = facility?.timezone ?? UNKNOWN_FACILITY_TIMEZONE;
  const nowDay = formatFacilityDate(now, timezone);
  const periodDays = range === "week" ? WEEK_DAYS : MONTH_DAYS;
  // Include today in the N calendar days.
  const startDay = range === "all" ? null : addDaysIso(nowDay, -(periodDays - 1));
  const previousStartDay = startDay == null ? null : addDaysIso(startDay, -periodDays);
  const inCurrentDayPeriod = (day: string) =>
    (startDay == null || day >= startDay) && day <= nowDay;
  const inPreviousDayPeriod = (day: string) =>
    previousStartDay != null && startDay != null && day >= previousStartDay && day < startDay;
  // One facility-local day for the overdue-batch list and its uncapped count.
  const todayStr = nowDay;
  // Fetch back to the previous-period start so delta needs no second query.
  const fetchStartDay = previousStartDay;

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
        ...(fetchStartDay
          ? [gte(creditBatches.endDate, fetchStartDay)]
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
    { items: attentionItems, batches: batchAttention },
    stationsData,
    structuralGapCounts,
  ] =
    await Promise.all([
      Promise.all([
        db
          .select({
            date: productionRunDateExpr(ctx.organizationId),
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
              ...(fetchStartDay ? [
                gte(productionRunDateExpr(ctx.organizationId), fetchStartDay),
              ] : []),
            ),
          ),
        db
          .select({
            productionDate: biocharProducts.productionDate,
            massKg: biocharProducts.massKg,
            moistureContentPercent: biocharProducts.moistureContentPercent,
            composition: biocharProducts.composition,
            sourceAllocatedDryMassKg: allocationAggregate.allocatedDryMassKg,
          })
          .from(biocharProducts)
          .leftJoin(
            allocationAggregate,
            eq(allocationAggregate.biocharProductId, biocharProducts.id),
          )
          .where(
            and(
              eq(biocharProducts.organizationId, ctx.organizationId),
              eq(biocharProducts.facilityId, facilityId),
              isNull(biocharProducts.archivedAt),
              ne(biocharProducts.status, "draft"),
              ...(fetchStartDay ? [gte(biocharProducts.productionDate, fetchStartDay)] : []),
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
              ...(fetchStartDay ? [gte(applications.applicationDate, new Date(fetchStartDay))] : []),
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
              ...(fetchStartDay ? [gte(feedstocks.deliveryDate, new Date(fetchStartDay))] : []),
            ),
          ),
      ]),
      getDashboardAttentionItems(ctx, facilityId, todayStr),
      getDashboardStations(ctx, facilityId),
      loadDashboardStructuralGapCounts(ctx, facilityId),
    ]);

  const storedTonnesOf = (batchId: string): number | null =>
    batchPreviews[batchId]?.co2eStoredTonnes ?? null;

  // ---- normalize to dated points -----------------------------------------

  const runPoints = runRows.map((row) => ({ day: row.date, row }));
  const lotPoints = lotRows.map((row) => ({ day: row.productionDate, row }));
  // Application dates encode calendar days as UTC-midnight timestamps.
  const applicationPoints = applicationRows.map((row) => ({ day: formatUtcDate(row.applicationDate), row }));
  const batchPoints = batchRows.map((row) => ({ day: row.endDate, row }));

  // ---- KPI assembly --------------------------------------------------------

  const currentRuns = runPoints.filter((p) => inCurrentDayPeriod(p.day));
  const previousRuns = runPoints.filter((p) => inPreviousDayPeriod(p.day));

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
    inCurrentDayPeriod(p.day),
  );
  const previousApplications = applicationPoints.filter((p) =>
    inPreviousDayPeriod(p.day),
  );
  const appliedCurrentTons = sum(
    currentApplications.map((p) => p.row.biocharAppliedDryTons ?? 0),
  );
  const appliedPreviousTons = sum(
    previousApplications.map((p) => p.row.biocharAppliedDryTons ?? 0),
  );

  const currentBatches = batchPoints.filter((p) => inCurrentDayPeriod(p.day));
  const previousBatches = batchPoints.filter((p) => inPreviousDayPeriod(p.day));
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
      hint: KPI_HINTS.feedstockProcessed,
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
      hint: KPI_HINTS.biocharProduced,
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
      hint: KPI_HINTS.appliedToSoil,
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
      label: "Estimated CO₂e stored",
      hint: KPI_HINTS.co2eStored,
      unit: "t",
      value: currentStoredBatches.length > 0 ? storedCurrentTons : null,
      deltaPercent:
        range === "all" || currentStoredBatches.length === 0
          ? null
          : deltaPercent(storedCurrentTons, storedPreviousTons),
      detail:
        currentStoredBatches.length > 0
          ? `before project emissions, ${currentStoredBatches.length} ${currentStoredBatches.length === 1 ? "credit batch" : "credit batches"}`
          : currentBatches.length > 0
            ? "no estimate in period"
            : "no credit batch ended in period",
    },
  ];

  // ---- mass flow along the chain -------------------------------------------

  const feedstockPoints = feedstockRows.map((row) => ({
    day: row.deliveryDate == null ? null : formatUtcDate(row.deliveryDate),
    row,
  }));
  // Feedstocks may predate the delivery-date backfill; undated rows only
  // count in the unbounded "all" period rather than inventing a date.
  const deliveredKg = sum(
    feedstockPoints
      .filter((p) =>
        p.day == null ? range === "all" : inCurrentDayPeriod(p.day),
      )
      .map((p) => p.row.massDryKg),
  );
  const currentLots = lotPoints.filter((p) => inCurrentDayPeriod(p.day));
  const baggedKg = sum(currentLots.map((p) => sourceBiocharMassFlowKg(p.row)));

  const massFlow: DashboardMassFlowSegment[] = [
    { key: "delivered", tonnes: deliveredKg / 1000 },
    { key: "intoRuns", tonnes: feedstockInCurrentKg / 1000 },
    { key: "produced", tonnes: outputCurrentKg / 1000 },
    { key: "bagged", tonnes: baggedKg / 1000 },
    { key: "applied", tonnes: tonnesToKg(appliedCurrentTons) / 1000 },
  ];

  // "N open" counts records (#1532 F5): a single row is one, a grouped row
  // its count, a structural gap its affected records. Every counted record is
  // reachable from one of the card's rows.
  const structuralGaps = buildDashboardStructuralGaps(
    structuralGapCounts,
    facilityId,
  );
  const attentionTotal =
    attentionItems.reduce((total, item) => total + (item.count ?? 1), 0) +
    structuralGaps.reduce((total, gap) => total + gap.count, 0);
  const stations = withCrossCuttingAttention(
    stationsData.stations,
    structuralGaps,
    batchAttention,
    facilityId,
  );

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis,
    massFlow,
    attention: attentionItems,
    structuralGaps,
    attentionTotal,
    ...stationsData,
    stations,
  };
}

// ============================================
// Needs-attention queue
// ============================================

type AttentionKind =
  | "run-mass"
  | "feedstock-missing"
  | "application-evidence"
  | "batch-pending";

function attentionKind(kind: AttentionKind): SQL<AttentionKind> {
  return sql<AttentionKind>`${kind}::text`;
}

/**
 * Record dates come from two column families. A `date` column stays the
 * 'YYYY-MM-DD' text it always was; a `timestamp` column travels as epoch
 * milliseconds (`epochMs`) and is rebuilt as a `Date` in JS, so the UTC
 * instant survives the union instead of turning into zone-less text.
 */
function dayColumn(column: SQLWrapper): SQL<string | null> {
  return sql<string | null>`${column}::text`;
}
const noDay = sql<string | null>`null::text`;
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
  /** Records the branch matched before its cap (window count). */
  total: number;
  /** Every matched record id before the cap; empty on the batch branch. */
  allIds: string[];
  removals: BatchRemovalDisplayFacts[];
}

type FlagKind = Exclude<AttentionKind, "batch-pending">;

/** Uncapped size of a capped branch, read in the same statement. */
const branchTotal = sql<number>`count(*) over ()`.mapWith(Number);
function branchIds(id: SQLWrapper): SQL<string[]> {
  return sql<string[]>`array_agg(${id}::text) over ()`;
}

/**
 * The grouped row an over-cap check folds into. Runs and applications lists
 * filter to exact ids (within the filter's limit); the feedstock list has no
 * such filter, so its row opens the plain list.
 */
const FLAG_GROUPS: Record<FlagKind, { title: string; list: string; href: (facilityId: string, ids: string[]) => string }> = {
  "run-mass": {
    title: "Complete runs missing mass data",
    list: "Production runs",
    href: (facilityId, ids) => facilityListHref(RECORD_LINKS.productionRun.path, facilityId, ids),
  },
  "feedstock-missing": {
    title: "Feedstock records missing data",
    list: "Feedstock intake",
    href: (facilityId) => facilityListHref(RECORD_LINKS.feedstock.path, facilityId),
  },
  "application-evidence": {
    title: "Applications missing evidence",
    list: "Applications",
    href: (facilityId, ids) => facilityListHref(RECORD_LINKS.application.path, facilityId, ids),
  },
};

function groupedRow(kind: string, list: string, title: string, count: number, href: string): DashboardAttentionItem {
  return { id: `${kind}-group`, entityCode: list, count, date: null, title, href };
}

/** Pending batches take their title from `creditBatchAttention`. */
const ATTENTION_TITLES: Record<Exclude<AttentionKind, "batch-pending">, string> = {
  "run-mass": "Complete run missing mass data",
  "feedstock-missing": "Feedstock record missing data",
  "application-evidence": "Application missing evidence",
};

/** Flags sort before pending batches; within a kind the branch ordinal holds. */
const FLAG_ORDER: FlagKind[] = [
  "run-mass",
  "feedstock-missing",
  "application-evidence",
];

function attentionHref(
  kind: AttentionKind,
  id: string,
  facilityId: string,
): string {
  switch (kind) {
    case "run-mass":
      return recordHref("productionRun", id, { facilityId });
    case "feedstock-missing":
      return recordHref("feedstock", id, { facilityId });
    case "application-evidence":
      return recordHref("application", id, { facilityId });
    case "batch-pending":
      return recordHref("creditBatch", id, { facilityId });
  }
}

/**
 * Cheap record checks derived from existing MRV data, fetched as one
 * `union all` of capped, narrow, indexed selects; a window count and id list
 * carry each check's uncapped size, so an over-cap check folds into one
 * grouped row (`capOrGroup`). An item disappears the moment the underlying
 * record is fixed (no independent lifecycle). Pending batches are read
 * uncapped with their Removals' display facts (correlated subqueries, no
 * extra round trip): an interrupted Removal is one row per Removal, a period
 * closed without a submission one row per batch (`creditBatchAttention`),
 * each kind grouped past the cap the same way, and `batches` counts them for
 * the Production station.
 */
export async function getDashboardAttentionItems(
  ctx: OrgContext,
  facilityId: string,
  todayStr: string,
): Promise<{ items: DashboardAttentionItem[]; batches: DashboardBatchAttentionCounts }> {
  requireOrgScope(ctx);
  const orgId = ctx.organizationId;

  const rows: AttentionRow[] = await unionAll(
    db
      .select({
        kind: attentionKind("run-mass"),
        removals: sql<BatchRemovalDisplayFacts[]>`'[]'::jsonb`,
        id: productionRuns.id,
        code: productionRuns.code,
        dateDay: dayColumn(productionRunDateExpr(ctx.organizationId)),
        dateMs: noInstant,
        ord: branchOrdinal(desc(productionRuns.startTime)),
        total: branchTotal,
        allIds: branchIds(productionRuns.id),
      })
      .from(productionRuns)
      .where(runsMissingMassWhere(orgId, facilityId))
      .orderBy(desc(productionRuns.startTime))
      .limit(ATTENTION_PER_CHECK),
    db
      .select({
        kind: attentionKind("feedstock-missing"),
        removals: sql<BatchRemovalDisplayFacts[]>`'[]'::jsonb`,
        id: feedstocks.id,
        code: feedstocks.code,
        dateDay: noDay,
        dateMs: epochMs(
          feedstocks.deliveryDate,
        ),
        ord: branchOrdinal(desc(feedstocks.createdAt)),
        total: branchTotal,
        allIds: branchIds(feedstocks.id),
      })
      .from(feedstocks)
      .where(feedstocksMissingDataWhere(orgId, facilityId))
      .orderBy(desc(feedstocks.createdAt))
      .limit(ATTENTION_PER_CHECK),
    db
      .select({
        kind: attentionKind("application-evidence"),
        removals: sql<BatchRemovalDisplayFacts[]>`'[]'::jsonb`,
        id: applications.id,
        code: applications.code,
        dateDay: noDay,
        dateMs: epochMs(applications.applicationDate),
        ord: branchOrdinal(desc(applications.applicationDate)),
        total: branchTotal,
        allIds: branchIds(applications.id),
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
        removals: batchRemovalDisplayFactsSql(ctx),
        id: creditBatches.id,
        code: creditBatches.code,
        dateDay: dayColumn(creditBatches.endDate),
        dateMs: noInstant,
        ord: branchOrdinal(asc(creditBatches.endDate)),
        total: branchTotal,
        // Batches are read uncapped and grouped in JS, so no id list rides along.
        allIds: sql<string[]>`'{}'::text[]`,
      })
      .from(creditBatches)
      // Redundant org predicate for the lexical guard (see note above).
      .where(
        and(
          pendingBatchesWhere(orgId, facilityId),
          eq(creditBatches.organizationId, orgId),
        ),
      )
      .orderBy(asc(creditBatches.endDate)),
  );

  const batchRows = rows.filter((row) => row.kind === "batch-pending")
    .map((row) => ({ row, removals: row.removals.map(removalDisplayFromFacts) }));
  // Only a submitted period can have come back from the verifier, so only
  // those batches pay for the lineage read (none, no extra round trip).
  const submittedIds = batchRows
    .filter(({ row, removals }) => creditBatchAttention({ endDate: row.dateDay }, removals, todayStr).period === "submitted")
    .map(({ row }) => row.id);
  const returnedRemovalIds = submittedIds.length > 0
    ? await loadReturnedRemovalIds(ctx, submittedIds)
    : new Set<string>();

  const interrupted = new Map<string, DashboardAttentionItem>();
  // Only periods waiting on the operator; one awaiting verification waits on the verifier.
  const notSubmitted: DashboardAttentionItem[] = [];
  const returned: DashboardAttentionItem[] = [];
  for (const { row, removals } of batchRows) {
    const attention = creditBatchAttention({ endDate: row.dateDay }, removals, todayStr, returnedRemovalIds);
    for (const removal of removals) {
      if (removal.status.kind !== "interrupted") continue;
      // A Removal holding slices of several batches is one row naming them all.
      const existing = interrupted.get(removal.id);
      interrupted.set(removal.id, {
        id: `removal-interrupted-${removal.id}`,
        entityCode: `${existing?.entityCode ?? removal.code} · ${row.code}`,
        date: null,
        title: removal.status.label,
        href: removalResubmitHref(removal.id, facilityId),
      });
    }
    if (attention.period === "notSubmitted" || attention.period === "returned") {
      (attention.period === "returned" ? returned : notSubmitted).push({
        id: `batch-pending-${row.id}`,
        entityCode: row.code,
        date: row.dateDay,
        title: attention.period === "returned" ? RETURNED_BY_ISOMETRIC_LABEL : PERIOD_ENDED_NOT_SUBMITTED_TITLE,
        href: attentionHref(row.kind, row.id, facilityId),
      });
    }
  }
  const interruptedRows = [...interrupted.values()];
  const removalsList = facilityListHref(RECORD_LINKS.removal.path, facilityId);
  const batchList = facilityListHref(RECORD_LINKS.creditBatch.path, facilityId);
  const flags = FLAG_ORDER.flatMap((kind) => {
    const kindRows = rows.filter((row) => row.kind === kind).sort((a, b) => a.ord - b.ord);
    const first = kindRows[0];
    if (!first) return [];
    const group = FLAG_GROUPS[kind];
    return capOrGroup(
      kindRows.map((row): DashboardAttentionItem => ({
        id: `${kind}-${row.id}`,
        entityCode: row.code,
        date: row.dateDay ?? (row.dateMs == null ? null : new Date(row.dateMs)),
        title: ATTENTION_TITLES[kind],
        href: attentionHref(kind, row.id, facilityId),
      })),
      first.total,
      () => groupedRow(kind, group.list, group.title, first.total, group.href(facilityId, first.allIds)),
    );
  });
  return {
    // An interrupted submission leads: it blocks the Removal until resumed.
    items: [
      ...capOrGroup(interruptedRows, interruptedRows.length, () =>
        groupedRow("removal-interrupted", "Removals", "Submissions interrupted", interruptedRows.length, removalsList)),
      ...flags,
      ...capOrGroup(returned, returned.length, () =>
        groupedRow("batch-returned", "Credit batches", RETURNED_BY_ISOMETRIC_LABEL, returned.length, batchList)),
      ...capOrGroup(notSubmitted, notSubmitted.length, () =>
        groupedRow("batch-not-submitted", "Credit batches", PERIOD_ENDED_NOT_SUBMITTED_TITLE, notSubmitted.length, batchList)),
    ],
    batches: { interrupted: interrupted.size, notSubmitted: notSubmitted.length, returned: returned.length },
  };
}
