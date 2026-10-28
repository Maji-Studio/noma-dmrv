/**
 * Certification registry-gating E2E tests
 *
 * Certification is a conditional workspace (ADR 0007): its operational routes
 * (Removals, GHG Statements) only surface once the current facility
 * is linked to a registry. Without a link the sidebar shows no Certification
 * section and the route guard sends direct visits to Settings, Registry
 * (#1277). These tests cover both the sidebar (`sidebar-content.tsx`) and the
 * route guard (`certification-registry-guard.tsx`).
 *
 * The summary the gate reads (`readFacilityCertifierSummary`) is DB-only — no
 * Isometric API — so the link row is seeded directly via Drizzle with a
 * throwaway project id. No sandbox creds required; no `test.skip`.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  deleteCertifierMapping,
  seedCertifierMapping,
} from "./fixtures/certification-helpers";

const REGISTRY_SETTINGS_URL = "/settings/registry";
const CERTIFICATION_STATEMENTS_URL = "/ghg-statements";
const CERTIFICATION_REMOVALS_URL = "/removals";

// DB-only link target; never reaches Isometric, so any string is fine.
const FAKE_PROJECT_ID = "e2e-gating-fake-project";

// Certification links hidden until a registry is linked.
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
  test("hides the Certification section and redirects to Settings, Registry when the facility has no registry", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // ensure fixture is active for auto-cleanup

    // Seeded facilities have no certifier mapping, but delete defensively in
    // case a prior test in this worker linked the shared facility.
    await deleteCertifierMapping(seededData.facility.id);

    const aside = adminPage.locator("aside");
    const settingsUrl = `${REGISTRY_SETTINGS_URL}?facility=${seededData.facility.id}`;

    await adminPage.goto(settingsUrl);
    await waitForSidebarHydration(adminPage, seededData.facility.name);

    // The only "Settings" link left is the footer gear; Certification has none.
    await expect(
      aside.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveCount(1);
    await expect(aside.getByText("Certification", { exact: true })).toHaveCount(0);

    for (const label of OPERATIONAL_LINKS) {
      await expect(
        aside.getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    }

    // Direct URL access to an operational route redirects to Settings, Registry.
    await adminPage.goto(
      `${CERTIFICATION_REMOVALS_URL}?facility=${seededData.facility.id}`,
    );
    await expect(adminPage).toHaveURL(
      new RegExp(`${REGISTRY_SETTINGS_URL}`),
      { timeout: REDIRECT_TIMEOUT_MS },
    );

    // GHG Statements has the same registry guard.
    await adminPage.goto(
      `${CERTIFICATION_STATEMENTS_URL}?facility=${seededData.facility.id}`,
    );
    await expect(adminPage).toHaveURL(
      new RegExp(`${REGISTRY_SETTINGS_URL}`),
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
        `${REGISTRY_SETTINGS_URL}?facility=${seededData.facility.id}`,
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
        new RegExp(`${REGISTRY_SETTINGS_URL}`),
      );

      // GHG Statements also stays accessible with a registry link.
      await adminPage.goto(
        `${CERTIFICATION_STATEMENTS_URL}?facility=${seededData.facility.id}`,
      );
      await expect(adminPage).toHaveURL(
        new RegExp(`${CERTIFICATION_STATEMENTS_URL}`),
        { timeout: REDIRECT_TIMEOUT_MS },
      );
    } finally {
      await mapping.cleanup();
    }
  });
});
