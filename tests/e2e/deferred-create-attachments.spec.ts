/**
 * Deferred create attachments (docs/plans/2026-07-16-deferred-create-attachments.md)
 *
 * Create forms hold real files client-side and flush them against the fresh
 * entity ID after create — one Save, no "save first, then reopen to attach".
 * Covers the plan's verification list:
 *  (a) create-with-attachment happy path for feedstock and sample (+ leg),
 *  (b) view mode shows documents read-only (no delete, no dropzone),
 *  (c) partial-failure path — storage PUT aborted → sheet stays open in edit
 *      mode with a retry affordance that succeeds once the network recovers.
 */
import { test, expect } from "./fixtures/auth-fixtures";
import {
  selectEntity,
  selectFirstEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import type { Page } from "@playwright/test";

const FUTURE_DATE = "2026-08-01";

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% e2e deferred attachment probe\n"),
});

async function fillMinimalFeedstock(
  page: Page,
  seededData: {
    supplier: { id: string; name: string };
    feedstockType: { id: string; name: string };
    feedstockStorageLocation: { id: string; name: string };
  },
) {
  await page.fill('input[name="deliveryDate"]', FUTURE_DATE);
  await selectEntity(page, "Supplier", seededData.supplier.id, seededData.supplier.name);
  await selectEntity(
    page,
    "Feedstock Type",
    seededData.feedstockType.id,
    seededData.feedstockType.name,
  );
  await page.fill('input[name="transportDistanceKm"]', "40");
  await page.fill('input[name="totalWetMassKg"]', "100");
  await page.fill('input[name="moisturePercent"]', "25");
  await selectEntity(
    page,
    "Storage Bin",
    seededData.feedstockStorageLocation.id,
    seededData.feedstockStorageLocation.name,
  );
}

test.describe("Deferred create attachments", () => {
  test("feedstock create attaches a bill of lading in the same Save", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    await fillMinimalFeedstock(page, seededData);

    // Deferred dropzone holds the file locally — nothing uploads yet.
    await dialog
      .locator("#feedstock-deferred-bill-of-lading")
      .setInputFiles(pdf("bol-deferred.pdf"));
    await expect(dialog.getByText("bol-deferred.pdf")).toBeVisible();

    // One Save: create + flush, then the sheet closes like any other create.
    await dialog.locator('button:has-text("Create Feedstock")').click();
    await waitForSideSheetClose(page);

    // Reopen the newest feedstock: view mode lists the document read-only.
    await page.waitForLoadState("networkidle");
    await page.locator("table tbody tr").first().click();
    await waitForSideSheet(page);
    await expect(dialog.getByText("bol-deferred.pdf")).toBeVisible({
      timeout: 15000,
    });
    // (b) read-only: open link yes, delete button and dropzone no.
    await expect(
      dialog.getByLabel("Open bol-deferred.pdf"),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Delete bol-deferred.pdf"),
    ).toHaveCount(0);
    await expect(dialog.getByText("Drop files here or click to upload")).toHaveCount(0);
  });

  test("sample create attaches a lab report and a transport leg in the same Save", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    await seedCreditBatch(seededData.facility.id, tag, seededData.feedstockType.id);

    await page.goto(`/samples?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Sample")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    await selectFirstEntity(page, "Credit Batch");
    await page.fill('input[name="totalCarbonPercent"]', "75");
    await page.fill('input[name="organicCarbonPercent"]', "70");

    // Deferred lab report.
    await dialog
      .locator("#sample-deferred-documents-upload")
      .setInputFiles(pdf("lab-report-deferred.pdf"));
    await expect(dialog.getByText("lab-report-deferred.pdf")).toBeVisible();

    // Deferred transport leg via the inline editor (no sample exists yet).
    await dialog.locator('button:has-text("Add leg")').click();
    await dialog.locator("#distanceKm").fill("12");
    await dialog.locator('input[name="loadMassKg"]').fill("5");
    await dialog.locator('button:has-text("Add transport leg")').click();
    await expect(dialog.getByText("12 km")).toBeVisible();

    await dialog.locator('button:has-text("Create Sample")').click();
    await waitForSideSheetClose(page);

    // Reopen: view mode shows both the document and the leg, read-only.
    await page.waitForLoadState("networkidle");
    await page.locator("table tbody tr").first().click();
    await waitForSideSheet(page);
    await expect(dialog.getByText("lab-report-deferred.pdf")).toBeVisible({
      timeout: 15000,
    });
    await expect(dialog.getByText("12 km")).toBeVisible();
    await expect(
      dialog.getByLabel("Delete lab-report-deferred.pdf"),
    ).toHaveCount(0);
  });

  test("partial flush failure keeps the sheet open in edit mode with working retry", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Feedstock")');
    await waitForSideSheet(page);
    const dialog = page.locator('[role="dialog"]');

    await fillMinimalFeedstock(page, seededData);
    await dialog
      .locator("#feedstock-deferred-weighbridge-ticket")
      .setInputFiles(pdf("ticket-deferred.pdf"));
    await expect(dialog.getByText("ticket-deferred.pdf")).toBeVisible();

    // Abort every storage PUT so the post-create flush fails while the
    // entity create (a POST) succeeds.
    await page.route("**/*", (route) =>
      route.request().method() === "PUT" ? route.abort() : route.continue(),
    );

    await dialog.locator('button:has-text("Create Feedstock")').click();

    // Entity created, flush failed → sheet stays open in edit mode with the
    // failed item and an explanatory error.
    await expect(
      dialog.getByText(/created, but .* failed to upload/i),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      dialog.getByText(/attachment(s)? failed to upload/i).first(),
    ).toBeVisible();
    await expect(dialog.getByText("ticket-deferred.pdf")).toBeVisible();

    // Network recovers → retry succeeds and the failed list disappears.
    await page.unroute("**/*");
    await dialog.locator('button:has-text("Retry uploads")').click();
    await expect(
      dialog.getByRole("button", { name: "Retry uploads" }),
    ).toHaveCount(0, { timeout: 20000 });

    // The document is now live on the entity in the edit panel.
    await expect(dialog.getByText("ticket-deferred.pdf")).toBeVisible();
  });
});
