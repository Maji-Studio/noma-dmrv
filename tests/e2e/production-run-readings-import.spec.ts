import * as crypto from "crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fromZonedTime } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { test, expect, type SeededChainData } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";
import {
  inspectReactorDayCsv,
  parseFilenameMetadata,
  parseReactorDayCsv,
  type ReactorDayCsvMapping,
} from "../../src/lib/production-readings/reactor-day-csv";

const FACILITY_TIMEZONE = "Africa/Nairobi";
const RUN_DATE = "2026-04-02";
const RUN_WINDOW_MINUTES = 2;
const EXTERNAL_CSV_PATH = process.env.PRODUCTION_RUN_READINGS_CSV_PATH;
const EXTERNAL_RUN_REACTOR_CODE =
  process.env.PRODUCTION_RUN_READINGS_RUN_REACTOR_CODE ??
  `R-26-002-E2E-${crypto.randomUUID().slice(0, 8)}`;

interface CsvImportFixture {
  fileName: string;
  csvText: string;
  runDate: string;
  reactorCode: string;
  runReactorCode: string;
  mapping: ReactorDayCsvMapping;
  upload:
    | { type: "path"; path: string }
    | { type: "buffer"; name: string; buffer: Buffer };
}

function runWindowForDate(runDate: string) {
  const start = fromZonedTime(`${runDate}T00:00:00`, FACILITY_TIMEZONE);
  return {
    start,
    end: new Date(start.getTime() + RUN_WINDOW_MINUTES * 60 * 1000),
  };
}

async function seedProductionRun(
  seededData: SeededChainData,
  opts: {
    runDate: string;
    runWindowStart: Date;
    runWindowEnd: Date;
    reactorCode?: string;
  },
) {
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID();
  const code = `E2E-PR-CSV-${crypto.randomUUID().slice(0, 8)}`;

  try {
    await db
      .update(schema.facilities)
      .set({ timezone: FACILITY_TIMEZONE })
      .where(eq(schema.facilities.id, seededData.facility.id));

    if (opts.reactorCode) {
      await db
        .update(schema.reactors)
        .set({ code: opts.reactorCode })
        .where(eq(schema.reactors.id, seededData.reactor.id));
    }

    await db.insert(schema.productionRuns).values({
      id: runId,
      code,
      facilityId: seededData.facility.id,
      date: opts.runDate,
      status: "complete",
      startTime: opts.runWindowStart,
      endTime: opts.runWindowEnd,
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

function buildDefaultCsvFixture(reactorCode: string, runId: string): CsvImportFixture {
  const headerSuffix = runId.slice(0, 8);
  const temperatureColumn = `Carbonization Outlet Temperature ${headerSuffix}`;
  const pressureColumn = `Drying Drum Pressure ${headerSuffix}`;
  const gasFlowColumn = `Main Gas Flow ${headerSuffix}`;
  const csvText = [
    `Time,${temperatureColumn},${pressureColumn},${gasFlowColumn}`,
    "00:00:00,500,0.12,7.5",
    "00:01:00,---,0.13,",
    "00:02:00,510,0.14,8.1",
    ",,,",
  ].join("\n");
  const fileName = `${reactorCode} ${RUN_DATE} Data Evaluation.csv`;
  const inspection = inspectReactorDayCsv({
    fileName,
    csvText,
    runReactorCode: reactorCode,
  });

  return {
    fileName,
    csvText,
    runDate: RUN_DATE,
    reactorCode,
    runReactorCode: reactorCode,
    mapping: inspection.suggestedMapping,
    upload: {
      type: "buffer",
      name: fileName,
      buffer: Buffer.from(csvText),
    },
  };
}

function readExternalCsvFixture(path: string): CsvImportFixture {
  const fileName = basename(path);
  const csvText = readFileSync(path, "utf8");
  const metadata = parseFilenameMetadata(fileName);
  const inspection = inspectReactorDayCsv({
    fileName,
    csvText,
    runReactorCode: EXTERNAL_RUN_REACTOR_CODE,
  });

  return {
    fileName,
    csvText,
    runDate: metadata.fileDate,
    reactorCode: metadata.fileReactorCode,
    runReactorCode: EXTERNAL_RUN_REACTOR_CODE,
    mapping: inspection.suggestedMapping,
    upload: { type: "path", path },
  };
}

test.describe("production run readings CSV import", () => {
  test("imports a reactor-day CSV through channel alignment", async ({
    adminPage: page,
    seededData,
  }) => {
    const preseedFixture = EXTERNAL_CSV_PATH
      ? readExternalCsvFixture(EXTERNAL_CSV_PATH)
      : null;
    const seedWindow = runWindowForDate(preseedFixture?.runDate ?? RUN_DATE);
    const run = await seedProductionRun(seededData, {
      runDate: preseedFixture?.runDate ?? RUN_DATE,
      runWindowStart: seedWindow.start,
      runWindowEnd: seedWindow.end,
      reactorCode: preseedFixture?.runReactorCode,
    });
    const fixture =
      preseedFixture ?? buildDefaultCsvFixture(seededData.reactor.code, run.id);
    const parsed = parseReactorDayCsv({
      fileName: fixture.fileName,
      csvText: fixture.csvText,
      timezone: FACILITY_TIMEZONE,
      runWindowStart: seedWindow.start,
      runWindowEnd: seedWindow.end,
      mapping: fixture.mapping,
    });
    const firstReading = parsed.readings[0];

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
    const statusLabelRow = dialog
      .locator('label[for="status"]')
      .locator("xpath=..");
    await expect(statusLabelRow.getByText(/^CERT/)).toBeVisible();

    await dialog.getByText("Readings CSV Import").first().scrollIntoViewIfNeeded();
    await expect(
      dialog.locator(`#production-run-${run.id}-readings-upload`),
    ).toBeAttached();

    await dialog
      .locator(`#production-run-${run.id}-readings-upload`)
      .setInputFiles(
        fixture.upload.type === "path"
          ? fixture.upload.path
          : {
              name: fixture.upload.name,
              mimeType: "text/csv",
              buffer: fixture.upload.buffer,
            },
      );

    await expect(
      dialog.getByText(/Confirm channel alignment/),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      dialog.getByText(
        `File reactor ${fixture.reactorCode} · Selected run reactor ${fixture.runReactorCode}`,
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(`Reactor-day ${fixture.runDate} · Run date ${fixture.runDate}`),
    ).toBeVisible();
    if (fixture.reactorCode !== fixture.runReactorCode) {
      await expect(
        dialog.getByText(
          `Filename reactor ${fixture.reactorCode} does not match selected run reactor ${fixture.runReactorCode}.`,
        ),
      ).toBeVisible();
    }
    await expect(page.locator("#temperatureColumn")).toHaveValue(
      fixture.mapping.temperature,
    );
    await expect(page.locator("#pressureColumn")).toHaveValue(
      fixture.mapping.pressure,
    );
    await expect(page.locator("#gasFlowColumn")).toHaveValue(
      fixture.mapping.gasFlow ?? "",
    );

    await page.getByRole("button", { name: "Import Readings" }).click();

    await expect(
      page.getByText(new RegExp(`Imported ${parsed.inWindowRows} readings`)),
    ).toBeVisible();
    expect(firstReading).toBeDefined();
    await expect(
      page.getByRole("cell", {
        name: firstReading!.temperatureC?.toFixed(1) ?? "—",
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", {
        name: firstReading!.pressureBar?.toFixed(2) ?? "—",
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", {
        name: firstReading!.gasFlowRate?.toFixed(3) ?? "—",
        exact: true,
      }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(runRow.getByLabel("Ready for certification")).toBeVisible();
  });
});
