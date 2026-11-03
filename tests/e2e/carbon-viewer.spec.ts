import { setProductSourceFixture } from "./helpers/product-source-fixture";
import { insertEstablishedOutputApplicationFixture as insertOutputApplicationFixture } from "../helpers/output-contract-fixtures";
import { outputOrderFixtureValues, insertEstablishedOutputDeliveryFixture as insertOutputDeliveryFixture } from "../helpers/output-contract-fixtures";
/**
 * Carbon Viewer E2E (hermetic): the application-anchored Map and Split.
 *
 * Covers the traceability view segment (Flow / Map / Split), the application
 * Map opening on its own chain walk, marker picks moving the walk, the Split
 * cross-link between the Flow chart and the walk, and a chain whose records
 * lack GPS.
 *
 * The renderer regressions additionally inspect painted MapLibre features,
 * camera bounds and projected markers. A local blank basemap and SwiftShader
 * keep them independent of external tiles and GPU availability.
 */

import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Locator, Page } from "@playwright/test";
import { SWIFTSHADER_ARGS } from "./fixtures/swiftshader";
import { Pool } from "pg";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect, type SeededChainData } from "./fixtures";
import { clickRowMenuItem, waitForFacilityHydration, waitForSideSheetClose } from "./fixtures/page-helpers";
import { routeGeometriesRequestSchema, type RouteGeometriesRequest } from "@/schemas/geo";

// Seed geography (matches fixtures/seed-chain-data.ts: facility at Dodoma,
// supplier/customer-location at Dar-ish coordinates).
const FACILITY_POINT = { lat: -6.163, lng: 35.7516 };
const DAR_POINT = { lat: -6.8, lng: 39.28 };
const FIELD_POINT = { lat: -6.75, lng: 39.2 };
const EDITED_FIELD_POINT = { lat: -3.4, lng: 36.7 };
const EDITED_CUSTOMER_POINT = { lat: -8.5, lng: 37.5 };
const MAP_READY_TIMEOUT_MS = 45_000;
const COORDINATE_TOLERANCE_DEGREES = 0.001;
const MAX_BACK_STEPS = 6;

test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

// Inbound (feedstock) leg distance, seeded directly on its transport_legs row
// and shown verbatim as the feedstock step's one-way distance.
const INBOUND_DISTANCE_KM = 41.5;
// Outbound (biochar) leg distance carried on the seeded transport_legs row. The
// map does NOT read this for biochar: it derives the outbound leg from the
// delivery (distance = the customer location's facilityDistances). Kept for
// the seeded row's own provenance.
const OUTBOUND_DISTANCE_KM = 12.3;
// One step per stage: feedstock, run, product, order, delivery, application.
const CHAIN_STEPS = 6;

function createDbConnection() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}

function traceabilityUrl(
  facilityId: string,
  params: Record<string, string>
) {
  const search = new URLSearchParams({ facility: facilityId, ...params });
  return `/traceability?${search.toString()}`;
}

/** Keep the suite offline: basemap/style/tile hosts are never real deps. */
async function blockExternalMapHosts(page: Page) {
  // A configured key must not make load depend on an aborted style request.
  await page.route("**://api.maptiler.com/**", (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
  await page.route("**://server.arcgisonline.com/**", (route) => route.abort());
}

function observeRouteRequests(page: Page): RouteGeometriesRequest[] {
  const requests: RouteGeometriesRequest[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.headers()["next-action"]) return;
    try {
      const args: unknown = request.postDataJSON();
      const parsed = routeGeometriesRequestSchema.safeParse(Array.isArray(args) ? args[0] : null);
      if (parsed.success) requests.push(parsed.data);
    } catch { /* Unrelated multipart server actions. */ }
  });
  return requests;
}

/** The application map's walk panel: one chain, "Chain to <field>". */
const walkPanel = (page: Page) => page.getByRole("complementary", { name: /^Chain to / });
const counter = (step: number) => new RegExp(`0${step} / 0${CHAIN_STEPS} · To `);

/** Whether the painted map's bounds hold every point. */
async function boundsCover(map: Locator, points: Array<{ lat: number; lng: number }>) {
  const value = await map.getAttribute("data-map-bounds");
  if (!value) return false;
  const [[west, south], [east, north]] = JSON.parse(value) as number[][];
  return points.every(({ lat, lng }) => lng >= west && lng <= east && lat >= south && lat <= north);
}

async function expectRenderedGeography(page: Page, applicationId: string, field: typeof FIELD_POINT, destination: typeof DAR_POINT) {
  const map = page.getByTestId("carbon-viewer-map");
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: MAP_READY_TIMEOUT_MS });
  // The walk opens on the supplier's step: the camera frames its inbound leg,
  // from the supplier's origin to the facility.
  await expect(walkPanel(page)).toContainText(counter(1));
  await expect.poll(() => boundsCover(map, [DAR_POINT, FACILITY_POINT])).toBe(true);
  // The application's own step frames the facility, the field and the
  // delivery's destination together.
  await walkPanel(page).getByRole("button", { name: /^Application/ }).click();
  await expect(walkPanel(page)).toContainText(counter(CHAIN_STEPS));
  const marker = map.locator(`[data-node-id="application:${applicationId}"]`);
  await expect(marker).toHaveAttribute("data-position", JSON.stringify([field.lng, field.lat]));
  // MapLibre projects these elements. Visibility alone would pass for a marker
  // translated beyond the map's clipped viewport, so compare their centers.
  await expect.poll(() => map.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const markers = [...element.querySelectorAll('[data-testid="carbon-viewer-marker"]')];
    return markers.length > 0 && markers.every((marker) => {
      const rect = marker.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
  })).toBe(true);
  await expect.poll(() => boundsCover(map, [FACILITY_POINT, field, destination])).toBe(true);
  await expect.poll(async () => {
    const value = await map.getAttribute("data-rendered-legs");
    if (!value) return false;
    const legs = JSON.parse(value) as { id: string; geometry: { coordinates: number[][] } }[];
    return legs.some((leg) => {
      const endpoint = leg.geometry.coordinates.at(-1);
      return leg.id.endsWith(`application:${applicationId}`) && endpoint !== undefined &&
        Math.abs(endpoint[0] - destination.lng) < COORDINATE_TOLERANCE_DEGREES &&
        Math.abs(endpoint[1] - destination.lat) < COORDINATE_TOLERANCE_DEGREES;
    });
  }).toBe(true);
}

/** Browser history uses the existing Next router and retains the QueryClient. */
async function returnToCachedMap(page: Page, mapUrl: string) {
  for (let step = 0; step < MAX_BACK_STEPS && page.url() !== mapUrl; step++) await page.goBack();
  await expect(page).toHaveURL(mapUrl);
  await expect(page.locator("html")).toHaveAttribute("data-cached-map", mapUrl);
}

/**
 * Full application lineage plus the Phase 2 geo substrate: an application
 * with field GPS and derived inbound/outbound transport legs carrying
 * endpoint coordinates, distances, and provenance.
 */
async function seedGeoLineage(
  seededData: SeededChainData,
  options: { withGeo?: boolean } = {}
) {
  const withGeo = options.withGeo ?? true;
  const { db, pool } = createDbConnection();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();

  const ids = {
    productionRun: crypto.randomUUID(),
    productionRunFeedstock: crypto.randomUUID(),
    order: crypto.randomUUID(),
    delivery: crypto.randomUUID(),
    application: crypto.randomUUID(),
    inboundLeg: crypto.randomUUID(),
    outboundLeg: crypto.randomUUID(),
  };

  const codes = {
    productionRun: `E2E-PR-${suffix}`,
    order: `E2E-OR-${suffix}`,
    delivery: `E2E-DL-${suffix}`,
    application: `E2E-AP-${suffix}`,
  };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.productionRuns).values({
        organizationId: DEC_ORG_ID,
        id: ids.productionRun,
        code: codes.productionRun,
        facilityId: seededData.facility.id,
        status: "complete",
        startTime: new Date("2026-02-10T07:00:00.000Z"),
        endTime: new Date("2026-02-10T13:00:00.000Z"),
        reactorId: seededData.reactor.id,
        biocharStorageLocationId: seededData.biocharStorageLocation.id,
        feedstockMassDryKg: 1000,
        biocharDryMassKg: 250,
        biocharOutputKg: 250,
        biocharMoisturePercent: 0,
      });

      await tx.update(schema.feedstocks).set({ massWetKg: 1000, massDryKg: 1000, moistureContentPercent: 0 })
        .where(eq(schema.feedstocks.id, seededData.feedstock.id));
      await tx.insert(schema.productionRunFeedstocks).values({
        organizationId: DEC_ORG_ID,
        id: ids.productionRunFeedstock,
        productionRunId: ids.productionRun,
        feedstockId: seededData.feedstock.id,
        wetMassUsedKg: 1000,
      });

      await setProductSourceFixture(tx, seededData.biocharProduct.id, ids.productionRun, 250, 250, "2026-02-10");

      await tx.insert(schema.orders).values(await outputOrderFixtureValues(tx, {
        organizationId: DEC_ORG_ID,
        id: ids.order,
        code: codes.order,
        facilityId: seededData.facility.id,
        orderDate: new Date("2026-02-12T08:00:00.000Z"),
        customerId: seededData.customer.id,
        customerLocationId: seededData.customerLocation.id,
        biocharProductId: seededData.biocharProduct.id,
        quantityKg: 250,
        packaging: "loose",
      }));

      await insertOutputDeliveryFixture(tx, {
        organizationId: DEC_ORG_ID,
        id: ids.delivery,
        code: codes.delivery,
        facilityId: seededData.facility.id,
        orderId: ids.order,
        biocharProductId: seededData.biocharProduct.id,
        deliveryDate: new Date("2026-02-14T09:00:00.000Z"),
        status: "delivered",
        massDryKg: 215,
        deliveredWetMassKg: 215,
        moistureContentPercent: 0,
      }, row => row);

      await insertOutputApplicationFixture(tx, {
        fieldSizeHa: 1,
        organizationId: DEC_ORG_ID,
        id: ids.application,
        code: codes.application,
        deliveryId: ids.delivery,
        applicationDate: new Date("2026-02-16T10:30:00.000Z"),
        biocharAppliedTons: 0.2,
        biocharAppliedDryTons: 0.2,
        fieldIdentifier: `Field ${suffix}`,
        status: "applied",
        gpsLatitude: withGeo ? FIELD_POINT.lat : null,
        gpsLongitude: withGeo ? FIELD_POINT.lng : null,
      }, row => row);

      if (withGeo) {
        await tx.insert(schema.transportLegs).values([
          {
            organizationId: DEC_ORG_ID,
            id: ids.inboundLeg,
            entityType: "feedstock",
            entityId: seededData.feedstock.id,
            originName: `E2E Supplier Origin ${suffix}`,
            originGpsLatitude: DAR_POINT.lat,
            originGpsLongitude: DAR_POINT.lng,
            destinationName: `E2E Facility ${suffix}`,
            destinationGpsLatitude: FACILITY_POINT.lat,
            destinationGpsLongitude: FACILITY_POINT.lng,
            distanceKm: INBOUND_DISTANCE_KM,
            distanceSource: "map_estimate",
            transportMethodType: "road",
            loadMassKg: 100,
            isDerived: true,
          },
          {
            organizationId: DEC_ORG_ID,
            id: ids.outboundLeg,
            entityType: "biochar",
            entityId: seededData.biocharProduct.id,
            originName: `E2E Facility ${suffix}`,
            originGpsLatitude: FACILITY_POINT.lat,
            originGpsLongitude: FACILITY_POINT.lng,
            destinationName: `E2E Customer Site ${suffix}`,
            destinationGpsLatitude: DAR_POINT.lat,
            destinationGpsLongitude: DAR_POINT.lng,
            distanceKm: OUTBOUND_DISTANCE_KM,
            distanceSource: "manual",
            transportMethodType: "road",
            loadMassKg: 215,
            isDerived: true,
          },
        ]);
      }
    });

    return {
      application: { id: ids.application, code: codes.application },
      delivery: { id: ids.delivery, code: codes.delivery },
      order: { id: ids.order, code: codes.order },
      productionRun: { id: ids.productionRun, code: codes.productionRun },
    };
  } finally {
    await pool.end();
  }
}

test.describe("Carbon Viewer (traceability geography)", () => {
  test.beforeEach(async ({ adminPage }) => {
    await blockExternalMapHosts(adminPage);
    await adminPage.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.dataset.observeCarbonMap = "true";
      }, { once: true });
    });
  });

  test("opening the map fits projected markers and paints the route without FIT", async ({ adminPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);
    await page.goto(traceabilityUrl(seededData.facility.id, { application: lineage.application.id, view: "map" }));
    await expectRenderedGeography(page, lineage.application.id, FIELD_POINT, DAR_POINT);
  });

  test("editing application GPS refreshes a cached rendered map without a reload or expiry", async ({ adminPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    // Freeze Date, not timers: editing/compilation cannot silently expire the
    // 30-second query and hide a missing invalidation.
    await page.clock.setFixedTime(new Date());
    const lineage = await seedGeoLineage(seededData);
    await page.goto(traceabilityUrl(seededData.facility.id, { application: lineage.application.id, view: "map" }));
    await expectRenderedGeography(page, lineage.application.id, FIELD_POINT, DAR_POINT);
    const mapUrl = page.url();
    await page.locator("html").evaluate((element, url) => element.setAttribute("data-cached-map", url), mapUrl);
    await page.locator("nav").getByRole("link", { name: "Applications", exact: true }).click();
    await expect(page).toHaveURL(/\/applications/);
    await waitForFacilityHydration(page, seededData.facility.name);
    await page.getByRole("textbox", { name: "Search applications" }).fill(lineage.application.code);
    await page.getByRole("row").filter({ hasText: lineage.application.code }).click();
    await page.getByRole("button", { name: "Edit application", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "Set manually", exact: true }).check();
    await sheet.getByLabel("GPS latitude", { exact: false }).fill(String(EDITED_FIELD_POINT.lat));
    await sheet.getByLabel("GPS longitude", { exact: false }).fill(String(EDITED_FIELD_POINT.lng));
    await sheet.getByRole("button", { name: "Update application", exact: true }).click();
    await waitForSideSheetClose(page);
    await returnToCachedMap(page, mapUrl);
    // Delivery routing retains customer-site priority; the field pin moves.
    await expectRenderedGeography(page, lineage.application.id, EDITED_FIELD_POINT, DAR_POINT);
  });

  test("editing customer GPS requests and paints a new route on the cached map", async ({ adminPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    await page.clock.setFixedTime(new Date());
    const requests = observeRouteRequests(page);
    const lineage = await seedGeoLineage(seededData);
    await page.goto(traceabilityUrl(seededData.facility.id, { application: lineage.application.id, view: "map" }));
    await expectRenderedGeography(page, lineage.application.id, FIELD_POINT, DAR_POINT);
    const mapUrl = page.url();
    await page.locator("html").evaluate((element, url) => element.setAttribute("data-cached-map", url), mapUrl);
    await page.locator("nav").getByRole("link", { name: "Customers", exact: true }).click();
    await expect(page).toHaveURL(/\/customers/);
    await waitForFacilityHydration(page, seededData.facility.name);
    await page.getByRole("textbox", { name: "Search customers" }).fill(seededData.customer.code);
    await clickRowMenuItem(page, page.getByRole("button", { name: `Actions for ${seededData.customer.code}` }), "Edit");
    await page.getByRole("button", { name: `Edit ${seededData.customerLocation.name}`, exact: true }).click();
    const dialog = page.getByTestId("customer-location-edit-dialog");
    await dialog.getByLabel("GPS latitude", { exact: false }).fill(String(EDITED_CUSTOMER_POINT.lat));
    await dialog.getByLabel("GPS longitude", { exact: false }).fill(String(EDITED_CUSTOMER_POINT.lng));
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).toBeHidden();
    await returnToCachedMap(page, mapUrl);
    await expect.poll(() => requests.some((request) => request.legs.some((leg) =>
      leg.id.endsWith(`application:${lineage.application.id}`) &&
      leg.destination.lat === EDITED_CUSTOMER_POINT.lat && leg.destination.lng === EDITED_CUSTOMER_POINT.lng,
    ))).toBe(true);
    await expectRenderedGeography(page, lineage.application.id, FIELD_POINT, EDITED_CUSTOMER_POINT);
  });

  test("view segment toggles flow / map / split and persists in the URL", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      traceabilityUrl(seededData.facility.id, { application: lineage.application.id })
    );
    // Default view: Flow chart, no map.
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });
    await expect(walkPanel(page)).toHaveCount(0);

    const segment = page.getByTestId("chain-view-segment");
    await segment.getByRole("button", { name: "Map" }).click();
    await expect(page).toHaveURL(/view=map/);
    await expect(walkPanel(page)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".react-flow__viewport")).toHaveCount(0);

    await segment.getByRole("button", { name: "Split" }).click();
    await expect(page).toHaveURL(/view=split/);
    await expect(walkPanel(page)).toBeVisible();
    await expect(page.locator(".react-flow__viewport")).toBeVisible();

    await segment.getByRole("button", { name: "Flow" }).click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(walkPanel(page)).toHaveCount(0);
  });

  test("map view opens on the application's own chain walk", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      traceabilityUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "map",
      })
    );

    const walk = walkPanel(page);
    await expect(walk).toContainText(counter(1), { timeout: 15000 });
    // One chain: no stage list to return to, no drill into the application.
    await expect(walk.getByRole("button", { name: /Whole batch/ })).toHaveCount(0);
    // The supplier's step carries the inbound leg's stored distance.
    await expect(walk).toContainText(seededData.feedstock.code);
    await expect(walk).toContainText(`${INBOUND_DISTANCE_KM} km`);

    for (let step = 2; step <= CHAIN_STEPS; step++) {
      await walk.getByRole("button", { name: /^Next/ }).click();
      await expect(walk).toContainText(counter(step));
    }
    await expect(walk.getByRole("button", { name: /^Next/ })).toHaveCount(0);
    await expect(walk.getByRole("button", { name: /Trace rollback/ })).toHaveCount(0);
    await expect(walk.getByRole("link", { name: /View full record/ })).toBeVisible();
  });

  test("a marker click moves the walk to that record's step", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      traceabilityUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "map",
      })
    );
    const map = page.getByTestId("carbon-viewer-map");
    await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: MAP_READY_TIMEOUT_MS });
    await expect(walkPanel(page)).toContainText(counter(1));

    // Dispatched: at this zoom the field sits beside the supplier, whose label may cover it.
    await map.locator(`[data-node-id="application:${lineage.application.id}"]`).dispatchEvent("click");
    await expect(walkPanel(page)).toContainText(counter(CHAIN_STEPS));
  });

  test("split view: a Flow pick moves the walk and the walk lights its step in Flow", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      traceabilityUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "split",
      })
    );
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });
    const walk = walkPanel(page);
    await expect(walk).toContainText(counter(1), { timeout: 15000 });

    const nodeShell = (testId: string) =>
      page.locator(`[data-testid="${testId}"]`).locator("[aria-label]").first();
    const deliveryNode = `rf__node-delivery:${lineage.delivery.id}`;
    const applicationNode = `rf__node-application:${lineage.application.id}`;

    // A Flow click moves the walk instead of navigating.
    await page.locator(`[data-testid="${deliveryNode}"]`).click();
    await expect(page).toHaveURL(/view=split/);
    await expect(walk).toContainText(counter(5));
    await expect(walk).toContainText(lineage.delivery.code);

    // The walk's step is lit in Flow; the rest dims (off the pointer, which
    // would light its own hover lineage).
    await page.mouse.move(0, 0);
    await expect(nodeShell(deliveryNode)).toHaveCSS("opacity", "1");
    await expect(nodeShell(applicationNode)).not.toHaveCSS("opacity", "1");
    await walk.getByRole("button", { name: /^Next/ }).click();
    await expect(walk).toContainText(counter(CHAIN_STEPS));
    await expect(nodeShell(applicationNode)).toHaveCSS("opacity", "1");
    await expect(nodeShell(deliveryNode)).not.toHaveCSS("opacity", "1");
  });

  test("keeps the facility on the map when operational records lack GPS", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData, { withGeo: false });

    await page.goto(
      traceabilityUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "map",
      })
    );

    await expect(walkPanel(page)).toContainText(counter(1), { timeout: 15000 });
    await expect(page.getByTestId("carbon-viewer-map")).toBeVisible();
    await expect(page.getByText("Nothing to place on the map yet")).toHaveCount(0);
  });
});
