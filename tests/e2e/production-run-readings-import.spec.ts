import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { test, expect, type SeededChainData } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";
import { parseReadingsCsv } from "../../src/lib/production-readings/readings-csv";

// A canonical readings CSV carries a full UTC timestamp per row, so the run
// window is expressed directly in UTC (no facility-timezone conversion).
const RUN_WINDOW_START = new Date("2026-04-02T00:00:00.000Z");
const RUN_WINDOW_END = new Date("2026-04-02T00:02:00.000Z");

// timestamp_utc, temperature_c, pressure_bar, dryer_frequency_hz, reactor_frequency_hz
const READINGS_CSV = [
  "timestamp_utc,temperature_c,pressure_bar,dryer_frequency_hz,reactor_frequency_hz",
  "2026-04-02T00:00:00Z,500,0.12,35,25",
  "2026-04-02T00:01:00Z,---,0.13,34.5,",
  "2026-04-02T00:02:00Z,510,0.14,35.1,24.8", // == window end (exclusive) -> dropped
  "",
].join("\n");

const CSV_FILE_NAME = "reactor-readings 2026-04-02.csv";

// Same headers, but every timestamp lands outside the run window, so the import
// fails loudly (nothing to insert) while the upload itself succeeds — the exact
// shape that must leave a recoverable, re-importable document (#398).
const OUT_OF_WINDOW_CSV = [
  "timestamp_utc,temperature_c,pressure_bar",
  "2026-05-01T00:00:00Z,500,0.12",
  "",
].join("\n");

async function countReadings(runId: string): Promise<number> {
  const { db, pool } = createDbConnection();
  try {
    const rows = await db
      .select({ id: schema.productionRunReadings.id })
      .from(schema.productionRunReadings)
      .where(eq(schema.productionRunReadings.productionRunId, runId));
    return rows.length;
  } finally {
    await pool.end();
  }
}

async function openReadingsUpload(
  page: import("@playwright/test").Page,
  seededData: SeededChainData,
  run: { id: string; code: string },
) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await expect(page.getByText(run.code).first()).toBeVisible();
  const runRow = page.locator("tr", { hasText: run.code });
  await runRow.locator("td").first().click();
  await waitForSideSheet(page);
  await page.getByRole("button", { name: "Edit Production Run" }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByText("Readings CSV Import").first().scrollIntoViewIfNeeded();
  const uploadInput = dialog.locator(
    `#production-run-${run.id}-readings-upload`,
  );
  await expect(uploadInput).toBeAttached();
  return { dialog, uploadInput };
}

async function seedProductionRun(seededData: SeededChainData) {
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID();
  const code = `E2E-PR-CSV-${crypto.randomUUID().slice(0, 8)}`;

  try {
    await db.insert(schema.productionRuns).values({
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

test.describe("production run readings CSV import", () => {
  test("imports a canonical readings CSV directly on upload", async ({
    adminPage: page,
    seededData,
  }) => {
    const run = await seedProductionRun(seededData);
    const parsed = parseReadingsCsv({
      csvText: READINGS_CSV,
      runWindowStart: RUN_WINDOW_START,
      runWindowEnd: RUN_WINDOW_END,
    });
    expect(parsed.inWindowRows).toBe(2);
    const firstReading = parsed.readings[0];
    expect(firstReading).toBeDefined();

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

    await dialog.getByText("Readings CSV Import").first().scrollIntoViewIfNeeded();
    const uploadInput = dialog.locator(
      `#production-run-${run.id}-readings-upload`,
    );
    await expect(uploadInput).toBeAttached();

    await uploadInput.setInputFiles({
      name: CSV_FILE_NAME,
      mimeType: "text/csv",
      buffer: Buffer.from(READINGS_CSV),
    });

    // No channel-alignment step — the canonical CSV imports straight away.
    await expect(
      page.getByText(new RegExp(`Imported ${parsed.inWindowRows} readings`)),
    ).toBeVisible({ timeout: 30000 });

    await expect(
      page
        .getByRole("cell", {
          name: firstReading!.temperatureC?.toFixed(1) ?? "—",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("cell", {
          name: firstReading!.dryerFrequencyHz?.toFixed(1) ?? "—",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("cell", {
          name: firstReading!.reactorFrequencyHz?.toFixed(1) ?? "—",
          exact: true,
        })
        .first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(runRow.getByLabel("Ready for certification")).toBeVisible();
  });

  test("re-importing the same file skips already-imported rows (#398)", async ({
    adminPage: page,
    seededData,
  }) => {
    const run = await seedProductionRun(seededData);
    const { uploadInput } = await openReadingsUpload(page, seededData, run);

    // First import: 2 rows in-window, 1 dropped at the exclusive window end.
    await uploadInput.setInputFiles({
      name: CSV_FILE_NAME,
      mimeType: "text/csv",
      buffer: Buffer.from(READINGS_CSV),
    });
    await expect(
      page.getByText(/Imported 2 readings/).first(),
    ).toBeVisible({ timeout: 30000 });
    expect(await countReadings(run.id)).toBe(2);

    // Second import of the identical file: every in-window row already exists,
    // so ON CONFLICT DO NOTHING inserts nothing and the operator is told the
    // rows were already imported. No duplicate rows are created.
    await uploadInput.setInputFiles({
      name: CSV_FILE_NAME,
      mimeType: "text/csv",
      buffer: Buffer.from(READINGS_CSV),
    });
    await expect(
      page.getByText(/Imported 0 readings.*2 already imported/).first(),
    ).toBeVisible({ timeout: 30000 });
    expect(await countReadings(run.id)).toBe(2);
  });

  test("a failed import stays recoverable via a Re-import action (#398)", async ({
    adminPage: page,
    seededData,
  }) => {
    const run = await seedProductionRun(seededData);
    const { dialog, uploadInput } = await openReadingsUpload(
      page,
      seededData,
      run,
    );

    // Upload succeeds, but the import fails because nothing lands in-window.
    await uploadInput.setInputFiles({
      name: CSV_FILE_NAME,
      mimeType: "text/csv",
      buffer: Buffer.from(OUT_OF_WINDOW_CSV),
    });
    await expect(
      page.getByText(/None of the 1 timestamped row\(s\) fall within/).first(),
    ).toBeVisible({ timeout: 30000 });
    expect(await countReadings(run.id)).toBe(0);

    // The failed document is flagged and offers a scoped re-import affordance;
    // successful documents never get one.
    await expect(dialog.getByText("Import failed").first()).toBeVisible({
      timeout: 30000,
    });
    const reimport = dialog.getByRole("button", { name: /Re-import/ });
    await expect(reimport).toBeVisible();

    // The action wires all the way through fn -> data-access and reports.
    await reimport.click();
    await expect(
      page.getByText(/None of the 1 timestamped row\(s\) fall within/).first(),
    ).toBeVisible({ timeout: 30000 });
    expect(await countReadings(run.id)).toBe(0);
  });
});
