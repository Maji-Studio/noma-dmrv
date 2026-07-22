/**
 * Production Processes Data Access Layer
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B (ADR 0016). It is auto-found-or-created when a credit
 * batch is formed, defaulting to Method A. ADR 0017 Track 1 adds the read-only
 * operator surface; Track 2 adds the Method-B unlock action.
 */

import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  creditBatches,
  facilities,
  feedstockTypes,
  productionProcesses,
  samples,
  type ProductionProcess,
} from "@/db/schema";
import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import {
  METHOD_B_MINIMUM_METHOD_A_SAMPLES,
  PROCESS_ROLLING_WINDOW_MONTHS,
} from "@/config/certification";
import {
  deriveBatchSamplingMethod,
  deriveSamplingRequirement,
  type BatchSampling,
  type SamplingMethod,
} from "@/lib/certification/sampling-requirements";
import {
  evaluateProcessComplianceDrift,
  type ProcessComplianceDrift,
} from "@/lib/certification/compliance-drift";
import {
  eligibleWindowCutoff,
  filterEligibleSamples,
  isWithinEligibleWindow,
  previewUnsampledCarbon,
  type EligibleSampleDatum,
  type UnsampledCarbonPreview,
} from "@/lib/calculations/unsampled-carbon";
import type {
  MoisturePathway,
  SetOperationalStartInput,
  UnlockMethodBInput,
} from "@/schemas/production-process";
import { countEligibleSamplesByProcess } from "./isometric";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";

type Executor = DbTransaction | typeof db;
const PRODUCTION_PROCESS_CURRENT_LOCK_SCOPE = "production-process-current";

async function lockCurrentProductionProcess(
  executor: Executor,
  params: { facilityId: string; feedstockTypeId: string },
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${PRODUCTION_PROCESS_CURRENT_LOCK_SCOPE}:${params.facilityId}:${params.feedstockTypeId}`}, 0))`,
  );
}

/**
 * Find the CURRENT production process for a (facility, feedstock) pair, or
 * create one (Method A). "Current" = the most recently established — a new
 * process (feedstock/condition change, 3σ deviation) is opened by establishing
 * a later one, so the lookup is ordered by `establishedAt` desc. That re-keying
 * feeds ADR 0017's process-grained Method-B compute; new processes still default
 * to Method A.
 *
 * Accepts an optional executor so it can participate in the credit-batch
 * creation transaction (find-or-create is read-then-write; running it inside the
 * caller's tx keeps it atomic with the batch insert).
 */
export async function findOrCreateProductionProcess(
  ctx: OrgContext,
  params: { facilityId: string; feedstockTypeId: string },
  executor: Executor = db,
): Promise<ProductionProcess> {
  requireOrgScope(ctx);

  if (executor === db) {
    return db.transaction((tx) =>
      findOrCreateProductionProcess(ctx, params, tx),
    );
  }

  await assertSameOrg(ctx, feedstockTypes, params.feedstockTypeId, executor);
  await lockCurrentProductionProcess(executor, params);

  const [existing] = await executor
    .select()
    .from(productionProcesses)
    .where(
      and(
        eq(productionProcesses.facilityId, params.facilityId),
        eq(productionProcesses.feedstockTypeId, params.feedstockTypeId),
        eq(productionProcesses.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(productionProcesses.establishedAt))
    .limit(1);

  if (existing) return existing;

  const [created] = await executor
    .insert(productionProcesses)
    .values({
      organizationId: ctx.organizationId,
      facilityId: params.facilityId,
      feedstockTypeId: params.feedstockTypeId,
    })
    .returning();

  return created;
}

/**
 * Read-only operator view of a facility's production processes (ADR 0017
 * Track 1.5): each process's feedstock, its CURRENT sampling method, its
 * lifetime Method-B baseline progress (eligible replicate samples since
 * `established_at`), and its cadence status under that method.
 *
 * The baseline counter uses the same process-grained count as
 * `getMethodBEligibilityByProcess`. Cadence is limited to the process's current
 * effective regime, so a Method-B unlock never reclassifies earlier Method-A
 * batches; removal-specific submission gates still enforce those historical
 * batches' individual obligations. This is where Track 2's unlock CTA and
 * Method-B signals attach.
 */
export interface ProductionProcessSummary {
  id: string;
  facilityId: string;
  feedstockTypeId: string;
  feedstockName: string;
  feedstockCode: string;
  samplingMethod: SamplingMethod;
  establishedAt: Date;
  methodBUnlockedAt: Date | null;
  /**
   * The three protocol prerequisites captured at Method-B unlock (null under
   * Method A): `G-F74T-0` agreed baseline size, `R-S8K1-1` random-sampling-plan
   * reference, `R-ADXG-0` moisture-determination pathway. Surfaced read-only on
   * the detail panel so the unlock declaration is auditable, not write-only.
   */
  agreedBaselineSize: number | null;
  randomSamplingPlanRef: string | null;
  moisturePathway: MoisturePathway | null;
  /** Lifetime eligible replicate samples (the ≥30 baseline counter). */
  eligibleSampleCount: number;
  /**
   * Linked samples excluded from the baseline because their sampling time is in
   * the future ("as of now" upper bound). They exist and may satisfy batch
   * chemistry, but count toward the baseline only once their sampling date
   * passes — surfaced so the operator sees WHY the counter disagrees with a
   * batch's sample roll-up instead of reverse-engineering the clock.
   */
  futureSampleCount: number;
  /** Earliest future sampling time — when the next excluded sample starts counting. */
  nextCountableSamplingTime: Date | null;
  /**
   * The same instant as a facility-local `YYYY-MM-DD` day, for display. The
   * surfaces show this — never `nextCountableSamplingTime` through a viewer-local
   * formatter — so the "counted from" day matches the facility-local day the
   * durability chip shows and never drifts by one across timezones.
   */
  nextCountableSamplingDay: string | null;
  /**
   * Linked samples dated before the process's operational `established_at` —
   * permanently excluded from the baseline (ADR 0017, 2026-07-12 amendment).
   */
  preEstablishmentSampleCount: number;
  /** The agreed baseline target (default 30, `G-F74T-0`). */
  baselineTarget: number;
  /** True once the lifetime count clears the baseline → Method-B-eligible. */
  meetsBaseline: boolean;
  totalBatches: number;
  sampledBatches: number;
  requiredSampledBatches: number;
  cadenceShortfall: number;
  /** True when the current regime's sampling cadence is satisfied. */
  cadenceMet: boolean;
}

export async function getProductionProcessSummariesByFacility(
  ctx: OrgContext,
  facilityId: string,
): Promise<ProductionProcessSummary[]> {
  requireOrgScope(ctx);

  const processRows = await db
    .select({
      id: productionProcesses.id,
      facilityId: productionProcesses.facilityId,
      feedstockTypeId: productionProcesses.feedstockTypeId,
      feedstockName: feedstockTypes.name,
      feedstockCode: feedstockTypes.code,
      samplingMethod: productionProcesses.samplingMethod,
      establishedAt: productionProcesses.establishedAt,
      methodBUnlockedAt: productionProcesses.methodBUnlockedAt,
      agreedBaselineSize: productionProcesses.agreedBaselineSize,
      randomSamplingPlanRef: productionProcesses.randomSamplingPlanRef,
      moisturePathway: productionProcesses.moisturePathway,
    })
    .from(productionProcesses)
    .innerJoin(
      feedstockTypes,
      and(
        eq(feedstockTypes.id, productionProcesses.feedstockTypeId),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(productionProcesses.facilityId, facilityId), eq(productionProcesses.organizationId, ctx.organizationId)))
    .orderBy(desc(productionProcesses.establishedAt));

  if (processRows.length === 0) return [];

  // Facility timezone resolves the "counted from" instant to a facility-local
  // calendar day, so the process surfaces agree with the durability chip and
  // never drift a day under a viewer-local formatter (UTC fallback).
  const [facilityRow] = await db
    .select({ timezone: facilities.timezone })
    .from(facilities)
    .where(
      and(
        eq(facilities.id, facilityId),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    );
  const facilityTimezone = facilityRow?.timezone ?? null;
  const facilityLocalDay = (instant: Date | null): string | null =>
    instant == null
      ? null
      : facilityTimezone
        ? formatFacilityDate(instant, facilityTimezone)
        : formatUtcDate(instant);

  const asOfDate = new Date();
  const eligibleSamplesByProcess = await countEligibleSamplesByProcess(ctx, db, {
    facilityId,
    // Match the transactional unlock guard: future-dated samples must not make
    // the operator surface advertise an unlock that the mutation will reject.
    asOfDate,
  });

  // Baseline-excluded samples, per process, with the reason split out so the
  // surface can NAME the exclusion (future-dated vs pre-establishment) instead
  // of showing a bare counter that silently disagrees with the batch roll-up.
  const exclusionRows = await db
    .select({
      productionProcessId: creditBatches.productionProcessId,
      // Baseline window is [established_at, method_b_unlocked_at): once a process
      // has unlocked Method B, future-dated samples land AFTER the unlock and are
      // never baseline evidence (they mirror the DB backstop in migration 0083),
      // so the "counted from <date>" note must not advertise them. A null unlock
      // timestamp (still Method A) keeps every future-dated sample in view.
      futureSampleCount: sql<number>`count(*) filter (where ${samples.samplingTime} >= ${asOfDate} and ${samples.samplingTime} >= ${productionProcesses.establishedAt} and (${productionProcesses.methodBUnlockedAt} is null or ${samples.samplingTime} < ${productionProcesses.methodBUnlockedAt}))`.mapWith(Number),
      // mapWith(column) reuses the timestamp decoder, so the min comes back as
      // a Date on the same UTC convention as the column reads.
      nextCountableSamplingTime: sql<Date | null>`min(${samples.samplingTime}) filter (where ${samples.samplingTime} >= ${asOfDate} and ${samples.samplingTime} >= ${productionProcesses.establishedAt} and (${productionProcesses.methodBUnlockedAt} is null or ${samples.samplingTime} < ${productionProcesses.methodBUnlockedAt}))`.mapWith(samples.samplingTime),
      preEstablishmentSampleCount: sql<number>`count(*) filter (where ${samples.samplingTime} < ${productionProcesses.establishedAt})`.mapWith(Number),
    })
    .from(samples)
    .innerJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .innerJoin(
      productionProcesses,
      and(
        eq(productionProcesses.id, creditBatches.productionProcessId),
        eq(productionProcesses.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(creditBatches.facilityId, facilityId),
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(samples.organizationId, ctx.organizationId),
      ),
    )
    .groupBy(creditBatches.productionProcessId);
  const exclusionsByProcess = new Map(
    exclusionRows.map((row) => [row.productionProcessId, row] as const),
  );

  // Per credit batch: its pooled replicate-sample count, grouped by process.
  // GROUP BY the credit-batch PK functionally determines code/process_id.
  const batchRows = await db
    .select({
      productionProcessId: creditBatches.productionProcessId,
      batchId: creditBatches.id,
      batchCode: creditBatches.code,
      startDate: creditBatches.startDate,
      sampleCount: count(samples.id).mapWith(Number),
    })
    .from(creditBatches)
    .leftJoin(samples, and(eq(samples.creditBatchId, creditBatches.id), eq(samples.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatches.facilityId, facilityId), eq(creditBatches.organizationId, ctx.organizationId)))
    .groupBy(creditBatches.id);

  const batchesByProcess = new Map<
    string,
    { batchId: string; batchCode: string; startDate: string; sampleCount: number }[]
  >();
  for (const row of batchRows) {
    const list = batchesByProcess.get(row.productionProcessId) ?? [];
    list.push({
      batchId: row.batchId,
      batchCode: row.batchCode,
      startDate: row.startDate,
      sampleCount: row.sampleCount,
    });
    batchesByProcess.set(row.productionProcessId, list);
  }

  return processRows.map((process) => {
    const batches = (batchesByProcess.get(process.id) ?? []).filter(
      (batch) =>
        deriveBatchSamplingMethod({
          processMethod: process.samplingMethod,
          methodBUnlockedAt: process.methodBUnlockedAt,
          batchStartDate: batch.startDate,
        }) === process.samplingMethod,
    );
    const eligibleSampleCount = eligibleSamplesByProcess.get(process.id) ?? 0;
    const exclusions = exclusionsByProcess.get(process.id);
    const requirement = deriveSamplingRequirement(
      process.samplingMethod,
      batches,
    );

    return {
      id: process.id,
      facilityId: process.facilityId,
      feedstockTypeId: process.feedstockTypeId,
      feedstockName: process.feedstockName,
      feedstockCode: process.feedstockCode,
      samplingMethod: process.samplingMethod,
      establishedAt: process.establishedAt,
      methodBUnlockedAt: process.methodBUnlockedAt,
      agreedBaselineSize: process.agreedBaselineSize,
      randomSamplingPlanRef: process.randomSamplingPlanRef,
      moisturePathway: process.moisturePathway,
      eligibleSampleCount,
      futureSampleCount: exclusions?.futureSampleCount ?? 0,
      nextCountableSamplingTime: exclusions?.nextCountableSamplingTime ?? null,
      nextCountableSamplingDay: facilityLocalDay(
        exclusions?.nextCountableSamplingTime ?? null,
      ),
      preEstablishmentSampleCount: exclusions?.preEstablishmentSampleCount ?? 0,
      baselineTarget: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      meetsBaseline: eligibleSampleCount >= METHOD_B_MINIMUM_METHOD_A_SAMPLES,
      totalBatches: requirement.totalBatches,
      sampledBatches: requirement.sampledBatches,
      requiredSampledBatches: requirement.requiredSampledBatches,
      cadenceShortfall: requirement.cadenceShortfall,
      cadenceMet: requirement.met,
    };
  });
}

/**
 * Unlock Method B for a production process (ADR 0017): the deliberate, captured
 * transition off the Method-A baseline. Flips `samplingMethod → method_b`, stamps
 * `methodBUnlockedAt`, and persists the three protocol prerequisites the unlock
 * captures (agreed baseline size, random-sampling-plan reference, moisture
 * pathway).
 *
 * Two guardrails sit under this — the APP-LAYER backstop here (re-counts the
 * lifetime baseline inside the row-locked transaction and refuses an
 * under-baseline flip with a friendly message) and the DB trigger
 * `process_method_b_minimum_samples` (migration 0060), which re-asserts the hard
 * ≥30 floor even against direct SQL. The app guard checks the *agreed* baseline
 * (≥30); the trigger checks the protocol floor (30) — never stricter than the
 * app gate. Idempotent only in the sense that a re-unlock of an
 * already-Method-B process is rejected, not silently re-stamped.
 *
 * Organization scope is enforced in this layer. Facility managers may unlock
 * (ADR 0017 D4); the guardrail is the captured prerequisites, not a narrower
 * role gate.
 */
export async function unlockMethodBForProcess(
  ctx: OrgContext,
  input: UnlockMethodBInput,
): Promise<ProductionProcess> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const [process] = await tx
      .select()
      .from(productionProcesses)
      .where(and(eq(productionProcesses.id, input.processId), eq(productionProcesses.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);

    if (!process) {
      throw new Error("Production process not found");
    }
    if (process.samplingMethod === "method_b") {
      throw new Error("This production process is already on Method B");
    }

    // Re-count the process's pre-unlock baseline inside the row-locked
    // transaction via the shared process-grain counter (the same one the
    // operator surface and submission gates read), so the gate can't disagree
    // with what the operator saw. Bound to `asOfDate: now` — the timestamp we
    // stamp as `methodBUnlockedAt` below — so this app count uses the EXACT same
    // pre-unlock boundary as the DB trigger (migration 0060) and the two can't
    // disagree at unlock.
    const now = new Date();
    const eligibleByProcess = await countEligibleSamplesByProcess(ctx, tx, {
      facilityId: process.facilityId,
      asOfDate: now,
    });
    const eligibleSampleCount = eligibleByProcess.get(input.processId) ?? 0;
    // Refuse an under-baseline flip with a friendly message before the DB
    // trigger would raise its raw check_violation. The agreed baseline is
    // already ≥ the protocol floor (schema), so this also satisfies the trigger.
    const requiredSamples = Math.max(
      input.agreedBaselineSize,
      METHOD_B_MINIMUM_METHOD_A_SAMPLES,
    );
    if (eligibleSampleCount < requiredSamples) {
      throw new Error(
        `Cannot unlock Method B: ${eligibleSampleCount}/${requiredSamples} eligible Method-A samples collected for this production process.`,
      );
    }

    const [updated] = await tx
      .update(productionProcesses)
      .set({
        samplingMethod: "method_b",
        methodBUnlockedAt: now,
        agreedBaselineSize: input.agreedBaselineSize,
        randomSamplingPlanRef: input.randomSamplingPlanRef,
        moisturePathway: input.moisturePathway,
        updatedAt: now,
      })
      .where(and(eq(productionProcesses.id, input.processId), eq(productionProcesses.organizationId, ctx.organizationId)))
      .returning();

    return updated;
  });
}

/**
 * Set a production process's true operational start (`established_at`) — the
 * correction for a back-entered facility whose real sampling predates the row
 * the system auto-created (ADR 0017, 2026-07-12 amendment). Because the baseline
 * window is `[established_at, …)`, an operational start dated after sampling
 * began strands legitimate samples outside the count; moving it back lets them
 * qualify so the facility can reach Method B.
 *
 * Editable ONLY while the process is still on Method A. After Method B unlocks,
 * the baseline window is fixed history: a change would retroactively redraw which
 * samples were the ≥30 baseline. Three layers reject a post-unlock edit — this
 * row-locked check, the `isNull(method_b_unlocked_at)` UPDATE predicate (closes
 * the check→update race), and the DB trigger (migration 0085, against direct SQL).
 * Organization scope is enforced here; the fn layer gates the owner/admin role.
 */
export async function setProcessOperationalStart(
  ctx: OrgContext,
  input: SetOperationalStartInput,
): Promise<ProductionProcess> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const [process] = await tx
      .select()
      .from(productionProcesses)
      .where(
        and(
          eq(productionProcesses.id, input.processId),
          eq(productionProcesses.organizationId, ctx.organizationId),
        ),
      )
      .for("update")
      .limit(1);

    if (!process) {
      throw new SafeError("Production process not found.");
    }
    if (process.methodBUnlockedAt != null) {
      throw new SafeError(
        "This production process has already unlocked Method B — its baseline window is fixed history and the operational start can no longer change.",
      );
    }

    const [updated] = await tx
      .update(productionProcesses)
      .set({ establishedAt: input.establishedAt, updatedAt: new Date() })
      .where(
        and(
          eq(productionProcesses.id, input.processId),
          eq(productionProcesses.organizationId, ctx.organizationId),
          // DB-layer backstop: never touch a row that unlocked Method B between
          // the SELECT above and this UPDATE.
          isNull(productionProcesses.methodBUnlockedAt),
        ),
      )
      .returning();

    if (!updated) {
      throw new SafeError(
        "This production process has already unlocked Method B — its operational start can no longer change.",
      );
    }

    return updated;
  });
}

export interface ProcessCarbonPreview {
  productionProcessId: string;
  /** The as-of production date the eligible window was anchored on (ISO). */
  asOfDate: string;
  /** Non-authoritative Eq 4/5 preview over the eligible pool. */
  preview: UnsampledCarbonPreview;
}

/**
 * Load a production process's credit-batch-linked samples (the raw pool both the
 * unsampled-carbon preview and the compliance-drift carbon counter window). The
 * inner join drops in-process samples (null `credit_batch_id`, internal-only per
 * ADR 0016), and samples dated before the process's operational `established_at`
 * are excluded — they never feed the eligible pool (ADR 0017, 2026-07-12
 * amendment). Returns raw rows — the trailing-window filter
 * (`filterEligibleSamples`) belongs to the engine/read path, not this loader.
 */
async function loadProcessSamples(
  ctx: OrgContext,
  productionProcessId: string,
): Promise<EligibleSampleDatum[]> {
  return db
    .select({
      organicCarbonPercent: samples.organicCarbonPercent,
      samplingTime: samples.samplingTime,
      creditBatchId: samples.creditBatchId,
    })
    .from(samples)
    .innerJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(
      productionProcesses,
      and(
        eq(productionProcesses.id, creditBatches.productionProcessId),
        eq(productionProcesses.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(creditBatches.productionProcessId, productionProcessId),
        eq(samples.organizationId, ctx.organizationId),
        gte(samples.samplingTime, productionProcesses.establishedAt),
      ),
    );
}

/**
 * Compute the NON-AUTHORITATIVE unsampled-carbon preview (Eq 4/5) for a process,
 * as of a given production date (default: now). Loads the process's
 * credit-batch-linked samples; the pure engine
 * (`previewUnsampledCarbon`) filters them to the trailing-6-month eligible window
 * and returns `μ − σ/√n` plus its freshness. The registry computes the credited
 * number (D1) — this drives the operator preview only.
 */
export async function getUnsampledCarbonPreviewForProcess(
  ctx: OrgContext,
  productionProcessId: string,
  asOfDate?: Date,
): Promise<ProcessCarbonPreview> {
  requireOrgScope(ctx);

  const asOf = asOfDate ?? new Date();
  const rows = await loadProcessSamples(ctx, productionProcessId);
  const preview = previewUnsampledCarbon(rows, { asOfDate: asOf });

  return {
    productionProcessId,
    asOfDate: asOf.toISOString(),
    preview,
  };
}

export interface ProcessComplianceDriftResult {
  productionProcessId: string;
  samplingMethod: SamplingMethod;
  /** As-of date the rolling window ends on (ISO). */
  asOfDate: string;
  /** Rolling window length (months). */
  windowMonths: number;
  drift: ProcessComplianceDrift;
}

/**
 * Compute the two trailing-window compliance counters for a process (ADR 0017
 * item 7): missed required samplings (batches whose production date falls in the
 * window) and sub-3σ carbon measurements (samples taken in the window). Warn-only
 * — the registry is the detector of record (D6); noma never auto-acts.
 */
export async function getProcessComplianceDrift(
  ctx: OrgContext,
  productionProcessId: string,
  asOfDate?: Date,
): Promise<ProcessComplianceDriftResult> {
  requireOrgScope(ctx);

  const asOf = asOfDate ?? new Date();
  const cutoff = eligibleWindowCutoff(asOf);

  const [process] = await db
    .select({
      samplingMethod: productionProcesses.samplingMethod,
      methodBUnlockedAt: productionProcesses.methodBUnlockedAt,
    })
    .from(productionProcesses)
    .where(and(eq(productionProcesses.id, productionProcessId), eq(productionProcesses.organizationId, ctx.organizationId)))
    .limit(1);
  if (!process) {
    throw new Error("Production process not found");
  }

  // Two independent reads — the per-batch production dates + pooled counts, and
  // the raw sample pool — fetched concurrently.
  const [batchRows, sampleRows] = await Promise.all([
    db
      .select({
        batchId: creditBatches.id,
        batchCode: creditBatches.code,
        startDate: creditBatches.startDate,
        endDate: creditBatches.endDate,
        sampleCount: count(samples.id).mapWith(Number),
      })
      .from(creditBatches)
      .leftJoin(samples, and(eq(samples.creditBatchId, creditBatches.id), eq(samples.organizationId, ctx.organizationId)))
      .where(and(eq(creditBatches.productionProcessId, productionProcessId), eq(creditBatches.organizationId, ctx.organizationId)))
      .groupBy(creditBatches.id),
    loadProcessSamples(ctx, productionProcessId),
  ]);

  // Both windows use the SAME half-open `[cutoff, asOf)` boundary
  // (`isWithinEligibleWindow` / `filterEligibleSamples`), so batches and samples
  // can't drift to different conventions. `endDate` is a date string; a few
  // hours' UTC offset is immaterial for a 6-month window comparison.
  const batchesInWindow: BatchSampling[] = batchRows
    .filter(
      (batch) =>
        isWithinEligibleWindow(new Date(batch.endDate), asOf, cutoff) &&
        deriveBatchSamplingMethod({
          processMethod: process.samplingMethod,
          methodBUnlockedAt: process.methodBUnlockedAt,
          batchStartDate: batch.startDate,
        }) === process.samplingMethod,
    )
    .map((b) => ({
      batchId: b.batchId,
      batchCode: b.batchCode,
      sampleCount: b.sampleCount,
    }));

  // Carbon measurements taken in the window (organic-carbon = the CC in Eq 4).
  const carbonValuesInWindow = filterEligibleSamples(sampleRows, {
    asOfDate: asOf,
  })
    .map((s) => s.organicCarbonPercent)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const drift = evaluateProcessComplianceDrift({
    method: process.samplingMethod,
    batchesInWindow,
    carbonValuesInWindow,
  });

  return {
    productionProcessId,
    samplingMethod: process.samplingMethod,
    asOfDate: asOf.toISOString(),
    windowMonths: PROCESS_ROLLING_WINDOW_MONTHS,
    drift,
  };
}

/**
 * Start a NEW production process for a (facility, feedstock) pair (ADR 0017 item
 * 7 / D6): the deliberate, human-confirmed reset after a feedstock change,
 * pyrolysis-condition change, or sustained carbon deviation. A fresh row (Method
 * A, `establishedAt = now`) becomes the CURRENT process for the pair (the lookup
 * is ordered by `establishedAt` desc), so its baseline restarts from zero — no
 * historical data carried forward. The prior process keeps its history but no
 * longer receives new batches. Never auto-invoked.
 */
export async function startNewProductionProcess(
  ctx: OrgContext,
  params: { facilityId: string; feedstockTypeId: string; notes?: string | null },
): Promise<ProductionProcess> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, feedstockTypes, params.feedstockTypeId);

  return db.transaction(async (tx) => {
    // Serialise against find-or-create for the same pair so a batch insert can't
    // race the reset and attach to a process that's about to be superseded.
    await lockCurrentProductionProcess(tx, params);

    const [created] = await tx
      .insert(productionProcesses)
      .values({
        organizationId: ctx.organizationId,
        facilityId: params.facilityId,
        feedstockTypeId: params.feedstockTypeId,
        notes: params.notes ?? null,
      })
      .returning();

    return created;
  });
}
