/**
 * Production-process Method-B operator lifecycle.
 *
 * Exercises the real UI at the two protocol boundaries an operator must
 * understand: Method B is unavailable below the 30-sample Method-A baseline,
 * then becomes an explicit declaration once the same process reaches 30.
 * Starting a new process is the intentional return to a fresh Method-A
 * campaign; the superseded Method-B process remains visible as history.
 */
import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { expect, test } from "./fixtures/auth-fixtures";
import { seedCertifierMapping } from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";

const BASELINE_BATCH_COUNT = 10;
const SAMPLES_PER_BATCH = 3;
const BASELINE_TARGET = BASELINE_BATCH_COUNT * SAMPLES_PER_BATCH;
const INITIAL_MONTHS = [
  {
    start: "2025-10-01",
    end: "2025-10-31",
    sampledOn: [
      "2025-10-05T10:00:00.000Z",
      "2025-10-15T10:00:00.000Z",
      "2025-10-25T10:00:00.000Z",
    ],
  },
  {
    start: "2025-11-01",
    end: "2025-11-30",
    sampledOn: [
      "2025-11-05T10:00:00.000Z",
      "2025-11-15T10:00:00.000Z",
      "2025-11-25T10:00:00.000Z",
    ],
  },
  {
    start: "2025-12-01",
    end: "2025-12-31",
    sampledOn: [
      "2025-12-05T10:00:00.000Z",
      "2025-12-15T10:00:00.000Z",
      "2025-12-25T10:00:00.000Z",
    ],
  },
] as const;
const ADDITIONAL_MONTHS = [
  {
    start: "2026-01-01",
    end: "2026-01-31",
    sampledOn: [
      "2026-01-05T10:00:00.000Z",
      "2026-01-15T10:00:00.000Z",
      "2026-01-25T10:00:00.000Z",
    ],
  },
  {
    start: "2026-02-01",
    end: "2026-02-28",
    sampledOn: [
      "2026-02-05T10:00:00.000Z",
      "2026-02-15T10:00:00.000Z",
      "2026-02-25T10:00:00.000Z",
    ],
  },
  {
    start: "2026-03-01",
    end: "2026-03-31",
    sampledOn: [
      "2026-03-05T10:00:00.000Z",
      "2026-03-15T10:00:00.000Z",
      "2026-03-25T10:00:00.000Z",
    ],
  },
  {
    start: "2026-04-01",
    end: "2026-04-30",
    sampledOn: [
      "2026-04-05T10:00:00.000Z",
      "2026-04-15T10:00:00.000Z",
      "2026-04-25T10:00:00.000Z",
    ],
  },
  {
    start: "2026-05-01",
    end: "2026-05-31",
    sampledOn: [
      "2026-05-05T10:00:00.000Z",
      "2026-05-15T10:00:00.000Z",
      "2026-05-25T10:00:00.000Z",
    ],
  },
  {
    start: "2026-06-01",
    end: "2026-06-30",
    sampledOn: [
      "2026-06-05T10:00:00.000Z",
      "2026-06-15T10:00:00.000Z",
      "2026-06-25T10:00:00.000Z",
    ],
  },
  {
    start: "2026-07-01",
    end: "2026-07-31",
    sampledOn: [
      "2026-07-01T10:00:00.000Z",
      "2026-07-05T10:00:00.000Z",
      "2026-07-10T10:00:00.000Z",
    ],
  },
] as const;
type BaselineMonth = (typeof INITIAL_MONTHS)[number] | (typeof ADDITIONAL_MONTHS)[number];

function sampleRowsForMonths(input: {
  months: readonly BaselineMonth[];
  batchIds: string[];
  tag: string;
  batchNumberOffset: number;
}) {
  return input.months.flatMap((month, batchIndex) =>
    month.sampledOn.map((sampledOn, replicateIndex) => ({
      id: crypto.randomUUID(),
      creditBatchId: input.batchIds[batchIndex],
      sampleCode: `E2E-MB-${input.tag}-${input.batchNumberOffset + batchIndex + 1}-S${replicateIndex + 1}`,
      samplingTime: new Date(sampledOn),
      totalCarbonPercent: 80 + replicateIndex,
      organicCarbonPercent: 78 + replicateIndex,
      hToCOrgRatio: 0.38 + replicateIndex * 0.01,
      oToCOrgRatio: 0.11 + replicateIndex * 0.01,
      randomReflectanceR0Percent: 2.5 + replicateIndex * 0.1,
      r0MeasurementCount: 100,
      residualCarbonPercent: 75 + replicateIndex,
      sReflectanceFraction: 0.8 + replicateIndex * 0.01,
    })),
  );
}

async function seedInitialThreeBatchBaseline(input: {
  facilityId: string;
  feedstockTypeId: string;
  tag: string;
}) {
  const { db, pool } = createDbConnection();
  const processId = crypto.randomUUID();
  const batchIds = INITIAL_MONTHS.map(() => crypto.randomUUID());

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.facilities)
        .set({ durabilityOption: "1000_year" })
        .where(eq(schema.facilities.id, input.facilityId));

      await tx.insert(schema.productionProcesses).values({
        id: processId,
        facilityId: input.facilityId,
        feedstockTypeId: input.feedstockTypeId,
        establishedAt: new Date("2025-10-01T00:00:00.000Z"),
      });

      await tx.insert(schema.creditBatches).values(
        INITIAL_MONTHS.map((month, index) => ({
          id: batchIds[index],
          code: `E2E-MB-${input.tag}-${index + 1}`,
          facilityId: input.facilityId,
          feedstockTypeId: input.feedstockTypeId,
          productionProcessId: processId,
          startDate: month.start,
          endDate: month.end,
        })),
      );

      await tx.insert(schema.samples).values(
        sampleRowsForMonths({
          months: INITIAL_MONTHS,
          batchIds,
          tag: input.tag,
          batchNumberOffset: 0,
        }),
      );
    });
  } finally {
    await pool.end();
  }

  return { processId, batchIds };
}

async function addSevenFullySampledBatches(input: {
  facilityId: string;
  feedstockTypeId: string;
  processId: string;
  tag: string;
}) {
  const { db, pool } = createDbConnection();
  const batchIds = ADDITIONAL_MONTHS.map(() => crypto.randomUUID());
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.creditBatches).values(
        ADDITIONAL_MONTHS.map((month, index) => ({
          id: batchIds[index],
          code: `E2E-MB-${input.tag}-${INITIAL_MONTHS.length + index + 1}`,
          facilityId: input.facilityId,
          feedstockTypeId: input.feedstockTypeId,
          productionProcessId: input.processId,
          startDate: month.start,
          endDate: month.end,
        })),
      );
      await tx.insert(schema.samples).values(
        sampleRowsForMonths({
          months: ADDITIONAL_MONTHS,
          batchIds,
          tag: input.tag,
          batchNumberOffset: INITIAL_MONTHS.length,
        }),
      );
    });
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
  test("explains the lock, unlocks at 30 samples, and starts a fresh Method-A process", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }, testInfo) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const mapping = await seedCertifierMapping(seededData.facility.id, {
      externalProjectId: `prj_e2e_method_b_${tag}`,
    });
    const seeded = await seedInitialThreeBatchBaseline({
      facilityId: seededData.facility.id,
      feedstockTypeId: seededData.feedstockType.id,
      tag,
    });

    try {
      await page.goto(
        `/certification/production-processes?facility=${seededData.facility.id}`,
      );

      const lockedRow = page.getByRole("button", {
        name: /9 \/ 30 eligible samples/i,
      });
      await expect(lockedRow).toBeVisible();
      await expect(lockedRow.getByText("21 more to qualify")).toBeVisible();
      await expect(lockedRow.getByText("On cadence")).toBeVisible();
      await expect(
        lockedRow.getByRole("button", { name: "Unlock", exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: testInfo.outputPath("method-b-locked-9-of-30.png"),
        fullPage: true,
      });

      await lockedRow.click();
      const detail = page.getByRole("dialog");
      await expect(detail.getByText("9 / 30 eligible samples")).toBeVisible();
      await expect(
        detail.getByRole("button", { name: "21 more to qualify" }),
      ).toBeDisabled();
      await detail.getByRole("button", { name: "Close" }).click();

      await addSevenFullySampledBatches({
        facilityId: seededData.facility.id,
        feedstockTypeId: seededData.feedstockType.id,
        processId: seeded.processId,
        tag,
      });
      await page.reload();

      const eligibleRow = page.getByRole("button", {
        name: /30 \/ 30 eligible samples/i,
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
      await page.screenshot({
        path: testInfo.outputPath("method-b-unlock-dialog.png"),
        fullPage: true,
      });

      await unlockDialog
        .getByRole("textbox", { name: "Random-sampling plan reference" })
        .fill("Synthetic QA PDD §6.2 plan v1");
      await unlockDialog
        .getByRole("button", { name: "Unlock Method B", exact: true })
        .click();

      await expect(page.getByText("Method B unlocked for this production process")).toBeVisible();
      const methodBRow = page.getByRole("button", { name: /Baseline cleared/i });
      await expect(methodBRow).toBeVisible();
      await expect(methodBRow.getByText("Method B", { exact: true })).toBeVisible();
      await methodBRow.click();

      const unlockedDetail = page.getByRole("dialog");
      await expect(unlockedDetail.getByText("30 samples")).toBeVisible();
      await expect(
        unlockedDetail.getByText("Synthetic QA PDD §6.2 plan v1"),
      ).toBeVisible();
      await unlockedDetail
        .getByRole("button", { name: "Start new process" })
        .click();

      const resetDialog = page.getByRole("dialog");
      await expect(
        resetDialog.getByText(/ending the current Method-B regime/i),
      ).toBeVisible();
      await resetDialog.getByLabel("Reason (optional)").fill(
        "Synthetic QA reset after feedstock-condition change",
      );
      await page.screenshot({
        path: testInfo.outputPath("method-b-start-new-process.png"),
        fullPage: true,
      });
      await resetDialog
        .getByRole("button", { name: "Start new process", exact: true })
        .click();

      await expect(page.getByText("Started a new production process")).toBeVisible();
      const freshMethodARow = page.getByRole("button", {
        name: /0 \/ 30 eligible samples/i,
      });
      await expect(freshMethodARow).toBeVisible();
      await expect(freshMethodARow.getByText("Method A", { exact: true })).toBeVisible();
      await expect(freshMethodARow.getByText("30 more to qualify")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("method-a-fresh-process.png"),
        fullPage: true,
      });
    } finally {
      await restoreMethodAForCleanup(seeded.processId);
      await mapping.cleanup();
    }
  });
});
