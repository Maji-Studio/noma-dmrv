/**
 * Certification registry-gating E2E tests
 *
 * Certification is a conditional workspace (ADR 0007): its operational routes
 * (Removals, GHG Statements) only surface once the current facility
 * is linked to a registry. Settings stays reachable always — it's where the
 * link is created. These tests cover both the sidebar nav-hiding
 * (`app-sidebar.tsx`) and the route guard (`certification-registry-guard.tsx`).
 *
 * The summary the gate reads (`loadFacilityCertifierSummary`) is DB-only — no
 * Isometric API — so the link row is seeded directly via Drizzle with a
 * throwaway project id. No sandbox creds required; no `test.skip`.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  deleteCertifierMapping,
  seedCertifierMapping,
} from "./fixtures/certification-helpers";

const CERTIFICATION_SETTINGS_URL = "/certification/settings";
const CERTIFICATION_ROOT_URL = "/certification";
const CERTIFICATION_REMOVALS_URL = "/certification/removals";

// DB-only link target; never reaches Isometric, so any string is fine.
const FAKE_PROJECT_ID = "e2e-gating-fake-project";

// Operational links hidden until a registry is linked; Settings is the lone
// always-visible entry point.
const OPERATIONAL_LINKS = ["Removals", "GHG Statements"] as const;

// First navigation to a not-yet-compiled certification route can take 10-30s in
// dev (Turbopack cold compile) before the client-side guard can run its
// redirect; give the URL assertions room so the test isn't compile-flaky.
const REDIRECT_TIMEOUT_MS = 30_000;

/** Wait for the FacilityProvider to resolve — the facility name renders in the
 *  sidebar only once it has, which is also when the gate's summary query runs. */
async function waitForSidebarHydration(page: Page, facilityName: string) {
  await expect(
    page.locator("aside").getByText(facilityName, { exact: false }),
  ).toBeVisible({ timeout: 15000 });
}

test.describe("Certification registry gating", () => {
  test("hides operational routes and redirects to Settings when the facility has no registry", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // ensure fixture is active for auto-cleanup

    // Seeded facilities have no certifier mapping, but delete defensively in
    // case a prior test in this worker linked the shared facility.
    await deleteCertifierMapping(seededData.facility.id);

    const aside = adminPage.locator("aside");
    const settingsUrl = `${CERTIFICATION_SETTINGS_URL}?facility=${seededData.facility.id}`;

    // Settings stays reachable without a link — load it and let the sidebar hydrate.
    await adminPage.goto(settingsUrl);
    await waitForSidebarHydration(adminPage, seededData.facility.name);

    // Settings link present...
    await expect(
      aside.getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();

    // ...but no operational links.
    for (const label of OPERATIONAL_LINKS) {
      await expect(
        aside.getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    }

    // Direct URL access to an operational route redirects to Settings.
    await adminPage.goto(
      `${CERTIFICATION_REMOVALS_URL}?facility=${seededData.facility.id}`,
    );
    await expect(adminPage).toHaveURL(
      new RegExp(`${CERTIFICATION_SETTINGS_URL}`),
      { timeout: REDIRECT_TIMEOUT_MS },
    );

    // The retired root route redirects through Removals, which is also guarded.
    await adminPage.goto(
      `${CERTIFICATION_ROOT_URL}?facility=${seededData.facility.id}`,
    );
    await expect(adminPage).toHaveURL(
      new RegExp(`${CERTIFICATION_SETTINGS_URL}`),
      { timeout: REDIRECT_TIMEOUT_MS },
    );
  });

  test("shows operational routes and allows access once the facility has a registry", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const mapping = await seedCertifierMapping(seededData.facility.id, {
      externalProjectId: FAKE_PROJECT_ID,
    });

    try {
      const aside = adminPage.locator("aside");

      await adminPage.goto(
        `${CERTIFICATION_SETTINGS_URL}?facility=${seededData.facility.id}`,
      );
      await waitForSidebarHydration(adminPage, seededData.facility.name);

      // Operational links appear once the summary query confirms the link.
      for (const label of OPERATIONAL_LINKS) {
        await expect(
          aside.getByRole("link", { name: label, exact: true }),
        ).toBeVisible({ timeout: 15000 });
      }

      // Direct access to an operational route is no longer redirected.
      await adminPage.goto(
        `${CERTIFICATION_REMOVALS_URL}?facility=${seededData.facility.id}`,
      );
      await expect(adminPage).toHaveURL(
        new RegExp(`${CERTIFICATION_REMOVALS_URL}`),
        { timeout: REDIRECT_TIMEOUT_MS },
      );
      // And it did NOT bounce to Settings.
      await expect(adminPage).not.toHaveURL(
        new RegExp(`${CERTIFICATION_SETTINGS_URL}`),
      );

      // The root entry point now lands on the first concrete route.
      await adminPage.goto(
        `${CERTIFICATION_ROOT_URL}?facility=${seededData.facility.id}`,
      );
      await expect(adminPage).toHaveURL(
        new RegExp(`${CERTIFICATION_REMOVALS_URL}`),
        { timeout: REDIRECT_TIMEOUT_MS },
      );
    } finally {
      await mapping.cleanup();
    }
  });
});
