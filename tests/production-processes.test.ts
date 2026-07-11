/**
 * Production Process Data Access Tests
 *
 * Integration tests for findOrCreateProductionProcess (ADR 0016): the
 * (facility, feedstock) sampling-regime campaign that scopes Method A/B. A
 * credit batch auto-finds-or-creates one when it is formed, defaulting to
 * Method A; the "current" process for a pair is the most recently established.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test defaults).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { creditBatches, samples } from "@/db/schema";
import {
  findOrCreateProductionProcess,
  getProductionProcessSummariesByFacility,
} from "@/data-access/production-processes";
import { countEligibleSamplesByProcess } from "@/data-access/isometric";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

const createdIds = {
  facilities: [] as string[],
  feedstockTypes: [] as string[],
  creditBatches: [] as string[],
  samples: [] as string[],
};

let facilityId: string;
let feedstockTypeId: string;

const METHOD_B_UNLOCKED_AT = new Date("2026-02-01T00:00:00.000Z");
const FAR_FUTURE_SAMPLING_TIME = new Date("2999-01-01T12:00:00.000Z");
const METHOD_B_SAMPLE_WRITE_GUARDS_MIGRATION = resolve(
  process.cwd(),
  "drizzle/0062_process_method_b_sample_write_guards.sql",
);

async function applyMethodBSampleWriteGuards(): Promise<void> {
  const migrationSql = readFileSync(
    METHOD_B_SAMPLE_WRITE_GUARDS_MIGRATION,
    "utf8",
  );
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function createMethodBProcessWithBaseline(tag: string): Promise<{
  processId: string;
  batchId: string;
  sampleIds: string[];
}> {
  const suffix = `${Date.now().toString(36)}-${tag}`;
  const [process] = await db
    .insert(productionProcesses)
    .values({
      facilityId,
      feedstockTypeId,
      establishedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning({ id: productionProcesses.id });

  const [batch] = await db
    .insert(creditBatches)
    .values({
      code: `CB-PROC-MB-${suffix}`,
      facilityId,
      feedstockTypeId,
      productionProcessId: process.id,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      certifier: "isometric",
    })
    .returning({ id: creditBatches.id });
  createdIds.creditBatches.push(batch.id);

  const insertedSamples = await db
    .insert(samples)
    .values(
      Array.from({ length: 30 }, (_, index) => ({
        creditBatchId: batch.id,
        sampleCode: `S-PROC-MB-${suffix}-${index}`,
        samplingTime: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`),
        totalCarbonPercent: 80,
        organicCarbonPercent: 75,
      })),
    )
    .returning({ id: samples.id });
  const sampleIds = insertedSamples.map((sample) => sample.id);
  createdIds.samples.push(...sampleIds);

  await db
    .update(productionProcesses)
    .set({
      samplingMethod: "method_b",
      methodBUnlockedAt: METHOD_B_UNLOCKED_AT,
      agreedBaselineSize: 30,
      randomSamplingPlanRef: "test sampling plan",
      moisturePathway: "measured_every_batch",
    })
    .where(eq(productionProcesses.id, process.id));

  return { processId: process.id, batchId: batch.id, sampleIds };
}

beforeAll(async () => {
  await applyMethodBSampleWriteGuards();

  const runId = Date.now().toString(36);

  const [facility] = await db
    .insert(facilities)
    .values({ name: `Process Test Facility ${runId}`, code: `FAC-PROC-${runId}` })
    .returning({ id: facilities.id });
  facilityId = facility.id;
  createdIds.facilities.push(facility.id);

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      name: `Process Test Feedstock ${runId}`,
      code: `FT-PROC-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  feedstockTypeId = feedstockType.id;
  createdIds.feedstockTypes.push(feedstockType.id);
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    if (createdIds.facilities.length > 0) {
      await tx
        .update(productionProcesses)
        .set({
          samplingMethod: "method_a",
          methodBUnlockedAt: null,
          agreedBaselineSize: null,
          randomSamplingPlanRef: null,
          moisturePathway: null,
        })
        .where(inArray(productionProcesses.facilityId, createdIds.facilities));
    }
    if (createdIds.samples.length > 0) {
      await tx.delete(samples).where(inArray(samples.id, createdIds.samples));
    }
    if (createdIds.creditBatches.length > 0) {
      await tx
        .delete(creditBatches)
        .where(inArray(creditBatches.id, createdIds.creditBatches));
    }
    await tx
      .delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, createdIds.facilities));
    if (createdIds.feedstockTypes.length > 0) {
      await tx
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, createdIds.feedstockTypes));
    }
    if (createdIds.facilities.length > 0) {
      await tx
        .delete(facilities)
        .where(inArray(facilities.id, createdIds.facilities));
    }
  });
});

describe("findOrCreateProductionProcess", () => {
  it("creates a Method A process when none exists for the pair", async () => {
    const process = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });

    expect(process.facilityId).toBe(facilityId);
    expect(process.feedstockTypeId).toBe(feedstockTypeId);
    expect(process.samplingMethod).toBe("method_a");
    expect(process.methodBUnlockedAt).toBeNull();
    expect(process.establishedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — a second call returns the same process, not a duplicate", async () => {
    const first = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });
    const second = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });

    expect(second.id).toBe(first.id);

    const rows = await db
      .select({ id: productionProcesses.id })
      .from(productionProcesses)
      .where(inArray(productionProcesses.facilityId, [facilityId]));
    expect(rows).toHaveLength(1);
  });

  it("returns the most recently established process when several exist for the pair", async () => {
    // A feedstock/condition change opens a NEW process and resets the baseline;
    // the current one is the latest established. Insert a newer process directly.
    const [newer] = await db
      .insert(productionProcesses)
      .values({
        facilityId,
        feedstockTypeId,
        establishedAt: new Date("2999-01-01T00:00:00.000Z"),
      })
      .returning({ id: productionProcesses.id });

    const resolved = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });

    expect(resolved.id).toBe(newer.id);
  });

  it("rejects an unauthenticated user", async () => {
    await expect(
      findOrCreateProductionProcess("", { facilityId, feedstockTypeId }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("uses the canonical process sample count in the summary surface", async () => {
    const runId = Date.now().toString(36);
    const process = await findOrCreateProductionProcess(TEST_USER_ID, {
      facilityId,
      feedstockTypeId,
    });
    const [sampledBatch, unsampledBatch] = await db
      .insert(creditBatches)
      .values([
        {
          code: `CB-PROC-SAMPLED-${runId}`,
          facilityId,
          feedstockTypeId,
          productionProcessId: process.id,
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          certifier: "isometric",
        },
        {
          code: `CB-PROC-UNSAMPLED-${runId}`,
          facilityId,
          feedstockTypeId,
          productionProcessId: process.id,
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          certifier: "isometric",
        },
      ])
      .returning({ id: creditBatches.id });
    createdIds.creditBatches.push(sampledBatch.id, unsampledBatch.id);

    const insertedSamples = await db
      .insert(samples)
      .values(
        [0, 1, 2].map((index) => ({
          creditBatchId: sampledBatch.id,
          sampleCode: `S-PROC-${runId}-${index}`,
          samplingTime: new Date(`2026-01-0${index + 1}T12:00:00.000Z`),
          totalCarbonPercent: 80,
          organicCarbonPercent: 75,
        })),
      )
      .returning({ id: samples.id });
    createdIds.samples.push(...insertedSamples.map((sample) => sample.id));

    const [futureSample] = await db
      .insert(samples)
      .values({
        creditBatchId: sampledBatch.id,
        sampleCode: `S-PROC-${runId}-FUTURE`,
        samplingTime: FAR_FUTURE_SAMPLING_TIME,
        totalCarbonPercent: 80,
        organicCarbonPercent: 75,
      })
      .returning({ id: samples.id });
    createdIds.samples.push(futureSample.id);

    const countsByProcess = await countEligibleSamplesByProcess(db, {
      facilityId,
      asOfDate: new Date(),
    });
    const summaries = await getProductionProcessSummariesByFacility(
      TEST_USER_ID,
      facilityId,
    );
    const summary = summaries.find((item) => item.id === process.id);

    expect(countsByProcess.get(process.id)).toBe(3);
    expect(summary?.eligibleSampleCount).toBe(3);
    expect(summary?.totalBatches).toBe(2);
    expect(summary?.sampledBatches).toBe(1);
    expect(summary?.requiredSampledBatches).toBe(2);
    expect(summary?.cadenceMet).toBe(false);
  });

  it("blocks deleting pre-unlock baseline samples from a Method-B process", async () => {
    const fixture = await createMethodBProcessWithBaseline("delete");

    await expect(
      db.delete(samples).where(eq(samples.id, fixture.sampleIds[0])),
    ).rejects.toThrow(/Failed query/i);

    const [sample] = await db
      .select({ id: samples.id })
      .from(samples)
      .where(eq(samples.id, fixture.sampleIds[0]));
    expect(sample?.id).toBe(fixture.sampleIds[0]);
  });

  it("blocks clearing a pre-unlock sample's credit-batch link from a Method-B process", async () => {
    const fixture = await createMethodBProcessWithBaseline("unlink");

    await expect(
      db
        .update(samples)
        .set({ creditBatchId: null })
        .where(eq(samples.id, fixture.sampleIds[0])),
    ).rejects.toThrow(/Failed query/i);

    const [sample] = await db
      .select({ creditBatchId: samples.creditBatchId })
      .from(samples)
      .where(eq(samples.id, fixture.sampleIds[0]));
    expect(sample?.creditBatchId).toBe(fixture.batchId);
  });

  it("blocks repointing a baseline credit batch away from a Method-B process", async () => {
    const fixture = await createMethodBProcessWithBaseline("repoint");
    const [targetProcess] = await db
      .insert(productionProcesses)
      .values({
        facilityId,
        feedstockTypeId,
        establishedAt: new Date("2026-03-01T00:00:00.000Z"),
      })
      .returning({ id: productionProcesses.id });

    await expect(
      db
        .update(creditBatches)
        .set({ productionProcessId: targetProcess.id })
        .where(eq(creditBatches.id, fixture.batchId)),
    ).rejects.toThrow(/Failed query/i);

    const [batch] = await db
      .select({ productionProcessId: creditBatches.productionProcessId })
      .from(creditBatches)
      .where(eq(creditBatches.id, fixture.batchId));
    expect(batch?.productionProcessId).toBe(fixture.processId);
  });
});
