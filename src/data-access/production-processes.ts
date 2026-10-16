/** Production-process epochs and computed Method-B eligibility (ADR 0022). */

import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { db, type DbTransaction } from "@/db";
import {
  feedstockTypes,
  facilities,
  productionProcesses,
  type ProductionProcess,
} from "@/db/schema";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { deriveMethodBEligibility } from "@/lib/certification/method-b-eligibility";
import { SafeError } from "@/lib/errors";
import type {
  RecordMethodBPrerequisitesInput,
  StartNewProcessInput,
} from "@/schemas/production-process";
import { countEligibleSamplesByProcess } from "./isometric";
import {
  assertSameOrg,
  requireOrgScope,
} from "./utils";

type Executor = DbTransaction | typeof db;
const PRODUCTION_PROCESS_CURRENT_LOCK_SCOPE = "production-process-current";
const NEXT_CALENDAR_DAY = 1;

export async function lockProductionProcessScope(
  executor: Executor,
  params: { facilityId: string; feedstockTypeId: string },
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${PRODUCTION_PROCESS_CURRENT_LOCK_SCOPE}:${params.facilityId}:${params.feedstockTypeId}`}, 0))`,
  );
}

async function findProductionProcessAtDate(
  ctx: OrgContext,
  params: { facilityId: string; feedstockTypeId: string; batchStartDate: Date },
  executor: Executor,
): Promise<ProductionProcess | null> {
  // Batch dates are UTC calendar days, so a reset anywhere on that day applies.
  const nextDay = new Date(params.batchStartDate);
  nextDay.setUTCHours(0, 0, 0, 0);
  nextDay.setUTCDate(nextDay.getUTCDate() + NEXT_CALENDAR_DAY);
  const conditions = [
    eq(productionProcesses.facilityId, params.facilityId),
    eq(productionProcesses.feedstockTypeId, params.feedstockTypeId),
    eq(productionProcesses.organizationId, ctx.organizationId),
  ];
  const [process] = await executor
    .select()
    .from(productionProcesses)
    .where(
      and(...conditions, lt(productionProcesses.establishedAt, nextDay)),
    )
    .orderBy(desc(productionProcesses.establishedAt), desc(productionProcesses.createdAt), desc(productionProcesses.id))
    .limit(1);
  if (process) return process;

  // Back-entry before every epoch belongs to the earliest known process (#445).
  const [earliest] = await executor
    .select()
    .from(productionProcesses)
    .where(and(...conditions))
    .orderBy(asc(productionProcesses.establishedAt), desc(productionProcesses.createdAt), desc(productionProcesses.id))
    .limit(1);
  return earliest ?? null;
}

export async function findOrCreateProductionProcess(
  ctx: OrgContext,
  params: { facilityId: string; feedstockTypeId: string; startDate: Date },
  executor: Executor = db,
): Promise<ProductionProcess> {
  requireOrgScope(ctx);
  if (executor === db) {
    return db.transaction((tx) =>
      findOrCreateProductionProcess(ctx, params, tx),
    );
  }

  await assertSameOrg(ctx, facilities, params.facilityId, executor);
  await assertSameOrg(ctx, feedstockTypes, params.feedstockTypeId, executor);
  await lockProductionProcessScope(executor, params);
  const existing = await findProductionProcessAtDate(
    ctx, { ...params, batchStartDate: params.startDate }, executor,
  );
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

export async function startNewProductionProcess(
  ctx: OrgContext,
  input: StartNewProcessInput,
): Promise<ProductionProcess> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    await assertSameOrg(ctx, facilities, input.facilityId, tx);
    await assertSameOrg(ctx, feedstockTypes, input.feedstockTypeId, tx);
    await lockProductionProcessScope(tx, input);
    const [created] = await tx
      .insert(productionProcesses)
      .values({
        organizationId: ctx.organizationId,
        facilityId: input.facilityId,
        feedstockTypeId: input.feedstockTypeId,
        establishedAt: new Date(),
        notes: input.notes ?? null,
      })
      .returning();
    return created;
  });
}

export async function recordMethodBPrerequisites(
  ctx: OrgContext,
  input: RecordMethodBPrerequisitesInput,
): Promise<ProductionProcess> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  if (input.agreedBaselineSize < METHOD_B_MINIMUM_METHOD_A_SAMPLES) {
    throw new SafeError(
      `The agreed baseline must be at least ${METHOD_B_MINIMUM_METHOD_A_SAMPLES} Samples.`,
    );
  }
  await assertSameOrg(ctx, productionProcesses, input.processId);
  const [updated] = await db
    .update(productionProcesses)
    .set({
      agreedBaselineSize: input.agreedBaselineSize,
      randomSamplingPlanRef: input.randomSamplingPlanRef.trim(),
      moisturePathway: input.moisturePathway,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productionProcesses.id, input.processId),
        eq(productionProcesses.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  return updated;
}

export type MethodBEligibility =
  import("@/lib/certification/method-b-eligibility").MethodBEligibility;

export async function getMethodBEligibilityForProcess(
  ctx: OrgContext,
  process: ProductionProcess,
  executor: Executor = db,
): Promise<MethodBEligibility> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, productionProcesses, process.id, executor);
  const counts = await countEligibleSamplesByProcess(ctx, executor, {
    facilityId: process.facilityId,
    // Preview and save both count up to now, independently of the batch start day.
    asOfDate: new Date(),
  });
  return deriveMethodBEligibility({
    productionProcessId: process.id,
    eligibleSampleCount: counts.get(process.id) ?? 0,
    agreedBaselineSize: process.agreedBaselineSize,
    randomSamplingPlanRef: process.randomSamplingPlanRef,
    moisturePathway: process.moisturePathway,
  });
}

export async function getMethodBEligibility(
  ctx: OrgContext,
  params: { facilityId: string; feedstockTypeId: string; batchStartDate?: Date },
): Promise<MethodBEligibility> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, facilities, params.facilityId);
  await assertSameOrg(ctx, feedstockTypes, params.feedstockTypeId);
  const batchStartDate = params.batchStartDate ?? new Date();
  const process = await findProductionProcessAtDate(ctx, { ...params, batchStartDate }, db);
  if (!process) {
    return deriveMethodBEligibility({
      productionProcessId: null,
      eligibleSampleCount: 0,
      agreedBaselineSize: null,
      randomSamplingPlanRef: null,
      moisturePathway: null,
    });
  }
  return getMethodBEligibilityForProcess(ctx, process);
}
