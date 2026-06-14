/**
 * Certification workspace E2E — section navigation across the three routes and
 * the consolidated Settings surface (Stage 3 remodel).
 *
 * Two scenarios live here; the create→submit happy path is its own file
 * (`certification-full-removal-submit.spec.ts`).
 *
 *  1. Section navigation — NO sandbox creds needed. Seeds a DB-only
 *     `certifier_projects` row with a throwaway project id so the facility is
 *     "linked" — the operational routes (Removals / GHG Statements) are gated
 *     behind a registry link (ADR 0007), and the gate reads the
 *     DB-only `loadFacilityCertifierSummary`, so no real project is required.
 *     Then visits each of the three routes via its nav link and asserts the
 *     per-route heading plus that the active `?facility=` scope is preserved on
 *     every hop. Links are addressed by accessible name (sidebar section per
 *     ADR 0007, amended 2026-06-04).
 *  2. Settings round-trip — needs a seeded `certifier_projects` mapping against
 *     the REAL sandbox project (the connection card resolves the project from
 *     Isometric), so it's gated behind the sandbox skip. Asserts the Settings
 *     page renders the linked project in the "Registry connection — Isometric"
 *     card and that the admin-only sections — now behind the Emissions /
 *     Environment tabs (redesign) — mount. The link/edit/unlink dialog
 *     behaviour is covered by `facility-certifier-mapping.spec.ts`.
 *
 * Playwright loads `.env.test` only; we additionally pull `.env.local` (without
 * overriding) so a developer/CI with sandbox creds + `ISOMETRIC_DEMO_PROJECT_ID`
 * gets the linked-state scenario without duplicating values into `.env.test`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  SANDBOX_PROJECT_ID,
  seedCertifierMapping,
} from "./fixtures/certification-helpers";

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

test.describe("Certification workspace — period emissions", () => {
  test("uses LCA PDF upload instead of a raw source document UUID field", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // activate fixture auto-cleanup

    const facilityId = seededData.facility.id;

    await page.goto(
      `/certification/settings?facility=${facilityId}&tab=emissions`,
    );

    await expect(
      page.getByRole("heading", { name: "Emission estimates", level: 2 }),
    ).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: "Add row" }).click();

    await expect(
      page.getByRole("heading", { name: "Add row", level: 2 }),
    ).toBeVisible();
    await page.getByText("Provenance").scrollIntoViewIfNeeded();
    await expect(
      page.getByText("Drop files here or click to upload"),
    ).toBeVisible();
    await expect(page.getByLabel("Source document ID")).toHaveCount(0);
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

      // A · Registry connection — the seeded project resolves into the card.
      await expect(
        page.getByRole("heading", {
          name: "Registry connection — Isometric",
          level: 2,
        }),
      ).toBeVisible();
      await expect(page.getByText(externalProjectId).first()).toBeVisible();
      // Admin sees the management controls (canManage = useIsAdmin()).
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Unlink", exact: true }),
      ).toBeVisible();

      // B/C · Admin-only sections live behind tabs (redesign): Connection is the
      // default tab, so switch to each admin tab and assert its section mounts.
      await page
        .getByRole("button", { name: "Emissions", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Emission estimates", level: 2 }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Environment", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Environment & health", level: 2 }),
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
