/**
 * Bin over-draw hard block (issue #116)
 *
 * A production run's feedstock draw is derived from the source bin's confirmed
 * on-hand stock (complete-batch mass − prior consumption + reconciliation
 * movements). Drawing MORE than the bin holds is blocked server-side, inside the
 * create transaction, with an error that states the available quantity and
 * points at the bin's reconcile workflow.
 *
 * The seeded feedstock bin holds one complete 100 kg-dry batch, so:
 *   - a draw computing > 100 kg dry is rejected (over-draw), and
 *   - a draw well under 100 kg dry still succeeds.
 *
 * Dry mass = wet × (1 − moisture%/100): wet 200 @ 10% ⇒ 180 kg dry (over 100),
 * wet 50 @ 10% ⇒ 45 kg dry (within 100).
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

const overdrawText = /not enough feedstock/i;

async function openRunFormWithSource(
  page: Page,
  seededData: SeededChainData,
  draw: { wetMassKg: string; moisturePercent: string },
) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await expect(
    page.getByRole("button", { name: "New Production Run" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Production Run" }).click();
  await waitForSideSheet(page);

  await page.selectOption('select[name="status"]', "draft");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  const today = new Date().toISOString().split("T")[0];
  await page.fill('input[name="startDate"]', today);
  await selectEntity(
    page,
    "Source Bin",
    seededData.feedstockStorageLocation.id,
    seededData.feedstockStorageLocation.name,
  );
  await page.fill('input[name="feedstockWetMassKg"]', draw.wetMassKg);
  await page.fill('input[name="feedstockMoisturePercent"]', draw.moisturePercent);
}

async function submitCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create Production Run")')
    .click();
}

test.describe("Bin over-draw hard block (#116)", () => {
  test("rejects a feedstock draw exceeding the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // 180 kg dry drawn from a 100 kg-dry bin → over-draw.
    await openRunFormWithSource(page, seededData, {
      wetMassKg: "200",
      moisturePercent: "10",
    });
    await submitCreate(page);

    const dialog = page.locator('[role="dialog"]');
    // The block surfaces the shortfall with the available quantity + reconcile
    // pointer, and the side sheet stays open (the run was not created).
    await expect(dialog.getByText(overdrawText)).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/available/i)).toBeVisible();
  });

  test("accepts a feedstock draw within the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // 45 kg dry drawn from a 100 kg-dry bin → within stock.
    await openRunFormWithSource(page, seededData, {
      wetMassKg: "50",
      moisturePercent: "10",
    });
    await submitCreate(page);

    // A clean save closes the side sheet and the run lands in the list.
    await waitForSideSheetClose(page);
    await expect(
      page.locator("table tbody tr, [role='row']").first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
