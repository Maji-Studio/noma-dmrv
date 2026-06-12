import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { test, expect, type SeededChainData } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";

const FACILITY_TIMEZONE = "Africa/Nairobi";
const RUN_DATE = "2026-04-02";
const RUN_WINDOW_START = new Date("2026-04-01T21:00:00.000Z");
const RUN_WINDOW_END = new Date("2026-04-01T21:02:00.000Z");

async function seedProductionRun(seededData: SeededChainData) {
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID();
  const code = `E2E-PR-CSV-${crypto.randomUUID().slice(0, 8)}`;

  try {
    await db
      .update(schema.facilities)
      .set({ timezone: FACILITY_TIMEZONE })
      .where(eq(schema.facilities.id, seededData.facility.id));

    await db.insert(schema.productionRuns).values({
      id: runId,
      code,
      facilityId: seededData.facility.id,
      date: RUN_DATE,
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

test.describe("production run readings CSV import", () => {
  test("imports a reactor-day CSV through channel alignment", async ({
    adminPage: page,
    seededData,
  }) => {
    const run = await seedProductionRun(seededData);
    const csv = [
      "Time,Carbonization Outlet Temperature,Drying Drum Pressure,Main Gas Flow",
      "00:00:00,500,0.12,7.5",
      "00:01:00,---,0.13,",
      "00:02:00,510,0.14,8.1",
      ",,,",
    ].join("\n");

    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(run.code).first()).toBeVisible();

    const runRow = page.locator("tr", { hasText: run.code });
    await expect(
      runRow.getByLabel(/Incomplete for certification with 1 gap/),
    ).toBeVisible();
    await runRow.locator("td").first().click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit Production Run" }).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByText("Production Readings").first().scrollIntoViewIfNeeded();
    await expect(
      dialog.locator(`#production-run-${run.id}-readings-upload`),
    ).toBeAttached();

    await dialog
      .locator(`#production-run-${run.id}-readings-upload`)
      .setInputFiles({
        name: `${seededData.reactor.code} ${RUN_DATE} Data Evaluation.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });

    await expect(
      dialog.getByText(/Confirm channel alignment/),
    ).toBeVisible();
    await expect(page.locator("#temperatureColumn")).toHaveValue(
      "Carbonization Outlet Temperature",
    );
    await expect(page.locator("#pressureColumn")).toHaveValue(
      "Drying Drum Pressure",
    );
    await expect(page.locator("#gasFlowColumn")).toHaveValue("Main Gas Flow");

    await page.getByRole("button", { name: "Import Readings" }).click();

    await expect(page.getByText(/Imported 2 readings/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "500.0" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "0.12" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "7.500" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(runRow.getByLabel("Ready for certification")).toBeVisible();
  });
});
