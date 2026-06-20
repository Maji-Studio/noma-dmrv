/**
 * Production Processes Data Access Layer
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B (ADR 0016). It is auto-found-or-created when a credit
 * batch is formed, defaulting to Method A. ADR 0017 Track 1 adds the read-only
 * operator surface; Track 2 adds the Method-B unlock action.
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  creditBatches,
  feedstockTypes,
  productionProcesses,
  samples,
  type ProductionProcess,
} from "@/db/schema";
import {
  METHOD_B_MINIMUM_METHOD_A_SAMPLES,
  PROCESS_ROLLING_WINDOW_MONTHS,
} from "@/config/certification";
import {
  deriveSamplingRequirement,
  type BatchSampling,
  type SamplingMethod,
} from "@/lib/certification/sampling-requirements";
import {
  evaluateProcessComplianceDrift,
  type ProcessComplianceDrift,
} from "@/lib/certification/compliance-drift";
import {
  previewUnsampledCarbon,
  type UnsampledCarbonPreview,
} from "@/lib/calculations/unsampled-carbon";
import type { UnlockMethodBInput } from "@/schemas/production-process";
import { countEligibleSamplesByProcess } from "./isometric";
import { requireAuth } from "./utils";

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
  userId: string,
  params: { facilityId: string; feedstockTypeId: string },
  executor: Executor = db,
): Promise<ProductionProcess> {
  requireAuth(userId);

  if (executor === db) {
    return db.transaction((tx) =>
      findOrCreateProductionProcess(userId, params, tx),
    );
  }

  await lockCurrentProductionProcess(executor, params);

  const [existing] = await executor
    .select()
    .from(productionProcesses)
    .where(
      and(
        eq(productionProcesses.facilityId, params.facilityId),
        eq(productionProcesses.feedstockTypeId, params.feedstockTypeId),
      ),
    )
    .orderBy(desc(productionProcesses.establishedAt))
    .limit(1);

  if (existing) return existing;

  const [created] = await executor
    .insert(productionProcesses)
    .values({
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
 * `getMethodBEligibilityByProcess`. Cadence here is a lifetime operator view over
 * the facility's process history; removal-specific submission gates can evaluate
 * a narrower in-scope batch set. This is where Track 2's unlock CTA and Method-B
 * signals attach.
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
  /** Lifetime eligible replicate samples (the ≥30 baseline counter). */
  eligibleSampleCount: number;
  /** The agreed baseline target (default 30, `G-F74T-0`). */
  baselineTarget: number;
  /** True once the lifetime count clears the baseline → Method-B-eligible. */
  meetsBaseline: boolean;
  totalBatches: number;
  sampledBatches: number;
  requiredSampledBatches: number;
  cadenceShortfall: number;
  /** True when the current method's sampling cadence is satisfied. */
  cadenceMet: boolean;
}

export async function getProductionProcessSummariesByFacility(
  userId: string,
  facilityId: string,
): Promise<ProductionProcessSummary[]> {
  requireAuth(userId);

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
    })
    .from(productionProcesses)
    .innerJoin(
      feedstockTypes,
      eq(feedstockTypes.id, productionProcesses.feedstockTypeId),
    )
    .where(eq(productionProcesses.facilityId, facilityId))
    .orderBy(desc(productionProcesses.establishedAt));

  if (processRows.length === 0) return [];

  const eligibleSamplesByProcess = await countEligibleSamplesByProcess(db, {
    facilityId,
  });

  // Per credit batch: its pooled replicate-sample count, grouped by process.
  // GROUP BY the credit-batch PK functionally determines code/process_id.
  const batchRows = await db
    .select({
      productionProcessId: creditBatches.productionProcessId,
      batchId: creditBatches.id,
      batchCode: creditBatches.code,
      sampleCount: count(samples.id).mapWith(Number),
    })
    .from(creditBatches)
    .leftJoin(samples, eq(samples.creditBatchId, creditBatches.id))
    .where(eq(creditBatches.facilityId, facilityId))
    .groupBy(creditBatches.id);

  const batchesByProcess = new Map<
    string,
    { batchId: string; batchCode: string; sampleCount: number }[]
  >();
  for (const row of batchRows) {
    const list = batchesByProcess.get(row.productionProcessId) ?? [];
    list.push({
      batchId: row.batchId,
      batchCode: row.batchCode,
      sampleCount: row.sampleCount,
    });
    batchesByProcess.set(row.productionProcessId, list);
  }

  return processRows.map((process) => {
    const batches = batchesByProcess.get(process.id) ?? [];
    const eligibleSampleCount = eligibleSamplesByProcess.get(process.id) ?? 0;
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
      eligibleSampleCount,
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
 * Per-facility membership authz (`requireFacilityAccess`) lands with the
 * multi-tenancy work (ADR 0010); `requireAuth` matches every mutation in this
 * layer today. Facility managers may unlock (ADR 0017 D4); the guardrail is the
 * captured prerequisites, not a narrower role gate.
 */
export async function unlockMethodBForProcess(
  userId: string,
  input: UnlockMethodBInput,
): Promise<ProductionProcess> {
  requireAuth(userId);

  return db.transaction(async (tx) => {
    const [process] = await tx
      .select()
      .from(productionProcesses)
      .where(eq(productionProcesses.id, input.processId))
      .for("update")
      .limit(1);

    if (!process) {
      throw new Error("Production process not found");
    }
    if (process.samplingMethod === "method_b") {
      throw new Error("This production process is already on Method B");
    }

    // Re-count the process's lifetime eligible samples inside the row-locked
    // transaction via the shared process-grain counter (the same one the
    // operator surface and submission gates read), so the gate can't disagree
    // with what the operator saw.
    const eligibleByProcess = await countEligibleSamplesByProcess(tx, {
      facilityId: process.facilityId,
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

    const now = new Date();
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
      .where(eq(productionProcesses.id, input.processId))
      .returning();

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
 * Compute the NON-AUTHORITATIVE unsampled-carbon preview (Eq 4/5) for a process,
 * as of a given production date (default: now). Loads the process's
 * credit-batch-linked samples; the pure engine
 * (`previewUnsampledCarbon`) filters them to the trailing-6-month eligible window
 * and returns `μ − σ/√n` plus its freshness. The registry computes the credited
 * number (D1) — this drives the operator preview only.
 */
export async function getUnsampledCarbonPreviewForProcess(
  userId: string,
  productionProcessId: string,
  asOfDate?: Date,
): Promise<ProcessCarbonPreview> {
  requireAuth(userId);

  const asOf = asOfDate ?? new Date();

  const rows = await db
    .select({
      organicCarbonPercent: samples.organicCarbonPercent,
      samplingTime: samples.samplingTime,
      creditBatchId: samples.creditBatchId,
    })
    .from(samples)
    .innerJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .where(eq(creditBatches.productionProcessId, productionProcessId));

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
  userId: string,
  productionProcessId: string,
  asOfDate?: Date,
): Promise<ProcessComplianceDriftResult> {
  requireAuth(userId);

  const asOf = asOfDate ?? new Date();
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - PROCESS_ROLLING_WINDOW_MONTHS);

  const [process] = await db
    .select({ samplingMethod: productionProcesses.samplingMethod })
    .from(productionProcesses)
    .where(eq(productionProcesses.id, productionProcessId))
    .limit(1);
  if (!process) {
    throw new Error("Production process not found");
  }
  const samplingMethod = process.samplingMethod as SamplingMethod;

  // Batches of the process + their production (end) date + pooled sample count.
  const batchRows = await db
    .select({
      batchId: creditBatches.id,
      batchCode: creditBatches.code,
      endDate: creditBatches.endDate,
      sampleCount: count(samples.id).mapWith(Number),
    })
    .from(creditBatches)
    .leftJoin(samples, eq(samples.creditBatchId, creditBatches.id))
    .where(eq(creditBatches.productionProcessId, productionProcessId))
    .groupBy(creditBatches.id);

  // `endDate` is a date string; a few hours' UTC offset is immaterial for a
  // 6-month window comparison.
  const batchesInWindow: BatchSampling[] = batchRows
    .filter((b) => {
      const d = new Date(b.endDate);
      return d >= cutoff && d <= asOf;
    })
    .map((b) => ({
      batchId: b.batchId,
      batchCode: b.batchCode,
      sampleCount: b.sampleCount,
    }));

  // Carbon measurements taken in the window (organic-carbon = the CC in Eq 4).
  const sampleRows = await db
    .select({
      organicCarbonPercent: samples.organicCarbonPercent,
      samplingTime: samples.samplingTime,
    })
    .from(samples)
    .innerJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .where(eq(creditBatches.productionProcessId, productionProcessId));

  const carbonValuesInWindow = sampleRows
    .filter((s) => s.samplingTime >= cutoff && s.samplingTime < asOf)
    .map((s) => s.organicCarbonPercent)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const drift = evaluateProcessComplianceDrift({
    method: samplingMethod,
    batchesInWindow,
    carbonValuesInWindow,
  });

  return {
    productionProcessId,
    samplingMethod,
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
  userId: string,
  params: { facilityId: string; feedstockTypeId: string; notes?: string | null },
): Promise<ProductionProcess> {
  requireAuth(userId);

  return db.transaction(async (tx) => {
    // Serialise against find-or-create for the same pair so a batch insert can't
    // race the reset and attach to a process that's about to be superseded.
    await lockCurrentProductionProcess(tx, params);

    const [created] = await tx
      .insert(productionProcesses)
      .values({
        facilityId: params.facilityId,
        feedstockTypeId: params.feedstockTypeId,
        notes: params.notes ?? null,
      })
      .returning();

    return created;
  });
}
