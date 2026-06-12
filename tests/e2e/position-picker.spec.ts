/**
 * PositionPicker + DistanceCalcField E2E (hermetic)
 *
 * Requires GEO_PROVIDER=stub in .env.test — the geo server actions then serve
 * deterministic fixtures (no OpenRouteService key, no network), so geocode
 * hits and CALC distances can be asserted exactly. External basemap hosts are
 * route-aborted so the suite stays hermetic whether or not a MapTiler key is
 * configured in the dev server's env.
 *
 * Seeded endpoints (fixtures/seed-chain-data.ts):
 *   facility — Dodoma fixture coords (-6.163, 35.7516)
 *   supplier — Dar-ish coords (-6.8, 39.28)
 *
 * Derivation-priority coverage (override → location → supplier level) lives
 * with the derive-path work in vitest (lib/calculations/transport-leg), not
 * here — this spec covers the picker/CALC UI contract.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  STUB_GEOCODE_FIXTURES,
  stubRouteDistanceKm,
} from "../../src/lib/geo/stub";

const DODOMA = STUB_GEOCODE_FIXTURES[0]; // "Dodoma, Tanzania"
const DAR = STUB_GEOCODE_FIXTURES[1]; // "Dar es Salaam, Tanzania"

const SEED_FACILITY_POINT = { lat: -6.163, lng: 35.7516 };
const SEED_SUPPLIER_POINT = { lat: -6.8, lng: 39.28 };

/** Keep the suite offline: basemap/style/tile hosts are never real deps. */
async function blockExternalMapHosts(page: Page) {
  await page.route("**://api.maptiler.com/**", (route) => route.abort());
  await page.route("**://server.arcgisonline.com/**", (route) => route.abort());
}

test.describe("PositionPicker + CALC (stub geo provider)", () => {
  test.beforeEach(async ({ adminPage }) => {
    await blockExternalMapHosts(adminPage);
  });

  test("address search geocodes via stub and fills coordinates", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/suppliers?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Supplier" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const search = dialog.locator("#gps-address-search");
    await search.fill("Dodoma");

    const option = page.getByRole("option", { name: DODOMA.label });
    await expect(option).toBeVisible();
    await option.click();

    await expect(dialog.locator("#gps-latitude")).toHaveValue(String(DODOMA.lat));
    await expect(dialog.locator("#gps-longitude")).toHaveValue(String(DODOMA.lng));

    // Read-only reverse-geocode confirmation label resolves the same fixture.
    await expect(
      dialog.getByTestId("position-picker-resolved-label")
    ).toContainText(DODOMA.label);
  });

  test("manual coordinate entry propagates and reverse-resolves", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/suppliers?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Supplier" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Within 50 km of the Dar es Salaam fixture → stub reverse resolves it.
    await dialog.locator("#gps-latitude").fill("-6.79");
    await dialog.locator("#gps-longitude").fill("39.21");

    await expect(
      dialog.getByTestId("position-picker-resolved-label")
    ).toContainText(DAR.label);
  });

  test("map preview degrades gracefully without a basemap", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/suppliers?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Supplier" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The MapLibre container (key configured; tiles aborted is fine), the
    // explicit no-key fallback, or the WebGL-unavailable fallback (headless
    // browsers) must render — never a blank hole and never a crash.
    const map = dialog.getByTestId("position-picker-map");
    const noKey = dialog.getByTestId("position-picker-no-map");
    const noWebgl = dialog.getByTestId("position-picker-map-failed");
    await expect(map.or(noKey).or(noWebgl).first()).toBeVisible();
  });

  test("CALC fills the stub road distance and tracks provenance", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/suppliers?facility=${seededData.facility.id}`);

    // Open the seeded supplier (has GPS) in the edit sheet. Clickable
    // data-table rows carry role="button" (not "row") — match by tag + text.
    // Row actions live in the ⋮ overflow menu (RowActionsMenu, Phase 2).
    const row = page.locator("tr", { hasText: seededData.supplier.name });
    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const calcButton = dialog.getByRole("button", {
      name: /Calculate road distance/i,
    });
    await expect(calcButton).toBeEnabled();
    await calcButton.click();

    const expectedKm = stubRouteDistanceKm(
      SEED_SUPPLIER_POINT,
      SEED_FACILITY_POINT
    );
    const distanceInput = dialog.locator("#distanceToFacilityKm");
    await expect(distanceInput).toHaveValue(String(expectedKm));
    await expect(
      dialog.getByTestId("distanceToFacilityKm-distance-source")
    ).toContainText("Map estimate");

    // Hand-editing the CALC'd value flips provenance to manual.
    await distanceInput.fill("123");
    await expect(
      dialog.getByTestId("distanceToFacilityKm-distance-source")
    ).toContainText("Manual");
  });

  test("CALC is disabled with an explanation when an endpoint is missing", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/suppliers?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Supplier" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // New supplier has no coordinates yet → CALC must be disabled.
    const calcButton = dialog.getByRole("button", {
      name: /Calculate road distance/i,
    });
    await expect(calcButton).toBeDisabled();

    // Setting the supplier position enables it (facility endpoint is seeded).
    await dialog.locator("#gps-latitude").fill(String(DAR.lat));
    await dialog.locator("#gps-longitude").fill(String(DAR.lng));
    await expect(calcButton).toBeEnabled();
  });
});
