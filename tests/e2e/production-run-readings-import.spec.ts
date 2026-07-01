import * as crypto from "crypto";
import { test, expect, type SeededChainData } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";
import { parseReadingsCsv } from "../../src/lib/production-readings/readings-csv";

const RUN_DATE = "2026-04-02";
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

async function seedProductionRun(seededData: SeededChainData) {
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID();
  const code = `E2E-PR-CSV-${crypto.randomUUID().slice(0, 8)}`;

  try {
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
});
