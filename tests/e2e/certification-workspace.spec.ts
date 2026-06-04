/**
 * Certification workspace E2E — section navigation across the four routes and
 * the consolidated Settings surface (Stage 3 remodel).
 *
 * Two scenarios live here; the heavier guided-Review happy path is its own
 * file (`certification-review-flow.spec.ts`).
 *
 *  1. Section navigation — NO Isometric creds needed. Visits each of the four
 *     certification routes (Overview / Removals / GHG Statements / Settings) via
 *     its nav link and asserts the per-route heading plus that the active
 *     `?facility=` scope is preserved on every hop. Links are addressed by
 *     accessible name, so this holds whether the sub-nav is the in-page tab bar
 *     or the sidebar section (ADR 0007 amended 2026-06-04 moved it to the
 *     sidebar — same labels, hrefs, and `?facility=` behaviour).
 *  2. Settings round-trip — needs a seeded `certifier_projects` mapping (the
 *     load-bearing gotcha: `loadFacilityCertifierMapping` always reads from
 *     Isometric, so a linked facility can only be produced with sandbox creds
 *     + a real project id). Gated behind the sandbox skip, mirroring
 *     `facility-certifier-mapping.spec.ts`. Asserts the Settings page renders
 *     the linked project in the "Registry connection — Isometric" card and that
 *     the admin-only sections (Emission estimates, Environment & health) mount.
 *     The link/edit/unlink dialog behaviour is already covered by
 *     `facility-certifier-mapping.spec.ts` — not duplicated here.
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
  { label: "Overview", path: "/certification" },
  { label: "Removals", path: "/certification/removals" },
  { label: "GHG Statements", path: "/certification/ghg-statements" },
  { label: "Settings", path: "/certification/settings" },
] as const;

test.describe("Certification workspace — section navigation", () => {
  test("navigates every section route and preserves the facility scope", async ({
    adminPage: page,
    seededData,
  }) => {
    const facilityId = seededData.facility.id;
    await page.goto(`/certification?facility=${facilityId}`);

    // Await the landing heading so the shell has hydrated before we navigate.
    // The section links are unique in the page, so we address them by name
    // rather than scoping to a particular nav landmark.
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible({ timeout: 20000 });
    const navLink = (label: string) =>
      page.getByRole("link", { name: label, exact: true });
    // Gate on the facility context having hydrated: a section link only appends
    // `?facility=` once `useFacilityContext().facilityId` is populated. Clicking
    // before then would navigate without the scope and drop it. Waiting on the
    // href (rather than mere visibility) is the precise readiness signal.
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
  });
});

test.describe("Certification workspace — Settings", () => {
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

      // B/C · Admin-only sections mount for an admin viewer.
      await expect(
        page.getByRole("heading", { name: "Emission estimates", level: 2 }),
      ).toBeVisible();
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
  // Overview is the section root (exact path); the others are nested segments.
  const urlPattern =
    path === "/certification"
      ? new RegExp(`/certification\\?facility=${facilityId}`)
      : new RegExp(`${path}\\?facility=${facilityId}`);
  await page.waitForURL(urlPattern, { timeout: 15000 });

  await expect(
    page.getByRole("heading", { name: label, level: 1 }),
  ).toBeVisible();
  // The facility scope must survive the navigation.
  await expect(page).toHaveURL(new RegExp(`facility=${facilityId}`));
}
