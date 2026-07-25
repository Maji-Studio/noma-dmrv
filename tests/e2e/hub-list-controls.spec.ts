import * as crypto from "crypto";
import { test, expect, createTestFacility, deleteTestFacility } from "./fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

const PAGED_ITEM_COUNT = 11;
const DEFAULT_PAGE_SIZE = 10;
const EXPANDED_PAGE_SIZE = 20;

test.describe("Hub list controls", () => {
  test("facilities use shared paging and a neutral card action menu", async ({
    adminPage,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const facilities = await Promise.all(
      Array.from({ length: PAGED_ITEM_COUNT }, (_, index) =>
        createTestFacility({
          code: `E2E-HUB-FAC-${tag}-${String(index).padStart(2, "0")}`,
          name: `Hub Pager ${tag} ${String(index).padStart(2, "0")}`,
        }),
      ),
    );

    try {
      await adminPage.goto("/facilities");
      await adminPage.getByLabel("Search facilities").fill(`Hub Pager ${tag}`);
      await expect(
        adminPage.getByRole("heading", { name: facilities[0].name }),
      ).toBeVisible({ timeout: 15000 });

      const pageSize = adminPage.getByLabel("Rows per page");
      await expect(pageSize).toHaveValue(String(DEFAULT_PAGE_SIZE));
      await expect(adminPage.getByText("Page 1 of 2", { exact: true })).toBeVisible();
      await expect(adminPage.getByRole("button", { name: "Go to first page" })).toBeDisabled();
      await expect(adminPage.getByRole("button", { name: "Go to previous page" })).toBeDisabled();

      await adminPage.getByRole("button", { name: "Go to last page" }).click();
      await expect(adminPage.getByText("Page 2 of 2", { exact: true })).toBeVisible();
      await expect(adminPage.getByRole("button", { name: "Go to next page" })).toBeDisabled();
      await adminPage.getByRole("button", { name: "Go to first page" }).click();
      await adminPage.getByRole("button", { name: "Go to next page" }).click();
      await adminPage.getByRole("button", { name: "Go to previous page" }).click();
      await expect(adminPage.getByText("Page 1 of 2", { exact: true })).toBeVisible();
      await pageSize.selectOption(String(EXPANDED_PAGE_SIZE));
      await expect(adminPage.getByText("Page 1 of 1", { exact: true })).toBeVisible();

      const firstCard = adminPage.locator("article").filter({ hasText: facilities[0].code });
      await firstCard.getByRole("button", { name: `Actions for facility ${facilities[0].code}` }).click();
      await expect(adminPage.getByRole("menuitem", { name: "Edit" })).toBeVisible();
      const archiveItem = adminPage.getByRole("menuitem", { name: "Archive" });
      await expect(archiveItem).toBeVisible();
      await expect(archiveItem).not.toHaveClass(/st-bad/);
      await expect(adminPage.getByRole("dialog")).toHaveCount(0);
      await adminPage.keyboard.press("Escape");

      await firstCard.click();
      await expect(adminPage.getByRole("dialog")).toBeVisible();
    } finally {
      await Promise.all(facilities.map((facility) => deleteTestFacility(facility.id)));
    }
  });

  test("credit batches use shared paging and reserve destructive styling for delete", async ({
    adminPage,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batches = await Promise.all(
      Array.from({ length: PAGED_ITEM_COUNT }, (_, index) =>
        seedCreditBatch(
          seededData.facility.id,
          `HUB-${tag}-${String(index).padStart(2, "0")}`,
          seededData.feedstockType.id,
        ),
      ),
    );

    await adminPage.goto(`/credit-batches?facility=${seededData.facility.id}`);
    await expect(
      adminPage.locator("article").filter({ hasText: `HUB-${tag}` }).first(),
    ).toBeVisible({ timeout: 15000 });

    const pageSize = adminPage.getByLabel("Rows per page");
    await expect(pageSize).toHaveValue(String(DEFAULT_PAGE_SIZE));
    await expect(adminPage.getByText("Page 1 of 2", { exact: true })).toBeVisible();
    await adminPage.getByRole("button", { name: "Go to last page" }).click();
    await expect(adminPage.getByText("Page 2 of 2", { exact: true })).toBeVisible();
    await adminPage.getByRole("button", { name: "Go to first page" }).click();
    await adminPage.getByRole("button", { name: "Go to next page" }).click();
    await adminPage.getByRole("button", { name: "Go to previous page" }).click();
    await pageSize.selectOption(String(EXPANDED_PAGE_SIZE));
    await expect(adminPage.getByText("Page 1 of 1", { exact: true })).toBeVisible();

    const firstCard = adminPage.locator("article").filter({ hasText: batches[0].code });
    await firstCard.getByRole("button", { name: `Actions for credit batch ${batches[0].code}` }).click();
    const editItem = adminPage.getByRole("menuitem", { name: "Edit" });
    const deleteItem = adminPage.getByRole("menuitem", { name: "Delete" });
    await expect(editItem).not.toHaveClass(/st-bad/);
    await expect(deleteItem).toHaveClass(/st-bad/);
    await expect(adminPage).toHaveURL(/\/credit-batches\?facility=/);
    await adminPage.keyboard.press("Escape");

    await firstCard.click();
    await expect(adminPage).toHaveURL(new RegExp(`[?&]batch=${batches[0].id}`));
    await expect(
      adminPage
        .getByRole("dialog")
        .getByRole("heading", { name: batches[0].code }),
    ).toBeVisible();
  });
});
