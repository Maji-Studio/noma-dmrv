/**
 * Feedstock-type filter E2E (issue #25)
 *
 * Covers the contract that makes the Feedstocks KPI strip trustworthy:
 * - the toolbar filter narrows the rows to one feedstock type;
 * - the stat cards move with it, so the cards and the rows always describe the
 *   same deliveries;
 * - the moisture card is named "Weighted Avg. Moisture", and the figure really
 *   is weighted by wet mass rather than a mean of the readings.
 *
 * The second delivery is deliberately large and wet next to the seeded one, so
 * a plain mean (29.6%) and the wet-mass weighted average (39.7%) cannot be
 * confused for one another.
 */
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { createDbConnection } from "./fixtures/db";

const ALT_WET_KG = 1000;
const ALT_DRY_KG = 575;
const ALT_MOISTURE_PERCENT = 42.5;

/** Weighted across both deliveries: (16.7 × 120 + 42.5 × 1000) / 1120. */
const BOTH_TYPES_MOISTURE = "39.7%";
const ALT_TYPE_ONLY_MOISTURE = "42.5%";

/**
 * A StatCard renders its title and its value as adjacent spans, so the value is
 * the title's next sibling. No test id is needed and the card keeps its markup
 * freedom.
 */
function statCardValue(page: Page, title: string) {
  return page
    .getByText(title, { exact: true })
    .locator("xpath=following-sibling::span[1]");
}

test.describe("Feedstock type filter", () => {
  test("narrows the list and rescopes the stat cards", async ({
    adminPage: page,
    seededData,
  }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const altType = {
      id: crypto.randomUUID(),
      organizationId: DEC_ORG_ID,
      code: `E2E-FST-ALT-${suffix}`,
      name: `E2E Alt Feedstock Type ${suffix}`,
      category: "manure",
    };
    const altFeedstock = {
      id: crypto.randomUUID(),
      organizationId: DEC_ORG_ID,
      code: `E2E-FS-ALT-${suffix}`,
      facilityId: seededData.facility.id,
      supplierId: seededData.supplier.id,
      deliveryDate: new Date(),
      feedstockTypeId: altType.id,
      status: "complete" as const,
      massWetKg: ALT_WET_KG,
      massDryKg: ALT_DRY_KG,
      moistureContentPercent: ALT_MOISTURE_PERCENT,
    };
    const { db, pool } = createDbConnection();

    try {
      await db.insert(schema.feedstockTypes).values(altType);
      await db.insert(schema.feedstocks).values(altFeedstock);

      await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
      // Hydration gate: the sidebar facility name is client-resolved.
      await expect(
        page.locator("aside").getByText(seededData.facility.name, { exact: false }),
      ).toBeVisible({ timeout: 15000 });

      // Both deliveries are in scope before filtering.
      await expect(statCardValue(page, "Total Feedstocks")).toHaveText("2", {
        timeout: 15000,
      });
      await expect(
        statCardValue(page, "Weighted Avg. Moisture"),
      ).toHaveText(BOTH_TYPES_MOISTURE);
      await expect(
        page.getByText("Totals cover all feedstock types.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator("table tbody tr", { hasText: seededData.feedstock.code }),
      ).toHaveCount(1);
      await expect(
        page.locator("table tbody tr", { hasText: altFeedstock.code }),
      ).toHaveCount(1);

      // Filter to the alternative type.
      await page
        .getByLabel("Filter feedstocks by feedstock type")
        .selectOption(altType.id);

      // The rows narrow …
      await expect(
        page.locator("table tbody tr", { hasText: seededData.feedstock.code }),
      ).toHaveCount(0, { timeout: 15000 });
      await expect(
        page.locator("table tbody tr", { hasText: altFeedstock.code }),
      ).toHaveCount(1);

      // … and the cards follow, naming the scope they now summarise.
      await expect(statCardValue(page, "Total Feedstocks")).toHaveText("1");
      await expect(statCardValue(page, "Weighted Avg. Moisture")).toHaveText(
        ALT_TYPE_ONLY_MOISTURE,
      );
      await expect(
        page.getByText(`Totals cover ${altType.name} only.`, { exact: true }),
      ).toBeVisible();

      // Clearing the filter restores the full scope.
      await page
        .getByLabel("Filter feedstocks by feedstock type")
        .selectOption("");
      await expect(statCardValue(page, "Total Feedstocks")).toHaveText("2", {
        timeout: 15000,
      });
      await expect(
        statCardValue(page, "Weighted Avg. Moisture"),
      ).toHaveText(BOTH_TYPES_MOISTURE);
    } finally {
      try {
        await db
          .delete(schema.feedstocks)
          .where(eq(schema.feedstocks.id, altFeedstock.id));
        await db
          .delete(schema.feedstockTypes)
          .where(eq(schema.feedstockTypes.id, altType.id));
      } finally {
        await pool.end();
      }
    }
  });
});
