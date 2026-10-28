import * as crypto from "crypto";
import { like } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect, createTestFacility, deleteTestFacility } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import { creditBatchRow, creditBatchRows } from "./fixtures/page-helpers";

const PAGED_ITEM_COUNT = 11;
const DEFAULT_PAGE_SIZE = 10;
const EXPANDED_PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 15_000;

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

    await adminPage.goto(`/credit-batches?facility=${seededData.facility.id}&view=list`);
    await expect(
      creditBatchRows(adminPage).filter({ hasText: `HUB-${tag}` }).first(),
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

    const firstRow = creditBatchRow(adminPage, batches[0].code);
    await firstRow.getByRole("button", { name: `Actions for credit batch ${batches[0].code}` }).click();
    const editItem = adminPage.getByRole("menuitem", { name: "Edit" });
    const deleteItem = adminPage.getByRole("menuitem", { name: "Delete" });
    await expect(editItem).not.toHaveClass(/st-bad/);
    await expect(deleteItem).toHaveClass(/st-bad/);
    await expect(adminPage).toHaveURL(/\/credit-batches\?facility=.*view=list/);
    await adminPage.keyboard.press("Escape");

    await firstRow.click();
    await expect(adminPage).toHaveURL(
      (url) => url.pathname === `/credit-batches/${batches[0].id}`,
    );
    await expect(
      adminPage.getByRole("heading", { level: 1, name: batches[0].code }),
    ).toBeVisible();
  });

  // #1280: the footer and search box read the TanStack table through context,
  // so a server page count that arrives after the first render must still show.
  test("orders page through server results and keep the search text", async ({
    adminPage,
    seededData,
  }) => {
    const prefix = `E2E-OR-PG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const { db, pool } = createDbConnection();
    try {
      await db.insert(schema.orders).values(
        Array.from({ length: PAGED_ITEM_COUNT }, (_, index) => ({
          organizationId: DEC_ORG_ID,
          code: `${prefix}-${String(index).padStart(2, "0")}`,
          facilityId: seededData.facility.id,
          orderDate: new Date(),
          customerId: seededData.customer.id,
          customerLocationId: seededData.customerLocation.id,
          formulationId: seededData.formulation.id,
          quantityKg: 100,
          packaging: "loose" as const,
        })),
      );

      await adminPage.goto(`/orders?facility=${seededData.facility.id}`);
      const search = adminPage.getByRole("textbox", { name: "Search orders by code" });
      await search.fill(prefix);
      await expect(search).toHaveValue(prefix);

      const rows = adminPage.locator("table tbody tr");
      await expect(rows.filter({ hasText: prefix })).toHaveCount(DEFAULT_PAGE_SIZE, { timeout: SEARCH_TIMEOUT_MS });
      await expect(adminPage.getByText("Page 1 of 2", { exact: true })).toBeVisible();

      await adminPage.getByRole("button", { name: "Go to next page" }).click();
      await expect(adminPage.getByText("Page 2 of 2", { exact: true })).toBeVisible();
      await expect(rows.filter({ hasText: prefix })).toHaveCount(PAGED_ITEM_COUNT - DEFAULT_PAGE_SIZE);
      await expect(adminPage.getByRole("button", { name: "Go to next page" })).toBeDisabled();
    } finally {
      await db.delete(schema.orders).where(like(schema.orders.code, `${prefix}-%`)).finally(() => pool.end());
    }
  });
});
