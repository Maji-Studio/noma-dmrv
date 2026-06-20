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
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import {
  deriveSamplingRequirement,
  type SamplingMethod,
} from "@/lib/certification/sampling-requirements";
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
