/**
 * Energy page (ADR 0031): recorded activity per run, a ranked list that
 * expands a row, and a record code that opens its own side sheet. No CO2e is
 * shown and Certification settings has no emission factors section.
 *
 * The run is inserted straight into the seeded facility with its energy
 * readings.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { productionRuns } from "@/db/schema";
import { test, expect } from "./fixtures";
import { createDbConnection } from "./fixtures/db";

const RUN_HOURS_AGO = 30;
const RUN_LENGTH_HOURS = 6;
const MS_PER_HOUR = 60 * 60 * 1000;

test.describe("Energy page", () => {
  test("lists a run, expands its activity and links to the run", async ({
    adminPage: page,
    seededData,
  }) => {
    const code = `E2E-ENERGY-${randomUUID().slice(0, 8).toUpperCase()}`;
    const facilityId = seededData.facility.id;
    const start = new Date(Date.now() - RUN_HOURS_AGO * MS_PER_HOUR);
    const { db, pool } = createDbConnection();
    try {
      await db.insert(productionRuns).values({
        organizationId: DEC_ORG_ID,
        facilityId,
        reactorId: seededData.reactor.id,
        code,
        status: "complete",
        startTime: start,
        endTime: new Date(start.getTime() + RUN_LENGTH_HOURS * MS_PER_HOUR),
        dieselOperationLiters: 8,
        dieselGensetLiters: 4,
        preprocessingFuelLiters: 2,
        electricityKwh: 24,
        biocharStorageLocationId: seededData.biocharStorageLocation.id,
        biocharOutputKg: 300,
        biocharMoisturePercent: 10,
        biocharDryMassKg: 270,
      });

      await page.goto(`/energy?facility=${facilityId}`);
      await page.getByRole("tab", { name: "Production runs" }).click();
      const runLink = page.getByRole("link", { name: code });
      await expect(runLink).toBeVisible();
      await page.getByRole("button", { name: `Show the breakdown of ${code}` }).click();
      const records = page.getByRole("region", { name: "Records" });
      await expect(records.getByText("Startup diesel")).toBeVisible();
      await expect(records.getByText("8 L", { exact: true })).toBeVisible();
      await expect(records.getByText("24 kWh", { exact: true })).toBeVisible();
      await expect(page.getByText(/CO₂e/)).toHaveCount(0);
      await expect(page.getByText(/emission factors/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Flow" })).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: "Activity totals" })).toContainText("Whole facility");

      await page.getByRole("link", { name: code }).click();
      await expect(page).toHaveURL(/\/production-runs\?.*run=/);
      await expect(page.getByRole("dialog")).toContainText(code);
    } finally {
      await db.delete(productionRuns).where(eq(productionRuns.code, code));
      await pool.end();
    }
  });

  test("Certification settings lists Emissions but no emission factors", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/certification/settings?facility=${seededData.facility.id}`);
    await expect(page.getByText("Removal templates").first()).toBeVisible();
    await expect(page.getByText("Emissions", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Emission factors")).toHaveCount(0);
  });
});
