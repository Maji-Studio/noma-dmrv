/**
 * Certification workspace E2E — section navigation across the three routes and
 * the consolidated Settings surface (Stage 3 remodel).
 *
 * Three scenarios live here; the create→submit happy path is its own file
 * (`certification-full-removal-submit.spec.ts`).
 *
 *  1. Section navigation — NO sandbox creds needed. Seeds a DB-only
 *     `certifier_projects` row with a throwaway project id so the facility is
 *     "linked" — the operational routes (Removals / GHG Statements) are gated
 *     behind a registry link (ADR 0007), and the gate reads the
 *     DB-only `readFacilityCertifierSummary`, so no real project is required.
 *     Then visits each of the three routes via its nav link and asserts the
 *     per-route heading plus that the active `?facility=` scope is preserved on
 *     every hop. Links are addressed by accessible name (sidebar section per
 *     ADR 0007, amended 2026-06-04).
 *  2. Status history — DB-only. Seeds a submitted Removal with a recorded
 *     status change, opens its badge's history from the Removals list and the
 *     detail sheet, and closes it with Escape.
 *  3. Settings round-trip — needs a seeded `certifier_projects` mapping against
 *     the REAL sandbox project (the connection card resolves the project from
 *     Isometric), so it's gated behind the sandbox skip. Asserts the Settings
 *     page renders the linked project in the Certifier pane (the console's
 *     default) and that the admin-only categories — Emissions and Diagnostics,
 *     reached from the settings rail — mount. The link/edit/unlink dialog
 *     behaviour is covered by `facility-certifier-mapping.spec.ts`.
 *
 * Playwright loads `.env.test` only; we additionally pull `.env.local` (without
 * overriding) so a developer/CI with sandbox creds + `ISOMETRIC_DEMO_PROJECT_ID`
 * gets the linked-state scenario without duplicating values into `.env.test`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import * as crypto from "crypto";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { expect, test } from "./fixtures";
import {
  SANDBOX_PROJECT_ID,
  seedCertifierMapping,
} from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";

const SECTIONS = [
  { label: "Removals", path: "/certification/removals" },
  { label: "GHG Statements", path: "/certification/ghg-statements" },
  { label: "Settings", path: "/certification/settings" },
] as const;

// DB-only link target to un-gate the operational routes; never reaches
// Isometric, so any string works. (Page DATA queries 404 against a fake
// project, leaving an "Unable to load…" content error — harmless here, since
// this test only asserts each route's heading + the preserved `?facility=`
// scope, both of which are page chrome that renders independent of the data.)
const FAKE_PROJECT_ID = "e2e-workspace-fake-project";

// First navigation to a not-yet-compiled certification route can take 10-30s in
// dev (Turbopack cold compile), worse under parallel load; give the per-hop
// URL + heading assertions that budget so the test isn't compile-flaky.
const COLD_COMPILE_TIMEOUT_MS = 30_000;

test.describe("Certification workspace — section navigation", () => {
  test("navigates every section route and preserves the facility scope", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // activate fixture auto-cleanup

    const facilityId = seededData.facility.id;
    // Operational cert routes are gated on a registry link (ADR 0007). Seed a
    // DB-only mapping so the nav links surface and the routes don't redirect to
    // Settings; the gate reads `useFacilityCertifierSummary` (DB only), so a
    // throwaway project id is enough — no sandbox creds needed.
    const mapping = await seedCertifierMapping(facilityId, {
      externalProjectId: FAKE_PROJECT_ID,
    });
    try {
      await page.goto(`/certification?facility=${facilityId}`);

      // The retired root route redirects to Removals; await the landing heading
      // so the shell has hydrated before we navigate.
      // The section links are unique in the page, so we address them by name
      // rather than scoping to a particular nav landmark.
      await page.waitForURL(
        new RegExp(`/certification/removals\\?facility=${facilityId}`),
        { timeout: COLD_COMPILE_TIMEOUT_MS },
      );
      await expect(
        page.getByRole("heading", { name: "Removals", level: 1 }),
      ).toBeVisible({ timeout: 20000 });
      const navLink = (label: string) =>
        page.getByRole("link", { name: label, exact: true });
      // Gate on the facility context having hydrated: a section link only
      // appends `?facility=` once `useFacilityContext().facilityId` is
      // populated. Clicking before then would navigate without the scope and
      // drop it. Waiting on the href (rather than visibility) is the precise
      // readiness signal.
      await expect(navLink("Removals")).toHaveAttribute(
        "href",
        new RegExp(`facility=${facilityId}`),
      );

      // Visit each route in turn; assert the URL, the heading, and that the
      // `?facility=` scope rides along (every section link carries it).
      for (const section of SECTIONS) {
        await navLink(section.label).click();
        await assertOnSection(page, section.label, section.path, facilityId);
      }
    } finally {
      await mapping.cleanup();
    }
  });
});

test.describe("Certification workspace — status history", () => {
  test("opens a Removal badge's status history and closes it with Escape", async ({
    adminPage: page,
    seededData,
    testUsers,
    cleanupTestData,
  }) => {
    void cleanupTestData; // activate fixture auto-cleanup

    const facilityId = seededData.facility.id;
    const removalId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const submittedAt = new Date(Date.now() - 60 * 60 * 1000);
    const mapping = await seedCertifierMapping(facilityId, {
      externalProjectId: FAKE_PROJECT_ID,
    });
    const { db, pool } = createDbConnection();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.certifierRemovals).values({
          organizationId: DEC_ORG_ID,
          id: removalId,
          facilityId,
          provider: "isometric",
          // A submitted Removal without a reporting window reads as interrupted.
          startedOn: createdAt.toISOString().slice(0, 10),
          completedOn: submittedAt.toISOString().slice(0, 10),
        });
        await tx.insert(schema.certificationSubmissions).values({
          organizationId: DEC_ORG_ID,
          id: submissionId,
          provider: "isometric",
          submissionType: "removal",
          localEntityType: "removal",
          localEntityId: removalId,
          version: 1,
          status: "submitted",
          payloadSnapshot: {},
          payloadHash: "e2e-status-history",
          createdAt,
          submittedAt,
          updatedAt: submittedAt,
        });
        await tx.insert(schema.activityEvents).values({
          organizationId: DEC_ORG_ID,
          facilityId,
          occurredAt: submittedAt,
          entityType: "removal",
          entityId: removalId,
          action: "status_changed",
          fromStatus: "draft",
          toStatus: "submitted",
          submissionRef: {
            provider: "isometric",
            submissionType: "removal",
            submissionId,
            version: 1,
          },
          source: "form",
          actorUserId: testUsers.admin.id,
        });
      });

      await page.goto(`/certification/removals?facility=${facilityId}`);
      const listBadge = page
        .getByRole("table", { name: "Removals" })
        .getByRole("button", { name: "Submitted, status history" });
      await expect(listBadge).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });

      // The popover opens from the list without opening the detail sheet.
      await listBadge.click();
      const history = page.getByRole("dialog", { name: "Status history" });
      await expect(history).toBeVisible();
      const entries = history.getByRole("list", { name: "Status changes, newest first" }).getByRole("listitem");
      await expect(entries).toHaveCount(2);
      await expect(entries.nth(0)).toContainText("Submitted");
      await expect(entries.nth(0)).toContainText(testUsers.admin.name);
      await expect(entries.nth(1)).toContainText("Not submitted");
      await expect(page).not.toHaveURL(/removal=/);

      // React events bubble through the portal to the row: a press on plain
      // popover content must not open the row's detail sheet.
      const sheet = page.getByRole("dialog").filter({ has: page.getByText("Submission status") });
      await entries.nth(1).getByText("Version 1").click();
      await expect(history).toBeVisible();
      await expect(page).not.toHaveURL(/removal=/);
      await expect(sheet).toHaveCount(0);

      await page.keyboard.press("Escape");
      await expect(history).toBeHidden();
      await expect(listBadge).toBeFocused();

      // The record link in the row's first cell opens the sheet by keyboard
      // (the row itself has no tab stop); a click on the row opens it too.
      const row = page
        .getByRole("table", { name: "Removals" })
        .getByRole("row")
        .filter({ hasText: removalId.slice(0, 8) });
      await row.locator("[data-row-link]").focus();
      await page.keyboard.press("Enter");
      await expect(sheet).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`removal=${removalId}`));
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);

      // Same badge on the detail sheet; Escape closes the popover, not the sheet.
      await page.getByRole("cell", { name: new RegExp(removalId.slice(0, 8)) }).click();
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Submitted, status history" }).click();
      await expect(history).toBeVisible();
      await expect(history.getByRole("listitem")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(history).toBeHidden();
      await expect(sheet).toBeVisible();
    } finally {
      try {
        await db.delete(schema.activityEvents).where(eq(schema.activityEvents.entityId, removalId));
        await db.delete(schema.certificationSubmissions).where(eq(schema.certificationSubmissions.id, submissionId));
        await db.delete(schema.certifierRemovals).where(eq(schema.certifierRemovals.id, removalId));
      } finally {
        await pool.end();
        await mapping.cleanup();
      }
    }
  });
});

// @live — talks to the real Isometric sandbox; excluded from PR CI (e2e.yml
// runs --grep-invert @live) and exercised by the nightly e2e-live workflow.
test.describe("Certification workspace — Settings", { tag: "@live" }, () => {
  test.skip(
    !SANDBOX_PROJECT_ID,
    "ISOMETRIC_DEMO_PROJECT_ID is required to seed a linked facility for the Settings round-trip (set in .env.local or CI secrets).",
  );

  test("renders the linked Isometric project and admin-only sections", async ({
    adminPage: page,
    seededData,
  }) => {
    const facilityId = seededData.facility.id;
    const externalProjectId = SANDBOX_PROJECT_ID!;

    const mapping = await seedCertifierMapping(facilityId, { externalProjectId });
    try {
      await page.goto(`/certification/settings?facility=${facilityId}`);

      await expect(
        page.getByRole("heading", { name: "Settings", level: 1 }),
      ).toBeVisible({ timeout: 15000 });

      // A · Certifier is the console's default pane — the seeded project
      // resolves into it, below the organization keys.
      await expect(
        page.getByRole("heading", { name: "Certifier", level: 2 }),
      ).toBeVisible();
      await expect(page.getByText(externalProjectId).first()).toBeVisible();
      // Admin sees the management controls (canManage = viewerCanManage).
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Unlink", exact: true }),
      ).toBeVisible();

      // B/C · The other categories are rail entries, not tabs: clicking one
      // swaps the pane, and only the selected pane is mounted.
      const rail = page.getByRole("navigation", {
        name: "Certification settings categories",
      });
      await rail.getByRole("button", { name: "Emissions" }).click();
      await expect(
        page.getByRole("heading", { name: "Emissions", level: 2 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Certifier", level: 2 }),
      ).toHaveCount(0);

      await rail.getByRole("button", { name: "Diagnostics" }).click();
      await expect(
        page.getByRole("heading", { name: "Diagnostics", level: 2 }),
      ).toBeVisible();
    } finally {
      await mapping.cleanup();
    }
  });
});

async function assertOnSection(
  page: Page,
  label: string,
  path: string,
  facilityId: string,
) {
  await expect(page).toHaveURL(new RegExp(`${path}\\?facility=${facilityId}`), {
    timeout: COLD_COMPILE_TIMEOUT_MS,
  });

  await expect(
    page.getByRole("heading", { name: label, level: 1 }),
  ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
  // The facility scope must survive the navigation.
  await expect(page).toHaveURL(new RegExp(`facility=${facilityId}`));
}
