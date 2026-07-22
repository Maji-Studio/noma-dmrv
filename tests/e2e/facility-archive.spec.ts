/**
 * Facility Cascading Archive E2E Guard
 *
 * Covers:
 * - Archiving a facility from the list (confirm dialog with impact preview)
 * - The cascade stamps facility-scoped children (asserted at DB level — the
 *   storage bin gains archived_at in the same transaction)
 * - Archived facilities disappear from the active list and appear in the
 *   archived view with a badge
 * - Restore brings the facility and its children back
 */
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

// One pool for the whole spec — getArchivedStamps runs inside expect.poll, and
// opening/closing a pool per tick churns connections.
type DbConnection = ReturnType<typeof createDbConnection>;

async function getArchivedStamps(db: DbConnection["db"], facilityId: string, storageLocationId: string) {
  const [facility] = await db
    .select({ archivedAt: schema.facilities.archivedAt })
    .from(schema.facilities)
    .where(eq(schema.facilities.id, facilityId));
  const [bin] = await db
    .select({ archivedAt: schema.storageLocations.archivedAt })
    .from(schema.storageLocations)
    .where(eq(schema.storageLocations.id, storageLocationId));
  return {
    facilityArchivedAt: facility?.archivedAt ?? null,
    binArchivedAt: bin?.archivedAt ?? null,
  };
}

test.describe("Facility cascading archive", () => {
  let facility: TestFacility;
  let bin: TestStorageLocation;
  let connection: DbConnection;

  test.beforeAll(async () => {
    connection = createDbConnection();
    facility = await createTestFacility();
    bin = await createTestStorageLocation(facility.id, { type: "feedstock_bin" });
  });

  test.afterAll(async () => {
    // Guard each step — beforeAll may have failed partway through, and an
    // unguarded teardown throw would mask the original error.
    if (bin) await deleteTestStorageLocation(bin.id);
    if (facility) await deleteTestFacility(facility.id);
    if (connection?.pool) await connection.pool.end();
  });

  test("archive hides the facility and cascades to children; restore reverses it", async ({ adminPage }) => {
    const page = adminPage;

    // --- Facility is visible in the active list ---
    await page.goto("/facilities");
    await expect(page.getByText("Active Facilities")).toBeVisible({
      timeout: 15000,
    });
    await page.getByLabel("Search facilities").fill(facility.name);
    const facilityCard = page.locator("article").filter({ hasText: facility.name });
    await expect(facilityCard.getByRole("heading", { name: facility.name })).toBeVisible({
      timeout: 10000,
    });

    // --- Archive via the card action + confirm dialog ---
    await facilityCard
      .getByRole("button", { name: `Actions for facility ${facility.code}` })
      .click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();

    const dialog = page.getByRole("dialog");
    // The dialog names the target facility (QA 2026-07-21 F4)
    await expect(
      dialog.getByText(`Archive facility ${facility.code}`),
    ).toBeVisible();
    // Impact preview lists the attached bin
    await expect(dialog.getByText(/1 storage bin/)).toBeVisible({
      timeout: 30000,
    });
    // A populated facility requires typing its code before Archive enables
    const archiveButton = dialog.getByRole("button", { name: "Archive", exact: true });
    await expect(archiveButton).not.toHaveAttribute("class", /color-signal-red/);
    await expect(archiveButton).toBeDisabled();
    await dialog.getByPlaceholder(facility.code).fill(facility.code);
    await expect(archiveButton).toBeEnabled();
    await archiveButton.click();

    // --- Facility disappears from the active list ---
    await expect(facilityCard.getByRole("heading", { name: facility.name })).not.toBeVisible({
      timeout: 30000,
    });

    // --- Cascade stamped the child bin in the same transaction ---
    await expect
      .poll(
        async () => {
          const stamps = await getArchivedStamps(connection.db, facility.id, bin.id);
          return stamps.facilityArchivedAt !== null && stamps.binArchivedAt !== null;
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // --- Archived view shows the facility with a badge and a Restore action ---
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(facilityCard.getByRole("heading", { name: facility.name })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Archived Facilities")).toBeVisible();

    // --- Restore brings facility + children back ---
    await facilityCard
      .getByRole("button", { name: `Actions for facility ${facility.code}` })
      .click();
    await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
    await expect(facilityCard.getByRole("heading", { name: facility.name })).not.toBeVisible({
      timeout: 30000,
    });

    await expect
      .poll(
        async () => {
          const restored = await getArchivedStamps(connection.db, facility.id, bin.id);
          return restored.facilityArchivedAt === null && restored.binArchivedAt === null;
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // --- Back on the active list it is visible again ---
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(facilityCard.getByRole("heading", { name: facility.name })).toBeVisible({
      timeout: 10000,
    });
  });
});
