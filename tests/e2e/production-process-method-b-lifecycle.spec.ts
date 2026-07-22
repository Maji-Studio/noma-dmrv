/**
 * Twelve-month 1000-year durability scenario with a Method-A/B lifecycle.
 *
 * Keeps the browser assertions at the operator seams while seeding the volume
 * directly: five realistic production runs per month, delayed lab results,
 * the 29→30 Method-B boundary, baseline-floor enforcement, twelve monthly
 * GHG-statement projections, and the intentional return to a fresh Method-A
 * process.
 */
import * as crypto from "crypto";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { expect, test } from "./fixtures/auth-fixtures";
import { seedCertifierMapping } from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const BASELINE_BATCH_COUNT = 10;
const SAMPLES_PER_BATCH = 3;
const BASELINE_TARGET = BASELINE_BATCH_COUNT * SAMPLES_PER_BATCH;
const INITIAL_SAMPLED_MONTHS = 3;
const LAST_BASELINE_MONTH_INDEX = BASELINE_BATCH_COUNT - 1;
const PRODUCTION_RUN_DAYS = [3, 9, 15, 21, 27] as const;
const SAMPLE_RUN_INDEXES = [1, 2, 3] as const;
const ANALYSIS_DELAY_DAYS = [7, 8, 9] as const;
const RUN_DURATION_HOURS = 4;
const FAR_FUTURE_SAMPLING_TIME = new Date("2999-01-01T12:00:00.000Z");
const METHOD_B_PLAN_REFERENCE = "E2E annual sampling plan §6.2";
const METHOD_B_BASELINE_FLOOR_MESSAGE = /reduce the Method B baseline below 30/i;
const TEST_TIMEOUT_MS = 180_000;

const MONTHS = [
  { start: "2025-07-01", end: "2025-07-31" },
  { start: "2025-08-01", end: "2025-08-31" },
  { start: "2025-09-01", end: "2025-09-30" },
  { start: "2025-10-01", end: "2025-10-31" },
  { start: "2025-11-01", end: "2025-11-30" },
  { start: "2025-12-01", end: "2025-12-31" },
  { start: "2026-01-01", end: "2026-01-31" },
  { start: "2026-02-01", end: "2026-02-28" },
  { start: "2026-03-01", end: "2026-03-31" },
  { start: "2026-04-01", end: "2026-04-30" },
  { start: "2026-05-01", end: "2026-05-31" },
  { start: "2026-06-01", end: "2026-06-30" },
] as const;

interface TwelveMonthScenario {
  processId: string;
  batchIds: string[];
  runIdsByMonth: string[][];
  firstBaselineSampleCode: string;
}

interface RegistryProjection {
  removalIds: string[];
  statementIds: string[];
}

function dateAtDay(monthIndex: number, day: number): Date {
  const month = MONTHS[monthIndex].start.slice(0, 7);
  return new Date(`${month}-${String(day).padStart(2, "0")}T08:00:00.000Z`);
}

function sampleRow(input: {
  tag: string;
  monthIndex: number;
  replicateIndex: number;
  batchId: string;
  samplingTime?: Date;
  codeSuffix?: string;
}) {
  const samplingTime =
    input.samplingTime ??
    dateAtDay(
      input.monthIndex,
      PRODUCTION_RUN_DAYS[SAMPLE_RUN_INDEXES[input.replicateIndex]],
    );
  const analysisDate = new Date(
    samplingTime.getTime() +
      ANALYSIS_DELAY_DAYS[input.replicateIndex] * MS_PER_DAY,
  )
    .toISOString()
    .slice(0, 10);

  return {
    id: crypto.randomUUID(),
    organizationId: DEC_ORG_ID,
    creditBatchId: input.batchId,
    sampleCode: `E2E-MB-${input.tag}-${input.monthIndex + 1}-${input.codeSuffix ?? `S${input.replicateIndex + 1}`}`,
    samplingTime,
    analysisDate,
    labName: "E2E ISO 17025 Lab",
    labAccreditation: "ISO/IEC 17025",
    totalCarbonPercent: 80 + input.replicateIndex,
    organicCarbonPercent: 78 + input.replicateIndex,
    hToCOrgRatio: 0.38 + input.replicateIndex * 0.01,
    oToCOrgRatio: 0.11 + input.replicateIndex * 0.01,
    randomReflectanceR0Percent: 2.5 + input.replicateIndex * 0.1,
    r0MeasurementCount: 100,
    residualCarbonPercent: 75 + input.replicateIndex,
    sReflectanceFraction: 0.8 + input.replicateIndex * 0.01,
  };
}

function sampleRowsForMonth(
  scenario: TwelveMonthScenario,
  tag: string,
  monthIndex: number,
  replicateIndexes: readonly number[] = [0, 1, 2],
) {
  return replicateIndexes.map((replicateIndex) =>
    sampleRow({
      tag,
      monthIndex,
      replicateIndex,
      batchId: scenario.batchIds[monthIndex],
    }),
  );
}

async function seedTwelveMonthScenario(input: {
  facilityId: string;
  reactorId: string;
  feedstockTypeId: string;
  feedstockStorageLocationId: string;
  biocharStorageLocationId: string;
  tag: string;
}): Promise<TwelveMonthScenario> {
  const { db, pool } = createDbConnection();
  const processId = crypto.randomUUID();
  const batchIds = MONTHS.map(() => crypto.randomUUID());
  const runIdsByMonth = MONTHS.map(() =>
    PRODUCTION_RUN_DAYS.map(() => crypto.randomUUID()),
  );
  const scenario: TwelveMonthScenario = {
    processId,
    batchIds,
    runIdsByMonth,
    firstBaselineSampleCode: `E2E-MB-${input.tag}-1-S1`,
  };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.facilities)
        .set({ durabilityOption: "1000_year" })
        .where(eq(schema.facilities.id, input.facilityId));

      await tx.insert(schema.productionProcesses).values({
        id: processId,
        organizationId: DEC_ORG_ID,
        facilityId: input.facilityId,
        feedstockTypeId: input.feedstockTypeId,
        establishedAt: new Date("2025-07-01T00:00:00.000Z"),
      });

      await tx.insert(schema.creditBatches).values(
        MONTHS.map((month, monthIndex) => ({
          id: batchIds[monthIndex],
          organizationId: DEC_ORG_ID,
          code: `E2E-MB-${input.tag}-CB-${monthIndex + 1}`,
          facilityId: input.facilityId,
          feedstockTypeId: input.feedstockTypeId,
          productionProcessId: processId,
          startDate: month.start,
          endDate: month.end,
        })),
      );

      const runRows = MONTHS.flatMap((_, monthIndex) =>
        PRODUCTION_RUN_DAYS.map((day, runIndex) => {
          const startTime = dateAtDay(monthIndex, day);
          return {
            id: runIdsByMonth[monthIndex][runIndex],
            organizationId: DEC_ORG_ID,
            code: `E2E-MB-${input.tag}-M${monthIndex + 1}-R${runIndex + 1}`,
            facilityId: input.facilityId,
            reactorId: input.reactorId,
            status: "complete" as const,
            startTime,
            endTime: new Date(
              startTime.getTime() + RUN_DURATION_HOURS * MS_PER_HOUR,
            ),
            dieselOperationLiters: 4 + runIndex,
            dieselGensetLiters: 3 + runIndex,
            preprocessingFuelLiters: 2 + runIndex,
            electricityKwh: 50 + runIndex * 5,
            biocharOutputKg: 120,
            biocharMoisturePercent: 5,
            biocharDryMassKg: 114,
            feedstockWetMassKg: 500,
            feedstockMoisturePercent: 20,
            feedstockMassDryKg: 400,
            feedstockStorageLocationId: input.feedstockStorageLocationId,
            biocharStorageLocationId: input.biocharStorageLocationId,
          };
        }),
      );
      await tx.insert(schema.productionRuns).values(runRows);
      await tx.insert(schema.creditBatchProductionRuns).values(
        MONTHS.flatMap((_, monthIndex) =>
          runIdsByMonth[monthIndex].map((productionRunId) => ({
            organizationId: DEC_ORG_ID,
            creditBatchId: batchIds[monthIndex],
            productionRunId,
          })),
        ),
      );

      await tx.insert(schema.samples).values(
        Array.from({ length: INITIAL_SAMPLED_MONTHS }, (_, monthIndex) =>
          sampleRowsForMonth(scenario, input.tag, monthIndex),
        ).flat(),
      );
    });
  } finally {
    await pool.end();
  }

  return scenario;
}

async function addPendingBaselineResults(
  scenario: TwelveMonthScenario,
  tag: string,
) {
  const { db, pool } = createDbConnection();
  try {
    const fullySampled = Array.from(
      { length: LAST_BASELINE_MONTH_INDEX - INITIAL_SAMPLED_MONTHS },
      (_, offset) =>
        sampleRowsForMonth(
          scenario,
          tag,
          INITIAL_SAMPLED_MONTHS + offset,
        ),
    ).flat();
    const twoValid = sampleRowsForMonth(
      scenario,
      tag,
      LAST_BASELINE_MONTH_INDEX,
      [0, 1],
    );
    const future = sampleRow({
      tag,
      monthIndex: LAST_BASELINE_MONTH_INDEX,
      replicateIndex: 2,
      batchId: scenario.batchIds[LAST_BASELINE_MONTH_INDEX],
      samplingTime: FAR_FUTURE_SAMPLING_TIME,
      codeSuffix: "FUTURE",
    });
    await db.insert(schema.samples).values([...fullySampled, ...twoValid, future]);
  } finally {
    await pool.end();
  }
}

async function addThirtiethEligibleSample(
  scenario: TwelveMonthScenario,
  tag: string,
) {
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.samples).values(
      sampleRowsForMonth(
        scenario,
        tag,
        LAST_BASELINE_MONTH_INDEX,
        [2],
      ),
    );
  } finally {
    await pool.end();
  }
}

async function seedMonthlyRegistryProjection(input: {
  scenario: TwelveMonthScenario;
  facilityId: string;
  tag: string;
}): Promise<RegistryProjection> {
  const { db, pool } = createDbConnection();
  const statementIds = MONTHS.map(() => crypto.randomUUID());
  const removalIds = MONTHS.map(() => crypto.randomUUID());
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.certifierGhgStatements).values(
        MONTHS.map((month, monthIndex) => ({
          id: statementIds[monthIndex],
          organizationId: DEC_ORG_ID,
          facilityId: input.facilityId,
          reportingPeriodStartOn: month.start,
          reportingPeriodEndOn: month.end,
        })),
      );
      await tx.insert(schema.certifierRemovals).values(
        MONTHS.map((month, monthIndex) => ({
          id: removalIds[monthIndex],
          organizationId: DEC_ORG_ID,
          facilityId: input.facilityId,
          startedOn: month.start,
          completedOn: month.end,
          ghgStatementId: statementIds[monthIndex],
        })),
      );
      for (let monthIndex = 0; monthIndex < MONTHS.length; monthIndex += 1) {
        await tx
          .update(schema.creditBatches)
          .set({ removalId: removalIds[monthIndex] })
          .where(eq(schema.creditBatches.id, input.scenario.batchIds[monthIndex]));
      }
      await tx.insert(schema.certificationSubmissions).values([
        ...removalIds.map((removalId, monthIndex) => ({
          organizationId: DEC_ORG_ID,
          provider: "isometric" as const,
          submissionType: "removal",
          localEntityType: "removal",
          localEntityId: removalId,
          externalId: `rmv_e2e_${input.tag}_${monthIndex + 1}`,
          version: 1,
          status: "submitted" as const,
          submittedAt: new Date(`${MONTHS[monthIndex].end}T12:00:00.000Z`),
        })),
        ...statementIds.map((statementId, monthIndex) => ({
          organizationId: DEC_ORG_ID,
          provider: "isometric" as const,
          submissionType: "ghg_statement",
          localEntityType: "ghgStatement",
          localEntityId: statementId,
          externalId: `ggs_e2e_${input.tag}_${monthIndex + 1}`,
          version: 1,
          status: "submitted" as const,
          submittedAt: new Date(`${MONTHS[monthIndex].end}T12:00:00.000Z`),
          metadata: { remoteStatus: "DRAFT" },
        })),
      ]);
    });
  } finally {
    await pool.end();
  }
  return { removalIds, statementIds };
}

async function cleanupRegistryProjection(
  projection: RegistryProjection | null,
  batchIds: string[],
) {
  if (!projection) return;
  const { db, pool } = createDbConnection();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.creditBatches)
        .set({ removalId: null })
        .where(inArray(schema.creditBatches.id, batchIds));
      await tx
        .delete(schema.certificationSubmissions)
        .where(
          inArray(schema.certificationSubmissions.localEntityId, [
            ...projection.removalIds,
            ...projection.statementIds,
          ]),
        );
      await tx
        .delete(schema.certifierRemovals)
        .where(inArray(schema.certifierRemovals.id, projection.removalIds));
      await tx
        .delete(schema.certifierGhgStatements)
        .where(
          inArray(schema.certifierGhgStatements.id, projection.statementIds),
        );
    });
  } finally {
    await pool.end();
  }
}

async function assertMonthlyRegistryProjection(
  projection: RegistryProjection,
  batchIds: string[],
) {
  const { db, pool } = createDbConnection();
  try {
    const [batchLinks, removalLinks, statementRows] = await Promise.all([
      db
        .select({ id: schema.creditBatches.id, removalId: schema.creditBatches.removalId })
        .from(schema.creditBatches)
        .where(inArray(schema.creditBatches.id, batchIds)),
      db
        .select({
          id: schema.certifierRemovals.id,
          ghgStatementId: schema.certifierRemovals.ghgStatementId,
        })
        .from(schema.certifierRemovals)
        .where(inArray(schema.certifierRemovals.id, projection.removalIds)),
      db
        .select({ id: schema.certifierGhgStatements.id })
        .from(schema.certifierGhgStatements)
        .where(inArray(schema.certifierGhgStatements.id, projection.statementIds)),
    ]);
    const removalByBatch = new Map(
      batchLinks.map((row) => [row.id, row.removalId]),
    );
    const statementByRemoval = new Map(
      removalLinks.map((row) => [row.id, row.ghgStatementId]),
    );

    expect(statementRows).toHaveLength(MONTHS.length);
    for (let monthIndex = 0; monthIndex < MONTHS.length; monthIndex += 1) {
      expect(removalByBatch.get(batchIds[monthIndex])).toBe(
        projection.removalIds[monthIndex],
      );
      expect(statementByRemoval.get(projection.removalIds[monthIndex])).toBe(
        projection.statementIds[monthIndex],
      );
    }
  } finally {
    await pool.end();
  }
}

async function restoreMethodAForCleanup(processId: string) {
  const { db, pool } = createDbConnection();
  try {
    await db
      .update(schema.productionProcesses)
      .set({
        samplingMethod: "method_a",
        methodBUnlockedAt: null,
        agreedBaselineSize: null,
        randomSamplingPlanRef: null,
        moisturePathway: null,
      })
      .where(eq(schema.productionProcesses.id, processId));
  } finally {
    await pool.end();
  }
}

test.describe("production-process Method-B lifecycle", () => {
  test("runs twelve realistic months through Method A/B and monthly statement projections", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }, testInfo) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const mapping = await seedCertifierMapping(seededData.facility.id, {
      externalProjectId: `prj_e2e_method_b_${tag}`,
    });
    const scenario = await seedTwelveMonthScenario({
      facilityId: seededData.facility.id,
      reactorId: seededData.reactor.id,
      feedstockTypeId: seededData.feedstockType.id,
      feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
      biocharStorageLocationId: seededData.biocharStorageLocation.id,
      tag,
    });
    let projection: RegistryProjection | null = null;

    try {
      await page.goto(
        `/certification/production-processes?facility=${seededData.facility.id}`,
      );

      const lockedRow = page.getByRole("button", {
        name: /9 \/ 30 baseline samples/i,
      });
      await expect(lockedRow).toBeVisible();
      await expect(lockedRow.getByText("21 more to qualify")).toBeVisible();
      await expect(lockedRow.getByText("Sample 9 more")).toBeVisible();
      await expect(
        lockedRow.getByRole("button", { name: "Unlock", exact: true }),
      ).toBeDisabled();

      await addPendingBaselineResults(scenario, tag);
      await page.reload();

      const twentyNineRow = page.getByRole("button", {
        name: /29 \/ 30 baseline samples/i,
      });
      await expect(twentyNineRow).toBeVisible();
      await expect(twentyNineRow.getByText("1 more to qualify")).toBeVisible();
      await expect(
        twentyNineRow.getByRole("button", { name: "Unlock", exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: testInfo.outputPath("method-b-future-sample-excluded-29-of-30.png"),
        fullPage: true,
      });

      await addThirtiethEligibleSample(scenario, tag);
      await page.reload();

      const eligibleRow = page.getByRole("button", {
        name: /30 \/ 30 baseline samples/i,
      });
      await expect(eligibleRow).toBeVisible();
      await expect(
        eligibleRow.getByText("Eligible to unlock Method B"),
      ).toBeVisible();
      await eligibleRow
        .getByRole("button", { name: "Unlock", exact: true })
        .click();

      const unlockDialog = page.getByRole("dialog");
      await expect(
        unlockDialog.getByRole("heading", { name: "Unlock Method B" }),
      ).toBeVisible();
      await expect(
        unlockDialog.getByText("What you're agreeing to"),
      ).toBeVisible();
      await expect(unlockDialog.getByLabel("Agreed baseline size")).toHaveValue(
        String(BASELINE_TARGET),
      );
      await unlockDialog
        .getByRole("textbox", { name: "Random-sampling plan reference" })
        .fill(METHOD_B_PLAN_REFERENCE);
      await unlockDialog
        .getByRole("button", { name: "Unlock Method B", exact: true })
        .click();

      await expect(
        page.getByText("Method B unlocked for this production process"),
      ).toBeVisible();
      const methodBRow = page.getByRole("button", { name: /Baseline cleared/i });
      await expect(methodBRow.getByText("Method B", { exact: true })).toBeVisible();

      await page.goto(`/samples?facility=${seededData.facility.id}`);
      await page.getByLabel("Search table").fill(scenario.firstBaselineSampleCode);
      await page
        .getByRole("button", {
          name: `Actions for ${scenario.firstBaselineSampleCode}`,
          exact: true,
        })
        .click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      const deleteDialog = page.getByRole("dialog");
      await deleteDialog
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(page.getByText(METHOD_B_BASELINE_FLOOR_MESSAGE)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("method-b-baseline-delete-explained.png"),
        fullPage: true,
      });
      await deleteDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();

      const { db: sampleDb, pool: samplePool } = createDbConnection();
      try {
        const monthTwelveSamples = await sampleDb
          .select({ id: schema.samples.id })
          .from(schema.samples)
          .where(
            eq(
              schema.samples.creditBatchId,
              scenario.batchIds[MONTHS.length - 1],
            ),
          );
        expect(monthTwelveSamples).toHaveLength(0);
      } finally {
        await samplePool.end();
      }

      projection = await seedMonthlyRegistryProjection({
        scenario,
        facilityId: seededData.facility.id,
        tag,
      });
      await assertMonthlyRegistryProjection(projection, scenario.batchIds);
      await page.goto(
        `/certification/ghg-statements?facility=${seededData.facility.id}`,
      );
      await expect(page.getByText("Statements (12)")).toBeVisible();
      const statementsTable = page.getByRole("table", {
        name: "GHG statements",
      });
      await expect(statementsTable.getByText(/^ggs_e2e_/i)).toHaveCount(
        MONTHS.length,
      );
      await expect(
        statementsTable.getByText("1 removal", { exact: true }),
      ).toHaveCount(MONTHS.length);
      await page.screenshot({
        path: testInfo.outputPath("twelve-monthly-ghg-statements.png"),
        fullPage: true,
      });

      await page.goto(
        `/certification/production-processes?facility=${seededData.facility.id}`,
      );
      const historicalMethodBRow = page.getByRole("button", {
        name: /Baseline cleared/i,
      });
      await historicalMethodBRow.click();
      const unlockedDetail = page.getByRole("dialog");
      await expect(unlockedDetail.getByText("30 samples")).toBeVisible();
      await expect(unlockedDetail.getByText(METHOD_B_PLAN_REFERENCE)).toBeVisible();
      await unlockedDetail
        .getByRole("button", { name: "Start new process" })
        .click();

      const resetDialog = page.getByRole("dialog");
      await expect(
        resetDialog.getByText(/ending the current Method-B regime/i),
      ).toBeVisible();
      await resetDialog.getByLabel("Reason (optional)").fill(
        "E2E feedstock-condition change after the annual reporting cycle",
      );
      await resetDialog
        .getByRole("button", { name: "Start new process", exact: true })
        .click();

      await expect(page.getByText("Started a new production process")).toBeVisible();
      await expect(page.getByText(METHOD_B_PLAN_REFERENCE)).toBeHidden();
      const freshMethodARow = page.getByRole("button", {
        name: /0 \/ 30 baseline samples/i,
      });
      await expect(freshMethodARow.getByText("Method A", { exact: true })).toBeVisible();
      await expect(freshMethodARow.getByText("30 more to qualify")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Baseline cleared/i }),
      ).toBeVisible();
    } finally {
      try {
        await cleanupRegistryProjection(projection, scenario.batchIds);
      } finally {
        try {
          await restoreMethodAForCleanup(scenario.processId);
        } finally {
          await mapping.cleanup();
        }
      }
    }
  });
});
