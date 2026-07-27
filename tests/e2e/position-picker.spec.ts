/**
 * PositionPicker + DistanceCalcField E2E (hermetic)
 *
 * Requires GEO_PROVIDER=stub — the geo server actions then serve deterministic
 * fixtures (no OpenRouteService key, no network), so geocode hits and CALC
 * distances can be asserted exactly. External basemap hosts are route-aborted
 * so the suite stays hermetic whether or not a MapTiler key is configured in
 * the dev server's env.
 *
 * GEO_PROVIDER is an APP-SERVER var (read by src/config/env.ts in the Next
 * process), not a Playwright-side one — same class as DISABLE_RATE_LIMIT. It
 * only reaches the server via .env.test when Playwright spawns the webServer
 * itself. With a hand-started dev server (reuseExistingServer picks it up),
 * export it explicitly or the fixture-exact assertions below fail:
 *   DISABLE_RATE_LIMIT=true GEO_PROVIDER=stub pnpm dev
 *
 * The supplier create sheet drives the picker through its per-location editor
 * (suppliers carry many source locations, mirroring customers — there is no
 * single supplier-level position). Open "New Supplier" → "Add Location" to
 * reveal the inline PositionPicker (idPrefix `pending-loc-gps`) and the
 * DistanceCalcField (`pending-loc-distance`).
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
/** Surfaced on the fixture-exact assertions — the usual cause of a mismatch. */
const STUB_PROVIDER_HINT =
  "expected the stub geo fixture — a real-world value here means the app server is not running with GEO_PROVIDER=stub";
const OUT_OF_RANGE_LATITUDE = "91";
const OUT_OF_RANGE_LONGITUDE = "181";

/** Keep the suite offline: basemap/style/tile hosts are never real deps. */
async function blockExternalMapHosts(page: Page) {
  await page.route("**://api.maptiler.com/**", (route) => route.abort());
  await page.route("**://server.arcgisonline.com/**", (route) => route.abort());
}

/**
 * Open the supplier create sheet and reveal the inline location editor that
 * hosts the PositionPicker + DistanceCalcField.
 */
async function openNewSupplierLocationEditor(page: Page, facilityId: string) {
  await page.goto(`/suppliers?facility=${facilityId}`);
  await page.getByRole("button", { name: "New Supplier" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Only the section toggle exists yet; clicking it mounts the inline editor.
  await dialog.getByRole("button", { name: "Add Location" }).click();

  return dialog;
}

test.describe("PositionPicker + CALC (stub geo provider)", () => {
  test.beforeEach(async ({ adminPage }) => {
    await blockExternalMapHosts(adminPage);
  });

  test("address search geocodes via stub and fills coordinates", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

    const search = dialog.locator("#pending-loc-gps-address-search");
    await search.fill("Dodoma");

    const option = page.getByRole("option", { name: DODOMA.label });
    await expect(option).toBeVisible();
    await option.click();

    await expect(
      dialog.locator("#pending-loc-gps-latitude"),
      STUB_PROVIDER_HINT
    ).toHaveValue(String(DODOMA.lat));
    await expect(
      dialog.locator("#pending-loc-gps-longitude"),
      STUB_PROVIDER_HINT
    ).toHaveValue(String(DODOMA.lng));

    // Read-only reverse-geocode confirmation label resolves the same fixture.
    await expect(
      dialog.getByTestId("position-picker-resolved-label")
    ).toContainText(DODOMA.label);
  });

  test("manual coordinate entry propagates and reverse-resolves", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

    // Within 50 km of the Dar es Salaam fixture → stub reverse resolves it.
    await dialog.locator("#pending-loc-gps-latitude").fill("-6.79");
    await dialog.locator("#pending-loc-gps-longitude").fill("39.21");

    await expect(
      dialog.getByTestId("position-picker-resolved-label")
    ).toContainText(DAR.label);
  });

  test("manual coordinate entry rejects invalid map bounds without crashing", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

    await dialog.locator("#pending-loc-gps-latitude").fill(OUT_OF_RANGE_LATITUDE);
    await dialog
      .locator("#pending-loc-gps-longitude")
      .fill(OUT_OF_RANGE_LONGITUDE);

    await expect(dialog).toBeVisible();
    await expect(page.getByText("Application error")).toBeHidden();
  });

  test("map preview degrades gracefully without a basemap", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

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
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

    // Set the source-location position; the facility endpoint is seeded and
    // active via the ?facility= query, so CALC has both endpoints.
    await dialog
      .locator("#pending-loc-gps-latitude")
      .fill(String(SEED_SUPPLIER_POINT.lat));
    await dialog
      .locator("#pending-loc-gps-longitude")
      .fill(String(SEED_SUPPLIER_POINT.lng));

    const calcButton = dialog.getByRole("button", {
      name: /Calculate road distance/i,
    });
    await expect(calcButton).toBeEnabled();
    await calcButton.click();

    const expectedKm = stubRouteDistanceKm(
      SEED_SUPPLIER_POINT,
      SEED_FACILITY_POINT
    );
    const distanceInput = dialog.locator("#pending-loc-distance");
    await expect(distanceInput, STUB_PROVIDER_HINT).toHaveValue(
      String(expectedKm)
    );
    await expect(
      dialog.getByTestId("pending-loc-distance-distance-source")
    ).toContainText("Route calculation");

    // Hand-editing the CALC'd value flips provenance to manual.
    await distanceInput.fill("123");
    await expect(
      dialog.getByTestId("pending-loc-distance-distance-source")
    ).toContainText("Manual");
  });

  test("CALC is disabled with an explanation when an endpoint is missing", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

    // New location has no coordinates yet → CALC must be disabled.
    const calcButton = dialog.getByRole("button", {
      name: /Calculate road distance/i,
    });
    await expect(calcButton).toBeDisabled();

    // Setting the location position enables it (facility endpoint is seeded).
    await dialog.locator("#pending-loc-gps-latitude").fill(String(DAR.lat));
    await dialog.locator("#pending-loc-gps-longitude").fill(String(DAR.lng));
    await expect(calcButton).toBeEnabled();
  });
});
