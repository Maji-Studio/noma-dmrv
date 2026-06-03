/**
 * Phase 1 carryover — facility ↔ Isometric project mapping E2E.
 *
 * Covers two behaviours that the Phase 1 plan deferred:
 *  - N facilities can map to the same Isometric project (validates the
 *    dropped `certifier_projects_provider_external_unique` constraint
 *    end-to-end through the side-sheet view-mode UI).
 *  - Unlinking is refused when the facility has any
 *    `certificationSubmissions` row (validates the SafeError surfaced
 *    by `UnlinkConfirmDialog`).
 *
 * Strategy: pre-seed `certifier_projects` (and a credit batch +
 * submission for test 2) directly via Drizzle, then drive the UI
 * assertions. The actual link/edit dialog is exercised by
 * `tests/isometric-mapping-lock.test.ts` (unit) and
 * `tests/isometric-sandbox.integration.test.ts` (live API).
 *
 * `loadFacilityCertifierMapping` always reads from Isometric
 * (`listProjects` + `listRemovalTemplates(externalProjectId)`), so the
 * inserted `externalProjectId` must be a real sandbox project.
 * Playwright loads `.env.test` only — we additionally pull `.env.local`
 * (without overriding) so a developer with sandbox creds + an
 * `ISOMETRIC_DEMO_PROJECT_ID` value already configured for `pnpm dev`
 * gets the same value here without duplicating it into `.env.test`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  createTestFacility,
  deleteTestFacility,
  expect,
  test,
} from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";

const SANDBOX_PROJECT_ID = process.env.ISOMETRIC_DEMO_PROJECT_ID;

const UNLINK_GUARD_MESSAGE =
  "Cannot unlink: this facility has certifier submissions. Supersede or reject them first.";

const RUN_ID = crypto.randomUUID().slice(0, 8);

test.describe("Facility ↔ Isometric project mapping", () => {
  test.skip(
    !SANDBOX_PROJECT_ID,
    "ISOMETRIC_DEMO_PROJECT_ID is required for the facility certifier mapping E2E (set in .env.local or .env.test).",
  );

  test("two facilities can be linked to the same Isometric project", async ({
    adminPage: page,
    seededData,
  }) => {
    const sharedProjectId = SANDBOX_PROJECT_ID!;
    const facilityF1 = seededData.facility;
    const facilityF2 = await createTestFacility({
      code: `E2E-FAC-${RUN_ID}-2`,
      name: `E2E Mapping Facility ${RUN_ID}-2`,
      location: "Test Location",
    });

    const { db, pool } = createDbConnection();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.certifierProjects).values([
          {
            facilityId: facilityF1.id,
            provider: "isometric",
            externalProjectId: sharedProjectId,
            protocolSlug: "biochar",
            protocolVersion: "1.2",
            defaultRemovalTemplateId: null,
          },
          {
            facilityId: facilityF2.id,
            provider: "isometric",
            externalProjectId: sharedProjectId,
            protocolSlug: "biochar",
            protocolVersion: "1.2",
            defaultRemovalTemplateId: null,
          },
        ]);
      });

      await page.goto("/facilities");
      await expect(page.getByText("Active Facilities")).toBeVisible({
        timeout: 15000,
      });

      await openFacilityCard(page, facilityF1.code);
      await assertCertifierLinked(page, sharedProjectId);
      await closeSideSheet(page);

      await openFacilityCard(page, facilityF2.code);
      await assertCertifierLinked(page, sharedProjectId);
      await closeSideSheet(page);

      const rows = await db
        .select({
          id: schema.certifierProjects.id,
          facilityId: schema.certifierProjects.facilityId,
        })
        .from(schema.certifierProjects)
        .where(
          and(
            eq(schema.certifierProjects.provider, "isometric"),
            eq(schema.certifierProjects.externalProjectId, sharedProjectId),
          ),
        );
      const linkedFacilityIds = new Set(rows.map((row) => row.facilityId));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(linkedFacilityIds.has(facilityF1.id)).toBe(true);
      expect(linkedFacilityIds.has(facilityF2.id)).toBe(true);
    } finally {
      try {
        await db
          .delete(schema.certifierProjects)
          .where(eq(schema.certifierProjects.facilityId, facilityF1.id));
        await db
          .delete(schema.certifierProjects)
          .where(eq(schema.certifierProjects.facilityId, facilityF2.id));
      } finally {
        await pool.end();
      }
      await deleteTestFacility(facilityF2.id);
    }
  });

  test("unlink is refused when the facility has certification submissions", async ({
    adminPage: page,
    seededData,
  }) => {
    const sandboxProjectId = SANDBOX_PROJECT_ID!;
    const facility = seededData.facility;
    const removalId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();

    const { db, pool } = createDbConnection();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.certifierProjects).values({
          facilityId: facility.id,
          provider: "isometric",
          externalProjectId: sandboxProjectId,
          protocolSlug: "biochar",
          protocolVersion: "1.2",
          defaultRemovalTemplateId: null,
        });
        // The unlink guard (hasBlockingFacilitySubmission) matches a
        // facility-scoped Removal: a certifierRemovals row carrying facilityId
        // joined to a removal-scoped, non-terminal submission. The legacy
        // creditBatch-keyed shape no longer blocks (ADR 0003/0004), so seed
        // the current shape directly.
        await tx.insert(schema.certifierRemovals).values({
          id: removalId,
          facilityId: facility.id,
          provider: "isometric",
        });
        await tx.insert(schema.certificationSubmissions).values({
          id: submissionId,
          provider: "isometric",
          submissionType: "removal",
          localEntityType: "removal",
          localEntityId: removalId,
          version: 1,
          status: "submitted",
          payloadSnapshot: {},
          payloadHash: "fake-hash-unlink-guard",
        });
      });

      await page.goto("/facilities");
      await expect(page.getByText("Active Facilities")).toBeVisible({
        timeout: 15000,
      });
      await openFacilityCard(page, facility.code);

      const sideSheet = page.locator('[role="dialog"]').first();
      await sideSheet
        .getByRole("button", { name: "Unlink", exact: true })
        .click();

      const confirmDialog = page.locator(
        'dialog[aria-labelledby="unlink-dialog-title"]',
      );
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });

      await confirmDialog
        .getByRole("button", { name: "Unlink", exact: true })
        .click();

      await expect(confirmDialog.getByText(UNLINK_GUARD_MESSAGE)).toBeVisible({
        timeout: 10000,
      });
      await expect(confirmDialog).toBeVisible();

      const remaining = await db
        .select({ id: schema.certifierProjects.id })
        .from(schema.certifierProjects)
        .where(eq(schema.certifierProjects.facilityId, facility.id));
      expect(remaining.length).toBe(1);
    } finally {
      try {
        await db
          .delete(schema.certificationSubmissions)
          .where(eq(schema.certificationSubmissions.id, submissionId));
        await db
          .delete(schema.certifierRemovals)
          .where(eq(schema.certifierRemovals.id, removalId));
        await db
          .delete(schema.certifierProjects)
          .where(eq(schema.certifierProjects.facilityId, facility.id));
      } finally {
        await pool.end();
      }
    }
  });
});

async function openFacilityCard(
  page: import("@playwright/test").Page,
  facilityCode: string,
) {
  const searchBox = page.getByPlaceholder(/Search facilities/i);
  await searchBox.fill(facilityCode);
  await page.waitForTimeout(500);

  const card = page.locator("article").filter({ hasText: facilityCode });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();

  await page.waitForSelector('[role="dialog"]', {
    state: "visible",
    timeout: 10000,
  });
}

async function closeSideSheet(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', {
    state: "hidden",
    timeout: 10000,
  });
}

async function assertCertifierLinked(
  page: import("@playwright/test").Page,
  externalProjectId: string,
) {
  const sideSheet = page.locator('[role="dialog"]').first();
  await expect(sideSheet.getByText("Certification", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    sideSheet.getByText(externalProjectId, { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    sideSheet.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(
    sideSheet.getByRole("button", { name: "Unlink", exact: true }),
  ).toBeVisible();
}
