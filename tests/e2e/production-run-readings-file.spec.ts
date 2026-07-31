import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { test, expect, type SeededChainData } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";

const RUN_WINDOW_START = new Date("2026-04-02T00:00:00.000Z");
const RUN_WINDOW_END = new Date("2026-04-02T00:02:00.000Z");
const CSV_FILE_NAME = "reactor-original.csv";
const UNINSPECTED_CSV = "unexpected,columns\nnot-a-timestamp,not-a-reading\n";

async function loadStoredEvidence(runId: string) {
  const { db, pool } = createDbConnection();
  try {
    const documents = await db
      .select({
        id: schema.documents.id,
        entityType: schema.documents.entityType,
        documentType: schema.documents.documentType,
        fileName: schema.documents.fileName,
        uploadStatus: schema.documents.uploadStatus,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.organizationId, DEC_ORG_ID),
          eq(schema.documents.entityId, runId),
          eq(schema.documents.documentType, "sensor_data"),
        ),
      );
    const readings = await db
      .select({ id: schema.productionRunReadings.id })
      .from(schema.productionRunReadings)
      .where(
        and(
          eq(schema.productionRunReadings.organizationId, DEC_ORG_ID),
          eq(schema.productionRunReadings.productionRunId, runId),
        ),
      );
    return { documents, readings };
  } finally {
    await pool.end();
  }
}

async function seedProductionRun(seededData: SeededChainData) {
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID();
  const code = `E2E-PR-CSV-${crypto.randomUUID().slice(0, 8)}`;

  try {
    await db.insert(schema.productionRuns).values({
      organizationId: DEC_ORG_ID,
      id: runId,
      code,
      facilityId: seededData.facility.id,
      status: "complete",
      startTime: RUN_WINDOW_START,
      endTime: RUN_WINDOW_END,
      reactorId: seededData.reactor.id,
      feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
      feedstockWetMassKg: 50,
      feedstockMoisturePercent: 15,
      feedstockMassDryKg: 42.5,
      biocharStorageLocationId: seededData.biocharStorageLocation.id,
      biocharOutputKg: 20,
      biocharMoisturePercent: 5,
      biocharDryMassKg: 19,
      dieselOperationLiters: 0,
      dieselGensetLiters: 0,
      preprocessingFuelLiters: 0,
      electricityKwh: 0,
    });
  } finally {
    await pool.end();
  }

  return { id: runId, code };
}

test.describe("production run readings file", () => {
  test("stores the original CSV as document evidence without importing rows", async ({
    adminPage: page,
    seededData,
  }) => {
    const run = await seedProductionRun(seededData);

    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await expect(page.getByText(run.code).first()).toBeVisible();
    const runRow = page.locator("tr", { hasText: run.code });
    await expect(
      runRow.getByLabel(/Incomplete for certification with 1 gap/),
    ).toBeVisible();

    await runRow.locator("td").first().click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit Production Run" }).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByText("Readings file").first().scrollIntoViewIfNeeded();

    const uploadInput = dialog.locator(
      `#production-run-${run.id}-readings-upload`,
    );
    await uploadInput.setInputFiles({
      name: CSV_FILE_NAME,
      mimeType: "text/csv",
      buffer: Buffer.from(UNINSPECTED_CSV),
    });

    await expect(dialog.getByText(CSV_FILE_NAME)).toBeVisible({
      timeout: 30000,
    });
    const openLink = dialog.getByRole("link", {
      name: `Open ${CSV_FILE_NAME}`,
    });
    await expect(openLink).toHaveAttribute(
      "href",
      /\/api\/documents\/[0-9a-f-]+/,
    );
    await expect(openLink).toHaveAttribute("target", "_blank");
    await expect(dialog.getByRole("button", { name: /Re-import/ })).toHaveCount(
      0,
    );
    await expect(dialog.getByText(/Imported \d+ reading/)).toHaveCount(0);
    await expect(runRow.getByLabel("Ready for certification")).toBeVisible();

    const stored = await loadStoredEvidence(run.id);
    expect(stored.documents).toMatchObject([
      {
        entityType: "production_run",
        documentType: "sensor_data",
        fileName: CSV_FILE_NAME,
        uploadStatus: "uploaded",
      },
    ]);
    expect(stored.readings).toEqual([]);
  });
});
