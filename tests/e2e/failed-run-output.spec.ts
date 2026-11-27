import { test, expect } from "./fixtures";
import {
  selectEntity,
  waitForFacilityHydration,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import { chooseRunStatus } from "./helpers/run-status";
import {
  FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR,
  openRunForm,
  submitCreate,
  editFirstRow,
  saveEdit,
} from "./helpers/production-run-form";

test.describe("Failed run output", () => {
  test("posts Failed output into a quick-added Uncarbonized bin", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2025-02-05",
      startTime: "08:00",
      status: "running",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await page
      .getByLabel("Filter production runs by status")
      .selectOption("running");
    await expect(page.locator('tbody [data-status="running"]').first()).toBeVisible();
    await editFirstRow(page);

    const binName = `E2E Failed output ${crypto.randomUUID()}`;
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[name="endDate"]').fill("2025-02-05");
    await dialog.locator('input[name="endTime"]').fill("12:00");
    // A Running run cannot keep an end time; the field says so until the status changes.
    await dialog.locator('input[name="endTime"]').blur();
    await expect(
      dialog.getByText("Choose Complete or clear the end time for a Running run."),
    ).toBeVisible();
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
    await dialog.locator(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR).fill("50");
    await dialog.locator('input[name="feedstockMoisturePercent"]').fill("15");
    await chooseRunStatus(dialog, "failed");
    await dialog.locator('input[name="biocharOutputKg"]').fill("10");
    await dialog.locator('input[name="biocharMoisturePercent"]').fill("20");

    // Quick-add inherits the Failed run's required Uncarbonized tag.
    const outputBinLabel = dialog.locator('label[for="biocharStorageLocationId"]');
    const outputBinField = outputBinLabel.locator(
      "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]",
    );
    await outputBinField.getByTestId("entity-select-trigger").click();
    await page.getByRole("button", { name: "Add new storage bin", exact: true }).click();
    const quickAdd = page.getByTestId("storage-location-quick-add-dialog");
    await expect(quickAdd).toBeVisible();
    await quickAdd.getByLabel("Bin name").fill(binName);
    await quickAdd.getByRole("button", { name: "Create storage bin", exact: true }).click();
    await expect(quickAdd).toBeHidden();
    await expect(outputBinField.getByTestId("entity-select-trigger")).toContainText(binName);
    await saveEdit(page);
    await waitForSideSheetClose(page);

    await page
      .getByLabel("Filter production runs by status")
      .selectOption("failed");
    const failedBadge = page.locator('tbody [data-status="failed"]').first();
    await expect(failedBadge).toBeVisible();
    await expect(failedBadge).toHaveText("Failed");
    await expect(failedBadge).toHaveAttribute("data-status-state", "error");
    await expect(failedBadge).toHaveClass(/--st-bad-bg/);

    await page.goto(`/storage-bins?facility=${seededData.facility.id}`);
    await waitForFacilityHydration(page, seededData.facility.name);
    await page.getByPlaceholder(/^Search by code or name/).fill(binName);
    await page.getByText(binName, { exact: true }).first().click();
    await waitForSideSheet(page);
    const binSheet = page.getByRole("dialog");
    await expect(binSheet.getByText("Uncarbonized", { exact: true })).toBeVisible();
    const stock = binSheet.getByRole("region", { name: "Stock", exact: true });
    await expect(stock).toContainText("10 kg wet mass");
    await expect(stock).toContainText("8 kg dry biochar");
  });
});
