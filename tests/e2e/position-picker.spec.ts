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
 * open the centered PositionPicker dialog (idPrefix `pending-loc-gps`) and the
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
 * Open the supplier create sheet, then its nested location dialog.
 */
async function openNewSupplierLocationEditor(page: Page, facilityId: string) {
  await page.goto(`/suppliers?facility=${facilityId}`);
  await page.getByRole("button", { name: "New Supplier" }).click();

  const supplierSheet = page.getByRole("dialog", { name: "Create Supplier" });
  await expect(supplierSheet).toBeVisible();
  await supplierSheet.getByRole("button", { name: "Add Location" }).click();

  const locationDialog = page.getByRole("dialog", { name: "Add Location" });
  await expect(locationDialog).toBeVisible();
  return locationDialog;
}

async function openNewCustomerLocationEditor(page: Page, facilityId: string) {
  await page.goto(`/customers?facility=${facilityId}`);
  await page.getByRole("button", { name: "New Customer" }).click();

  const customerSheet = page.getByRole("dialog", { name: "Create Customer" });
  await expect(customerSheet).toBeVisible();
  await customerSheet.getByRole("button", { name: "Add Location" }).click();

  const locationDialog = page.getByRole("dialog", { name: "Add Location" });
  await expect(locationDialog).toBeVisible();
  return locationDialog;
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

  test("customer create sheet uses the complete customer location field set", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewCustomerLocationEditor(
      page,
      seededData.facility.id
    );

    await expect(dialog.getByLabel("Location name")).toBeVisible();
    await expect(dialog.getByLabel("Country")).toBeVisible();
    await expect(dialog.getByLabel("State / region")).toBeVisible();
    await expect(dialog.getByLabel("City")).toBeVisible();
    await expect(dialog.getByLabel("Site description")).toBeVisible();
    await expect(dialog.getByText("Application site position")).toBeVisible();
    await expect(
      dialog.getByPlaceholder(/Address search|Search address or place/i)
    ).toBeVisible();
    const latitudeInput = dialog.getByLabel("GPS latitude");
    const longitudeInput = dialog.getByLabel("GPS longitude");
    await expect(latitudeInput).toBeEditable();
    await expect(longitudeInput).toBeEditable();
    await latitudeInput.fill(String(DAR.lat));
    await expect(latitudeInput).toHaveValue(String(DAR.lat));
    await longitudeInput.fill(String(DAR.lng));
    await expect(latitudeInput).toHaveValue(String(DAR.lat));
    await expect(longitudeInput).toHaveValue(String(DAR.lng));
    const search = dialog.locator("#pending-loc-gps-address-search");
    await search.fill("Dodoma");
    await page.getByRole("option", { name: DODOMA.label }).click();
    await expect(latitudeInput).not.toHaveValue(String(DAR.lat));
    await expect(longitudeInput).not.toHaveValue(String(DAR.lng));
    await expect(
      dialog.getByLabel("Default soil temperature (°C)")
    ).toBeVisible();
    const distanceInput = dialog.getByRole("spinbutton", {
      name: "One-way distance from facility (per leg, km)",
    });
    const calcButton = dialog.getByRole("button", {
      name: /Calculate road distance selected facility to application site position/i,
    });
    await expect(distanceInput).toBeVisible();
    await expect(calcButton).toBeEnabled();
    await calcButton.click();
    // Address search moved the site onto the Dodoma fixture, which is also the
    // seeded facility position, so the stub route distance is 0.
    const expectedKm = stubRouteDistanceKm(SEED_FACILITY_POINT, DODOMA);
    await expect(distanceInput, STUB_PROVIDER_HINT).toHaveValue(
      String(expectedKm)
    );
    await expect(
      dialog.getByTestId("pending-loc-distance-distance-source")
    ).toContainText("Route calculation");
    await distanceInput.fill("123");
    await expect(distanceInput).toHaveValue("123");
    await expect(
      dialog.getByTestId("pending-loc-distance-distance-source")
    ).toContainText("Manual");
    await expect(dialog.getByLabel("Set as default destination")).toBeVisible();
    await expect(page.getByText("Application error")).toBeHidden();
  });

  test("customer create sheet adds a pending location through a dialog", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewCustomerLocationEditor(
      page,
      seededData.facility.id
    );

    await dialog.getByLabel("Location name").fill("E2E Customer Site");
    await dialog.getByLabel("Country").fill("Tanzania");
    // Site description deliberately left blank: it is optional, and a location
    // saved with only a name, country, and GPS position must be accepted.
    await dialog.getByLabel("GPS latitude").fill(String(DAR.lat));
    await dialog.getByLabel("GPS longitude").fill(String(DAR.lng));
    await dialog.getByRole("button", { name: "Add Location" }).click();

    await expect(dialog).not.toBeVisible();
    const customerSheet = page.getByRole("dialog", { name: "Create Customer" });
    await expect(customerSheet).toBeVisible();
    await expect(customerSheet.getByText("E2E Customer Site")).toBeVisible();
  });

  test("supplier create sheet adds a pending location through a dialog", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = await openNewSupplierLocationEditor(
      page,
      seededData.facility.id
    );

    await dialog.getByLabel("Location name").fill("E2E Supplier Site");
    await dialog.getByLabel("Country").fill("Tanzania");
    await dialog
      .getByLabel("Address / description")
      .fill("E2E feedstock source");
    await dialog.getByLabel("GPS latitude").fill(String(DAR.lat));
    await dialog.getByLabel("GPS longitude").fill(String(DAR.lng));
    await dialog.getByRole("button", { name: "Add Location" }).click();

    await expect(dialog).not.toBeVisible();
    const supplierSheet = page.getByRole("dialog", {
      name: "Create Supplier",
    });
    await expect(supplierSheet).toBeVisible();
    await expect(supplierSheet.getByText("E2E Supplier Site")).toBeVisible();
  });

  test("party detail pages open location dialogs", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/customers/${seededData.customer.id}`);
    await page.getByRole("button", { name: "Add Location" }).click();

    const customerAddDialog = page.getByRole("dialog", {
      name: "Add Location",
    });
    await expect(customerAddDialog).toBeVisible();
    await customerAddDialog.getByRole("button", { name: "Close" }).click();
    await expect(customerAddDialog).not.toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const customerEditDialog = page.getByRole("dialog", {
      name: "Edit Location",
    });
    await expect(customerEditDialog).toBeVisible();
    await customerEditDialog.getByRole("button", { name: "Close" }).click();

    await page.goto(`/suppliers/${seededData.supplier.id}`);
    await page.getByRole("button", { name: "Add Location" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add Location" }),
    ).toBeVisible();
  });
});
