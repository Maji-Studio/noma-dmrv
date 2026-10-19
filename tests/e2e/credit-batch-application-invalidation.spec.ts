/**
 * Credit Batch / Application Cache Invalidation E2E Test (issue #396)
 *
 * `useUpdateApplication` (and create/delete) now invalidate `creditBatchKeys`
 * on success, so a credit batch's applied biochar (the List view shows the dry
 * mass of its slices) doesn't go stale once cached — the credit-batches
 * queries use `refetchOnWindowFocus: false`.
 *
 * The credit-batches list and the application editor live on separate
 * routes with no shared component (there is no single page in this app that
 * mounts both `useCreditBatches` and an application-mutation form at once),
 * so this spec proves the fix the way the app's architecture actually
 * allows: navigate between `/credit-batches` and `/applications` using the
 * in-app sidebar links (client-side navigation — no full page reload), so
 * the single React Query `QueryClient` created once in `src/app/providers.tsx`
 * stays alive the whole time. Editing the application invalidates
 * `creditBatchKeys`; revisiting `/credit-batches` afterwards must show the
 * refreshed figure rather than the 30s-stale cached one — without the fix,
 * it would still show the pre-edit value because nothing marked the cached
 * credit-batches query stale.
 */
import * as crypto from "crypto";
import { test, expect, type SeededChainData } from "./fixtures";
import { seedCreditBatchProductionLineage } from "./fixtures/seed-chain-data";
import {
  creditBatchRow,
  selectEntity,
  selectFirstEntity,
  waitForFacilityHydration,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import type { Page } from "@playwright/test";
import { fillStockMoisture } from "./helpers/stock-moisture";

/** 5000 kg applied from a delivery at 10% moisture, then edited to 3000 kg: dry is 90% of each. */
const APPLIED_DRY_BEFORE = "4.50 t";
const APPLIED_DRY_AFTER = "2.70 t";

async function createApplicationForLineage(
  page: Page,
  seededData: SeededChainData,
  today: string,
) {
  // Order (biochar product is the one wired to the seeded production run).
  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.click('button:has-text("New order")');
  await waitForSideSheet(page);

  await page.fill('input[name="orderDate"]', today);
  await selectEntity(page, "Customer", seededData.customer.id, seededData.customer.name);
  await selectEntity(page, "Customer location", seededData.customerLocation.id, seededData.customerLocation.name);
  await selectEntity(
    page,
    "Formulation", seededData.formulation.id, seededData.formulation.name,
  );
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', "10000");
  await page.locator('[role="dialog"]').locator('button:has-text("Create order")').click();
  await waitForSideSheetClose(page);

  // Delivery, already delivered (applications require a delivered delivery).
  await page.goto(`/deliveries?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.click('button:has-text("New delivery")');
  await waitForSideSheet(page);

  await selectFirstEntity(page, "Order");
  await selectEntity(page, "Actual source bin", seededData.productStorageLocation.id, seededData.productStorageLocation.name);
  await page.fill('input[name="deliveredWetMassKg"]', "10000");
  await fillStockMoisture(page, "delivery", "10");
  await page.locator('[role="dialog"]').locator('button:has-text("Create delivery")').click();
  await waitForSideSheetClose(page);

  // Application against that delivery: 5000 kg (5 tonnes) initially.
  await page.goto(`/applications?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.click('button:has-text("New application")');
  await waitForSideSheet(page);

  await page.fill('input[name="applicationDate"]', today);
  await selectFirstEntity(page, "Delivery");
  await page.fill('input[name="biocharAppliedKg"]', "5000");
  await page.fill('input[name="fieldSizeHa"]', "2");
  await page.locator('[role="dialog"]').locator('button:has-text("Create application")').click();
  await waitForSideSheetClose(page);
}

test.describe("Credit batch view reflects application mutations (#396)", () => {
  test("editing an application refreshes an already-visited credit-batches list without a reload", async ({
    adminPage: page,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const lineage = await seedCreditBatchProductionLineage(seededData, tag);
    const today = new Date().toISOString().split("T")[0];

    await createApplicationForLineage(page, seededData, today);

    // Baseline: visit /credit-batches and read the pre-edit applied (dry) figure.
    await page.goto(`/credit-batches?facility=${seededData.facility.id}&view=list`);
    await page.waitForLoadState("networkidle");

    const row = creditBatchRow(page, lineage.creditBatchCode);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator("[data-applied-dry]")).toHaveText(APPLIED_DRY_BEFORE, { timeout: 10000 });

    // Navigate to /applications via the sidebar (client-side nav — the
    // QueryClient created once in providers.tsx survives the route change).
    await page.locator("nav").getByRole("link", { name: "Applications" }).click();
    await page.waitForURL(/\/applications/);
    await page.waitForLoadState("networkidle");

    const applicationRow = page.locator("table tbody tr").filter({ has: page.locator("[data-row-link]") }).first();
    await applicationRow.click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit application" }).click();

    await page.fill('input[name="biocharAppliedKg"]', "3000");
    await page.locator('[role="dialog"]').locator('button:has-text("Update application")').click();
    await waitForSideSheetClose(page);

    // Back to /credit-batches, again via client-side nav — no page.reload(),
    // no page.goto(). This is the exact scenario the fix targets: a query
    // that was cached under refetchOnWindowFocus:false must have been
    // invalidated by the application mutation, or this would still read 4.50 t.
    await page.locator("nav").getByRole("link", { name: "Credit Batches" }).click();
    await page.waitForURL(/\/credit-batches(\?|$)/);
    await page.waitForLoadState("networkidle");
    // The sidebar link opens the timeline; the row figures live in the list view.
    await page.getByRole("button", { name: "List", exact: true }).click();

    // 5000 kg became 3000 kg of the same delivery: the dry figure follows.
    await expect(creditBatchRow(page, lineage.creditBatchCode).locator("[data-applied-dry]")).toHaveText(APPLIED_DRY_AFTER, {
      timeout: 10000,
    });
  });
});
