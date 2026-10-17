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

  test("offers no delete for a used bin, then archives and restores it", async ({
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

    // A bin with movement history is In use (#1119), so the menu never
    // offers the delete the server would refuse; Archive is the way out.
    await expect(binCard.locator('[data-record-lock="inUse"]')).toHaveText("In use");
    await expect(async () => {
      await binCard
        .getByRole("button", { name: `Actions for ${bin.code}` })
        .click({ timeout: 5_000 });
      await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole("menuitem", { name: "Delete permanently" })).toHaveCount(0);
    await page.keyboard.press("Escape");

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
