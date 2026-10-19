/**
 * Formulation lifecycle E2E (Phase 7a): archive, archived view, restore, the
 * in-use delete refusal with "Archive instead", the read-only archived sheet,
 * and the line-removal refusal banner in the edit form.
 *
 * Rows are seeded through DB helpers; every assertion runs against the live UI.
 */
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect } from "./fixtures";
import {
  generateTestId,
  createTestFacility,
  createTestFormulation,
  createTestBiocharProduct,
  deleteTestBiocharProduct,
  deleteTestFacility,
  deleteTestFormulation,
  type TestFacility,
  type TestFormulation,
} from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { clickRowMenuItem, waitForSideSheet } from "./fixtures/page-helpers";

const LINE_RATIO = 0.4;
const SNAPSHOT_WET_KG = 10;

test.describe("Formulation archive and restore", () => {
  let facility: TestFacility;
  let free: TestFormulation;
  let used: TestFormulation;
  let blendTypeId: string;
  let productId: string;

  test.beforeAll(async () => {
    const id = generateTestId("fl");
    const tag = id.toUpperCase();
    facility = await createTestFacility({ code: `E2E-FL-FAC-${tag}`, name: `E2E FL Facility ${id}` });
    free = await createTestFormulation({ code: `E2E-FL-FREE-${tag}`, name: `E2E FL Free ${id}`, biocharRatio: 1 });
    used = await createTestFormulation({ code: `E2E-FL-USED-${tag}`, name: `E2E FL Used ${id}`, biocharRatio: 1 - LINE_RATIO });

    const { db, pool } = createDbConnection();
    try {
      const [blend] = await db.insert(schema.feedstockTypes).values({
        organizationId: DEC_ORG_ID, code: `E2E-FL-BLEND-${tag}`, name: `E2E FL compost ${id}`, category: "compost", usage: "blend",
      }).returning();
      blendTypeId = blend!.id;
      const [line] = await db.insert(schema.formulationIngredients).values({
        organizationId: DEC_ORG_ID, formulationId: used.id, feedstockTypeId: blendTypeId, ratio: LINE_RATIO,
      }).returning();
      const product = await createTestBiocharProduct(facility.id, used.id);
      productId = product.id;
      await db.insert(schema.productIngredientSnapshots).values({
        organizationId: DEC_ORG_ID, biocharProductId: productId, formulationIngredientId: line!.id,
        wetMassKg: String(SNAPSHOT_WET_KG), moisturePercentUsed: 0, drySolidsKg: String(SNAPSHOT_WET_KG),
      });
    } finally {
      await pool.end();
    }
  });

  test.afterAll(async () => {
    const { db, pool } = createDbConnection();
    try {
      if (productId) {
        await db.delete(schema.productIngredientSnapshots).where(eq(schema.productIngredientSnapshots.biocharProductId, productId)).catch(() => {});
        await deleteTestBiocharProduct(productId).catch(() => {});
      }
      if (used) await deleteTestFormulation(used.id).catch(() => {});
      if (free) await deleteTestFormulation(free.id).catch(() => {});
      if (blendTypeId) await db.delete(schema.feedstockTypes).where(eq(schema.feedstockTypes.id, blendTypeId)).catch(() => {});
      if (facility) await deleteTestFacility(facility.id).catch(() => {});
    } finally {
      await pool.end();
    }
  });

  async function openList(page: Page, code: string) {
    await page.goto("/formulations");
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Search formulations" }).fill(code);
    await expect(page.locator("table tbody tr", { hasText: code })).toBeVisible({ timeout: 15000 });
  }

  async function rowAction(page: Page, code: string, item: string) {
    await clickRowMenuItem(page, page.getByRole("button", { name: `Actions for ${code}` }), item);
  }

  test("archive hides the row, the archived view lists it, restore brings it back", async ({ adminPage: page }) => {
    await openList(page, free.code);
    await expect(page.getByText("Active formulations", { exact: true })).toBeVisible();

    await rowAction(page, free.code, "Archive");
    await expect(page.getByText(`Formulation ${free.code} archived. Restore it from the archived view.`)).toBeVisible();
    await expect(page.locator("table tbody tr", { hasText: free.code })).toHaveCount(0);

    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(page.getByText("Archived formulations", { exact: true })).toBeVisible();
    await expect(page.locator("table tbody tr", { hasText: free.code })).toBeVisible();

    await rowAction(page, free.code, "Restore");
    await expect(page.getByText(`Formulation ${free.code} restored.`)).toBeVisible();
    await expect(page.locator("table tbody tr", { hasText: free.code })).toHaveCount(0);

    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(page.locator("table tbody tr", { hasText: free.code })).toBeVisible();
  });

  test("an empty archived view shows an empty state", async ({ adminPage: page }) => {
    await page.goto("/formulations");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page.getByRole("textbox", { name: "Search formulations" }).fill("no-such-formulation-code");
    await expect(page.getByText("No archived formulations match")).toBeVisible({ timeout: 15000 });
  });

  test("deleting a used formulation offers Archive instead; the archived sheet is read-only with Restore", async ({ adminPage: page }) => {
    await openList(page, used.code);
    await rowAction(page, used.code, "Delete");
    await page.getByRole("dialog").getByRole("button", { name: /^Delete/ }).last().click();

    await expect(page.getByRole("dialog").getByText(`${used.code} is in use`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Archive it instead. Existing records keep it, while pickers hide it.")).toBeVisible();

    await page.getByRole("dialog").getByRole("button", { name: "Archive instead" }).click();
    await expect(page.getByText(`Formulation ${used.code} archived. Restore it from the archived view.`)).toBeVisible();
    await expect(page.getByRole("dialog").getByText(`${used.code} is in use`)).toHaveCount(0);

    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page.locator("table tbody tr", { hasText: used.code }).click();
    await waitForSideSheet(page);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Edit formulation" })).toHaveCount(0);
    // The notice leads the sheet: it sits above the first detail section.
    const noticeBox = await sheet.getByText("This formulation is archived.").boundingBox();
    const firstSectionBox = await sheet.getByText("Formulation name", { exact: true }).boundingBox();
    expect(noticeBox && firstSectionBox && noticeBox.y < firstSectionBox.y).toBe(true);

    await sheet.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByText(`Formulation ${used.code} restored.`)).toBeVisible();
  });

  test("removing a line saved products use shows the server's refusal in the form", async ({ adminPage: page }) => {
    await openList(page, used.code);
    await rowAction(page, used.code, "Edit");
    await waitForSideSheet(page);
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Remove ingredient 1" }).click();
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(
      sheet.getByText("This line is used by saved biochar products, so it cannot be removed. Keep the line or create a new formulation."),
    ).toBeVisible({ timeout: 15000 });
  });
});
