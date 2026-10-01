/**
 * Energy page (ADR 0031): emission factors saved in Certification settings
 * turn recorded activity into estimates, the list ranks records and expands
 * a row, Flow draws the Sankey, and a record code opens its own side sheet.
 *
 * The run is inserted straight into the seeded facility with its energy
 * readings; the factors go through the settings form.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { facilityEmissionFactors, productionRuns } from "@/db/schema";
import { test, expect } from "./fixtures";
import { createDbConnection } from "./fixtures/db";

const RUN_HOURS_AGO = 30;
const RUN_LENGTH_HOURS = 6;
const MS_PER_HOUR = 60 * 60 * 1000;

test.describe("Energy page", () => {
  test("estimates a run, expands it, draws the flow and links to the run", async ({
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
        biocharOutputKg: 300,
        biocharMoisturePercent: 10,
        biocharDryMassKg: 270,
      });

      await page.goto(`/energy?facility=${facilityId}`);
      await expect(page.getByText("No emission factors set for this facility.")).toBeVisible();
      await page.getByRole("link", { name: "Set emission factors" }).click();

      // Hydration gate (docs/testing.md): only the client renders the facility name.
      await expect(
        page.locator("aside").getByText(seededData.facility.name, { exact: false }),
      ).toBeVisible();
      const grid = page.getByRole("spinbutton", { name: /Grid electricity/ });
      await expect(grid).toBeVisible();
      await grid.fill("0.5");
      await page.getByRole("button", { name: "Save factors" }).click();
      await expect(page.getByText("Emission factors saved.")).toBeVisible();

      await page.goto(`/energy?facility=${facilityId}`);
      await page.getByRole("tab", { name: "Production runs" }).click();
      const runLink = page.getByRole("link", { name: code });
      await expect(runLink).toBeVisible();
      await page.getByRole("button", { name: `Show the breakdown of ${code}` }).click();
      await expect(page.getByText("Startup diesel")).toBeVisible();
      await expect(page.getByText(/^est\. \d+ kg CO₂e$/).first()).toBeVisible();

      await page.getByRole("button", { name: "Flow" }).click();
      await expect(
        page.getByRole("img", { name: /Estimated CO₂e flowing from energy sources/ }),
      ).toBeVisible();

      await page.getByRole("button", { name: "List" }).click();
      await page.getByRole("link", { name: code }).click();
      await expect(page).toHaveURL(/\/production-runs\?.*run=/);
      await expect(page.getByRole("dialog")).toContainText(code);
    } finally {
      await db.delete(facilityEmissionFactors).where(eq(facilityEmissionFactors.facilityId, facilityId));
      await db.delete(productionRuns).where(eq(productionRuns.code, code));
      await pool.end();
    }
  });
});
