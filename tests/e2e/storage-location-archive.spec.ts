import { eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import {
  createTestFacility,
  createTestStorageLocation,
  deleteTestFacility,
  deleteTestStorageLocation,
  type TestFacility,
  type TestStorageLocation,
} from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";

type DbConnection = ReturnType<typeof createDbConnection>;

test.describe("Storage-bin archive", () => {
  let facility: TestFacility;
  let bin: TestStorageLocation;
  let connection: DbConnection;

  test.beforeAll(async () => {
    connection = createDbConnection();
    facility = await createTestFacility();
    bin = await createTestStorageLocation(facility.id, {
      type: "product_bin",
    });
    await connection.db.insert(schema.binMovements).values([
      {
        organizationId: DEC_ORG_ID,
        storageLocationId: bin.id,
        lane: "product",
        movementType: "adjustment",
        massDeltaKg: 25,
        reason: "E2E archive fixture intake",
      },
      {
        organizationId: DEC_ORG_ID,
        storageLocationId: bin.id,
        lane: "product",
        movementType: "adjustment",
        massDeltaKg: -25,
        reason: "E2E archive fixture drawdown",
      },
    ]);
  });

  test.afterAll(async () => {
    if (bin && connection) {
      await connection.db
        .delete(schema.binMovements)
        .where(eq(schema.binMovements.storageLocationId, bin.id));
    }
    if (bin) await deleteTestStorageLocation(bin.id);
    if (facility) await deleteTestFacility(facility.id);
    if (connection?.pool) await connection.pool.end();
  });

  test("explains blocked deletion, then archives and restores the used bin", async ({
    adminPage,
  }) => {
    const page = adminPage;
    await page.goto(`/storage-locations?facility=${facility.id}`);
    await expect(page.getByRole("heading", { name: "Storage" })).toBeVisible();
    const filteredListResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/storage-locations",
    );
    await page.getByLabel("Search storage").fill(bin.name);
    await filteredListResponse;

    const binCard = page.locator("article").filter({ hasText: bin.name });
    await expect(
      binCard.getByText(bin.name, { exact: true }),
    ).toBeVisible();

    // A list refetch can replace the card between opening its overflow menu
    // and selecting an item. Retry the complete interaction so Playwright
    // reacquires both elements from the current render.
    await expect(async () => {
      await binCard
        .getByRole("button", { name: `Actions for ${bin.code}` })
        .click({ timeout: 5_000 });
      await page
        .getByRole("menuitem", { name: "Delete permanently" })
        .click({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    const deleteDialog = page.getByRole("dialog", {
      name: "Delete Storage Bin",
    });
    await deleteDialog
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(deleteDialog.getByRole("alert")).toContainText(
      "movement history",
    );
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();

    await binCard
      .getByRole("button", { name: `Actions for ${bin.code}` })
      .click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(
      binCard.getByText(bin.name, { exact: true }),
    ).not.toBeVisible();

    await page.getByRole("checkbox", { name: "Show archived" }).click();
    await expect(
      binCard.getByText(bin.name, { exact: true }),
    ).toBeVisible();
    await expect(binCard.getByText("Archived", { exact: true })).toBeVisible();

    await binCard
      .getByRole("button", { name: `Actions for ${bin.code}` })
      .click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await expect(
      binCard.getByText(bin.name, { exact: true }),
    ).not.toBeVisible();

    await page.getByRole("checkbox", { name: "Show archived" }).click();
    await expect(
      binCard.getByText(bin.name, { exact: true }),
    ).toBeVisible();
  });
});
