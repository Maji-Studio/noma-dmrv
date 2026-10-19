/**
 * The routed credit batch page (epic #1136): the list's sheet is a preview
 * that links to the page, tabs switch through `?tab=`, and an open item takes
 * the operator to its target.
 */
import * as crypto from "crypto";
import { test, expect } from "./fixtures/auth-fixtures";
import { creditBatchRow } from "./fixtures/page-helpers";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

/** A phone viewport, below the `sm` breakpoint where the progress folds into one row. */
const PHONE_WIDTH_PX = 375;
const PHONE_HEIGHT_PX = 812;

test.describe("credit batch page", () => {
  test("opens from the list preview, switches tabs and follows an open item", async ({
    adminPage: page,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `PAGE-${tag}`, seededData.feedstockType.id);

    await page.goto(`/credit-batches?facility=${seededData.facility.id}&view=list`);
    await expect(page.locator("aside").getByText(seededData.facility.name, { exact: false })).toBeVisible();
    await creditBatchRow(page, batch.code).getByRole("button", { name: `Open credit batch ${batch.code}` }).click();

    // The sheet is a preview whose lead action opens the page.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: batch.code })).toBeVisible();
    await expect(sheet.getByTestId("batch-health-strip")).toHaveCount(0);
    await sheet.getByRole("link", { name: "Open credit batch" }).click();

    await expect(page).toHaveURL((url) => url.pathname === `/credit-batches/${batch.id}` && url.searchParams.get("facility") === seededData.facility.id);
    await expect(page.getByRole("heading", { level: 1, name: batch.code })).toBeVisible();
    await expect(page.getByRole("list", { name: "Credit batch progress" })).toBeVisible();
    await expect(page.getByTestId("credit-batch-progress-trigger")).toBeHidden();

    // On a phone the four milestones fold into one row that opens them from the keyboard.
    const desktop = page.viewportSize();
    await page.setViewportSize({ width: PHONE_WIDTH_PX, height: PHONE_HEIGHT_PX });
    const progress = page.getByTestId("credit-batch-progress-trigger");
    await expect(progress).toContainText(/Step \d of 4/);
    await progress.focus();
    await page.keyboard.press("Enter");
    const steps = page.getByRole("dialog", { name: "Credit batch progress" }).getByRole("listitem");
    await expect(steps).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(steps).toHaveCount(0);
    if (desktop) await page.setViewportSize(desktop);

    const tabs = page.getByRole("tablist", { name: "Credit batch sections" });
    await expect(tabs.getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true");

    await tabs.getByRole("tab", { name: "Samples" }).click();
    await expect(page).toHaveURL(/[?&]tab=samples/);
    await expect(page.getByTestId("credit-batch-durability-panel")).toBeVisible();

    await tabs.getByRole("tab", { name: "Production" }).click();
    await expect(page).toHaveURL(/[?&]tab=production/);
    await expect(page.getByRole("heading", { name: "Production runs", exact: true })).toBeVisible();

    await tabs.getByRole("tab", { name: "Emissions" }).click();
    await expect(page.getByRole("link", { name: "Open emissions" })).toBeVisible();

    await tabs.getByRole("tab", { name: "Removals" }).click();
    await expect(page).toHaveURL(/[?&]tab=removals/);
    await expect(page.getByText("No applied biochar yet", { exact: true })).toBeVisible();

    await tabs.getByRole("tab", { name: "Activities" }).click();
    await expect(page).toHaveURL(/[?&]tab=activities/);

    // Overview stays out of the URL; its open items lead somewhere.
    await tabs.getByRole("tab", { name: /Overview/ }).click();
    await expect(page).not.toHaveURL(/[?&]tab=/);
    const openItems = page.getByRole("region", { name: "Open items" });
    // A seeded batch has no Samples: that open item lands on the Samples tab.
    await openItems.getByRole("button", { name: /No lab chemistry results/ }).click();
    await expect(page).toHaveURL(/[?&]tab=samples/);
    await expect(page.getByTestId("credit-batch-durability-panel")).toBeVisible();

    // Fix next item follows the first blocking item: the Removal template on the Overview.
    await page.getByRole("button", { name: "Fix next item" }).click();
    await expect(page).toHaveURL(/[?&]focus=removal-template/);
    await expect(page).not.toHaveURL(/[?&]tab=/);
    await expect(page.locator('[data-focus-target="removal-template"]')).toBeVisible();
  });

  test("answers a not-found for another facility", async ({ adminPage: page, seededData }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `PAGE-NF-${tag}`, seededData.feedstockType.id);
    await page.goto(`/credit-batches/${batch.id}?facility=${crypto.randomUUID()}`);
    await expect(page.getByText("Credit batch not found")).toBeVisible();
  });
});
