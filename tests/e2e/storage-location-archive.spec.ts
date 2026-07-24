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
    await page.getByLabel("Search storage").fill(bin.name);

    const binCard = page.locator("article").filter({ hasText: bin.name });
    await expect(
      binCard.getByRole("heading", { name: bin.name }),
    ).toBeVisible();

    await binCard
      .getByRole("button", { name: `Actions for ${bin.code}` })
      .click();
    await page
      .getByRole("menuitem", { name: "Delete permanently" })
      .click();

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
      binCard.getByRole("heading", { name: bin.name }),
    ).not.toBeVisible();

    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(
      binCard.getByRole("heading", { name: bin.name }),
    ).toBeVisible();
    await expect(binCard.getByText("Archived", { exact: true })).toBeVisible();

    await binCard
      .getByRole("button", { name: `Actions for ${bin.code}` })
      .click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await expect(
      binCard.getByRole("heading", { name: bin.name }),
    ).not.toBeVisible();

    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(
      binCard.getByRole("heading", { name: bin.name }),
    ).toBeVisible();
  });
});
