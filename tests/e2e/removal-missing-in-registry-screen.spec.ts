/**
 * A Sent Removal that Isometric no longer has (#1689): the sheet's "Missing in Isometric" notice with Send again,
 * and the review that sets the figures sent before beside today's.
 *
 * Seeds a clean Sent Removal (one finalized version, no returned statement, figures unchanged). The registry stub answers 404 for every Removal read,
 * which is what a Removal deleted by hand in Isometric looks like, so this runs the way the returned Removal screens
 * do (see helpers/returned-removal-registry-stub.cjs for the server command; RETURNED_STATEMENT_STUB=1). Without
 * that preload it skips.
 *
 * RESEND_SHOTS=before|after saves screenshots under artifacts/resend-missing/<phase>/ (not committed).
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { fixtureOrgId } from "./fixtures/fixture-org";
import { returnedRemovalSeedsEnabled, seedReturnedConnection, seedReturnedRemoval } from "./fixtures/returned-removal-seed";
import { waitForFacilityHydration, waitForSideSheet } from "./fixtures/page-helpers";

const PHASE = process.env.RESEND_SHOTS;
const SHOT_DIR = path.join(process.cwd(), "artifacts", "resend-missing", PHASE ?? "after");
const CHECK_COPY = PHASE !== "before";
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;

async function shoot(page: Page, name: string, width: keyof typeof WIDTHS) {
  if (!PHASE) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${WIDTHS[width].width}.png`) });
}

test.describe("Removal missing in Isometric", () => {
  test.skip(!returnedRemovalSeedsEnabled(), "Needs CREDENTIALS_ENCRYPTION_KEY and the registry stub preload.");

  for (const size of ["desktop", "phone"] as const) {
    test(`the sheet offers Send again and the review compares figures (${size})`, async ({ adminPage: page, seededData, testUsers }) => {
      test.setTimeout(300_000);
      const facilityId = seededData.facility.id;
      const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
      const cleanupConnection = await seedReturnedConnection(facilityId);
      let cleanup: (() => Promise<void>) | undefined;
      try {
        const removal = await seedReturnedRemoval(seededData, tag, {
          adminUserId: testUsers.admin.id, changed: false, statementStatus: "DRAFT", periodStartOn: "2026-07-01", periodEndOn: "2026-09-30",
        });
        cleanup = removal.cleanup;
        // The real case: Sent, one finalized version, and no GHG Statement (so nothing returned).
        const conn = createDbConnection();
        try {
          // The seed's window is a fixed past quarter; a clean Sent Removal's window is the one it was sent with.
          const [sent] = await conn.db.select({ snapshot: schema.certificationSubmissions.payloadSnapshot }).from(schema.certificationSubmissions).where(and(
            eq(schema.certificationSubmissions.organizationId, fixtureOrgId()), eq(schema.certificationSubmissions.localEntityId, removal.removalId)));
          const window = (sent.snapshot as { semantic: { startedOn: string; completedOn: string } }).semantic;
          await conn.db.update(schema.certifierRemovals).set({
            ghgStatementId: null, startedOn: window.startedOn.slice(0, 10), completedOn: window.completedOn.slice(0, 10),
          }).where(and(
            eq(schema.certifierRemovals.organizationId, fixtureOrgId()), eq(schema.certifierRemovals.id, removal.removalId)));
          await conn.db.delete(schema.certificationSubmissions).where(and(
            eq(schema.certificationSubmissions.organizationId, fixtureOrgId()), eq(schema.certificationSubmissions.localEntityId, removal.statementId)));
        } finally {
          await conn.pool.end();
        }
        await page.setViewportSize(WIDTHS[size]);
        await page.goto(`/removals?facility=${facilityId}&removal=${removal.removalId}`);
        if (size === "desktop") await waitForFacilityHydration(page, seededData.facility.name);
        await waitForSideSheet(page);
        const sheet = page.getByRole("dialog");
        if (CHECK_COPY) {
          await expect(sheet.getByText("Missing in Isometric")).toBeVisible({ timeout: 30_000 });
          await expect(sheet).toContainText("It can be sent again from today's records.");
        } else {
          await expect(sheet).toContainText(removal.removalCode, { timeout: 30_000 });
          await page.waitForTimeout(3_000);
        }
        await shoot(page, "removal-sheet", size);
        if (!CHECK_COPY) {
          // Before the change: the review of the same Removal has no comparison.
          await page.goto(`/removals?facility=${facilityId}&resume=${removal.removalId}`);
          await expect(page.getByRole("dialog").getByText("Review & submit").first()).toBeVisible({ timeout: 60_000 });
          await shoot(page, "review-comparison", size);
          return;
        }

        await sheet.getByRole("button", { name: "Send again" }).click();
        await expect(page).toHaveURL(new RegExp(`resume=${removal.removalId}`), { timeout: 60_000 });
        const review = page.getByRole("dialog");
        await expect(review.getByText(/^Compared with version 1$/)).toBeVisible({ timeout: 60_000 });
        await expect(review).toContainText("The figures match the version Isometric lost.");
        await shoot(page, "review-comparison", size);
      } finally {
        await cleanup?.();
        await cleanupConnection();
      }
    });
  }
});
