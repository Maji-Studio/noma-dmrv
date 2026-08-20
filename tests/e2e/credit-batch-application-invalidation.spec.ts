/**
 * Credit Batch / Application Cache Invalidation E2E Test (issue #396)
 *
 * `useUpdateApplication` (and create/delete) now invalidate `creditBatchKeys`
 * on success, so a credit batch's derived `appliedWeightTons` (Σ member
 * applications' biocharAppliedTons) doesn't go stale once cached — the
 * credit-batches query uses `refetchOnWindowFocus: false`.
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
  selectEntity,
  selectFirstEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import type { Page } from "@playwright/test";

// Wait for hydration — the sidebar shows the facility name once the
// FacilityProvider resolves. Filling a form before then loses the values
// (docs/testing.md).
async function waitForFacilityHydration(
  page: Page,
  seededData: SeededChainData,
) {
  await expect(
    page.locator("aside").getByText(seededData.facility.name, { exact: false }),
  ).toBeVisible({ timeout: 15000 });
}

async function createApplicationForLineage(
  page: Page,
  seededData: SeededChainData,
  today: string,
) {
  // Order (biochar product is the one wired to the seeded production run).
  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await waitForFacilityHydration(page, seededData);
  await page.click('button:has-text("New Order")');
  await waitForSideSheet(page);

  await page.fill('input[name="orderDate"]', today);
  await page.selectOption('select[name="customerId"]', seededData.customer.id);
  await page.waitForSelector(
    'select[name="customerLocationId"]:not([disabled])',
    { timeout: 8000 },
  );
  await page.selectOption(
    'select[name="customerLocationId"]',
    seededData.customerLocation.id,
  );
  await selectEntity(
    page,
    "Product bin",
    seededData.biocharProduct.id,
    seededData.biocharProduct.code,
  );
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', "10000");
  await page.locator('[role="dialog"]').locator('button:has-text("Create Order")').click();
  await waitForSideSheetClose(page);

  // Delivery, already delivered (applications require a delivered delivery).
  await page.goto(`/deliveries?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await waitForFacilityHydration(page, seededData);
  await page.click('button:has-text("New Delivery")');
  await waitForSideSheet(page);

  await page.fill('input[name="deliveryDate"]', today);
  await page.selectOption('select[name="status"]', "delivered");
  await selectFirstEntity(page, "Order");
  await page.fill('input[name="deliveredWetMassKg"]', "10000");
  await page.fill('input[name="moistureContentPercent"]', "10");
  await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
  await waitForSideSheetClose(page);

  // Application against that delivery — 5000 tons applied initially.
  await page.goto(`/applications?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await waitForFacilityHydration(page, seededData);
  await page.click('button:has-text("New Application")');
  await waitForSideSheet(page);

  await page.fill('input[name="applicationDate"]', today);
  const deliverySelect = page.locator('select[name="deliveryId"]');
  const firstDeliveryValue = await deliverySelect
    .locator("option:not([value=''])")
    .first()
    .getAttribute("value");
  if (firstDeliveryValue) {
    await deliverySelect.selectOption(firstDeliveryValue);
  }
  await page.fill('input[name="biocharAppliedTons"]', "5000");
  await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
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

    // Baseline: visit /credit-batches and read the pre-edit Weight figure.
    await page.goto(`/credit-batches?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    const card = page.locator("article").filter({ hasText: lineage.creditBatchCode });
    await expect(card).toBeVisible({ timeout: 10000 });
    const appliedBiocharMetric = card
      .getByText("Applied biochar", { exact: true })
      .locator("xpath=..");
    // The applications form's "biocharAppliedTons" input is entered in kg
    // (applicationTonsToKg converts for display) but the schema field — and
    // this rollup — is in tonnes, so 5000 kg in reads back as "5.00 t".
    await expect(
      appliedBiocharMetric.getByText("5.00 t", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to /applications via the sidebar (client-side nav — the
    // QueryClient created once in providers.tsx survives the route change).
    await page.locator("nav").getByRole("link", { name: "Applications" }).click();
    await page.waitForURL(/\/applications/);
    await page.waitForLoadState("networkidle");

    const applicationRow = page.locator("table tbody tr[tabindex='0']").first();
    await applicationRow.click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit Application" }).click();

    await page.fill('input[name="biocharAppliedTons"]', "3000");
    await page.locator('[role="dialog"]').locator('button:has-text("Update Application")').click();
    await waitForSideSheetClose(page);

    // Back to /credit-batches, again via client-side nav — no page.reload(),
    // no page.goto(). This is the exact scenario the fix targets: a query
    // that was cached under refetchOnWindowFocus:false must have been
    // invalidated by the application mutation, or this would still read 5.00.
    await page.locator("nav").getByRole("link", { name: "Credit Batches" }).click();
    await page.waitForURL(/\/credit-batches(\?|$)/);
    await page.waitForLoadState("networkidle");

    const cardAfter = page.locator("article").filter({ hasText: lineage.creditBatchCode });
    const appliedBiocharMetricAfter = cardAfter
      .getByText("Applied biochar", { exact: true })
      .locator("xpath=..");
    await expect(
      appliedBiocharMetricAfter.getByText("3.00 t", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
  });
});
