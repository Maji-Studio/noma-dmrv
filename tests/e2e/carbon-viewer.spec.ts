/**
 * Carbon Viewer E2E (hermetic) — map-integration Phase 2.
 *
 * Covers the chain-of-custody view segment (Lineage / Map / Split), the
 * geography panel's rails (transport legs, not-geolocated), the split-view
 * cross-linking into the DAG, and the nothing-to-plot empty state.
 *
 * Hermetic by construction: every assertion targets React overlays and URL
 * state — never the MapLibre canvas — so the suite passes with or without a
 * MapTiler key, and external basemap hosts are route-aborted regardless.
 * Route-geometry fetches resolve server-side via the stub geo provider
 * (GEO_PROVIDER=stub in .env.test) and are not asserted here.
 */

import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Page } from "@playwright/test";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { test, expect, type SeededChainData } from "./fixtures";

// Seed geography (matches fixtures/seed-chain-data.ts: facility at Dodoma,
// supplier/customer-location at Dar-ish coordinates).
const FACILITY_POINT = { lat: -6.163, lng: 35.7516 };
const DAR_POINT = { lat: -6.8, lng: 39.28 };
const FIELD_POINT = { lat: -6.75, lng: 39.2 };

const INBOUND_DISTANCE_KM = 41.5;
const OUTBOUND_DISTANCE_KM = 12.3;
const TOTAL_DISTANCE_KM = 53.8;

function createDbConnection() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}

function chainUrl(
  facilityId: string,
  params: Record<string, string>
) {
  const search = new URLSearchParams({ facility: facilityId, ...params });
  return `/chain-of-custody?${search.toString()}`;
}

/** Keep the suite offline: basemap/style/tile hosts are never real deps. */
async function blockExternalMapHosts(page: Page) {
  await page.route("**://api.maptiler.com/**", (route) => route.abort());
  await page.route("**://server.arcgisonline.com/**", (route) => route.abort());
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
      if (!withGeo) {
        // Empty-state scenario: strip every coordinate the chain could
        // inherit or plot (the per-test facility is not shared).
        await tx
          .update(schema.facilities)
          .set({ gpsLatitude: null, gpsLongitude: null })
          .where(eq(schema.facilities.id, seededData.facility.id));
        await tx
          .update(schema.feedstocks)
          .set({ gpsLatitude: null, gpsLongitude: null })
          .where(eq(schema.feedstocks.id, seededData.feedstock.id));
      }

      await tx.insert(schema.productionRuns).values({
        id: ids.productionRun,
        code: codes.productionRun,
        facilityId: seededData.facility.id,
        date: "2026-02-10",
        status: "complete",
        startTime: new Date("2026-02-10T07:00:00.000Z"),
        endTime: new Date("2026-02-10T13:00:00.000Z"),
        reactorId: seededData.reactor.id,
        feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
        biocharStorageLocationId: seededData.biocharStorageLocation.id,
        feedstockMassDryKg: 100,
        biocharDryMassKg: 42,
        biocharOutputKg: 43,
      });

      await tx.insert(schema.productionRunFeedstocks).values({
        id: ids.productionRunFeedstock,
        productionRunId: ids.productionRun,
        feedstockId: seededData.feedstock.id,
        massUsedKg: 100,
      });

      await tx
        .update(schema.biocharProducts)
        .set({
          linkedProductionRunId: ids.productionRun,
          storageLocationId: seededData.biocharStorageLocation.id,
          massKg: 250,
        })
        .where(eq(schema.biocharProducts.id, seededData.biocharProduct.id));

      await tx.insert(schema.orders).values({
        id: ids.order,
        code: codes.order,
        facilityId: seededData.facility.id,
        orderDate: new Date("2026-02-12T08:00:00.000Z"),
        customerId: seededData.customer.id,
        customerLocationId: seededData.customerLocation.id,
        biocharProductId: seededData.biocharProduct.id,
        quantityKg: 220,
        packaging: "loose",
      });

      await tx.insert(schema.deliveries).values({
        id: ids.delivery,
        code: codes.delivery,
        facilityId: seededData.facility.id,
        orderId: ids.order,
        biocharProductId: seededData.biocharProduct.id,
        deliveryDate: new Date("2026-02-14T09:00:00.000Z"),
        status: "delivered",
        massDryKg: 215,
        deliveredWetMassKg: 230,
        moistureContentPercent: 6.5,
      });

      await tx.insert(schema.applications).values({
        id: ids.application,
        code: codes.application,
        deliveryId: ids.delivery,
        applicationDate: new Date("2026-02-16T10:30:00.000Z"),
        biocharAppliedTons: 0.21,
        biocharAppliedDryTons: 0.2,
        fieldIdentifier: `Field ${suffix}`,
        status: "applied",
        gpsLatitude: withGeo ? FIELD_POINT.lat : null,
        gpsLongitude: withGeo ? FIELD_POINT.lng : null,
      });

      if (withGeo) {
        await tx.insert(schema.transportLegs).values([
          {
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

test.describe("Carbon Viewer (chain-of-custody geography)", () => {
  test.beforeEach(async ({ adminPage }) => {
    await blockExternalMapHosts(adminPage);
  });

  test("view segment toggles lineage / map / split and persists in the URL", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      chainUrl(seededData.facility.id, { application: lineage.application.id })
    );
    // Default view: lineage DAG, no geography panel.
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("carbon-viewer-panel")).toHaveCount(0);

    const segment = page.getByTestId("chain-view-segment");
    await segment.getByRole("button", { name: "Map" }).click();
    await expect(page).toHaveURL(/view=map/);
    await expect(page.getByTestId("carbon-viewer-panel")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".react-flow__viewport")).toHaveCount(0);

    await segment.getByRole("button", { name: "Split" }).click();
    await expect(page).toHaveURL(/view=split/);
    await expect(page.getByTestId("carbon-viewer-panel")).toBeVisible();
    await expect(page.locator(".react-flow__viewport")).toBeVisible();

    await segment.getByRole("button", { name: "Lineage" }).click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(page.getByTestId("carbon-viewer-panel")).toHaveCount(0);
  });

  test("map view lists transport legs with provenance-backed distances and ungeolocated records", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      chainUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "map",
      })
    );

    const legsRail = page.getByTestId("carbon-viewer-legs-rail");
    await expect(legsRail).toBeVisible({ timeout: 15000 });
    await expect(legsRail).toContainText("Transport legs");
    await expect(legsRail).toContainText(`${TOTAL_DISTANCE_KM} km total`);
    await expect(legsRail).toContainText(`${INBOUND_DISTANCE_KM} km`);
    await expect(legsRail).toContainText(`${OUTBOUND_DISTANCE_KM} km`);
    await expect(legsRail).toContainText("feedstock inbound");
    await expect(legsRail).toContainText("biochar outbound");

    await expect(page.getByTestId("carbon-viewer-legend")).toContainText(
      "Facility · pyrolysis hub"
    );

    // Basemap or its graceful no-key fallback — hermetic either way.
    await expect(
      page
        .getByTestId("carbon-viewer-map")
        .or(page.getByTestId("carbon-viewer-no-map"))
        .first()
    ).toBeVisible();
  });

  test("split view cross-links chip selection into the DAG highlight", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      chainUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "split",
      })
    );
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });

    const chips = page.getByTestId("carbon-viewer-ungeo-chips");
    await expect(chips).toBeVisible({ timeout: 15000 });
    await chips.getByRole("button", { name: lineage.delivery.code }).click();

    const deliveryCard = page
      .locator(`[data-testid="rf__node-delivery:${lineage.delivery.id}"]`)
      .locator('[data-highlighted="true"]');
    await expect(deliveryCard).toBeVisible();
  });

  test("split view cards locate on the map instead of navigating", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData);

    await page.goto(
      chainUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "split",
      })
    );
    await expect(page.locator(".react-flow__viewport")).toBeVisible({ timeout: 15000 });

    const applicationNode = page.locator(
      `[data-testid="rf__node-application:${lineage.application.id}"]`
    );
    await applicationNode.click();

    // No navigation — the card highlights itself (and the map marker).
    await expect(page).toHaveURL(/chain-of-custody/);
    await expect(page).toHaveURL(/view=split/);
    await expect(
      applicationNode.locator('[data-highlighted="true"]')
    ).toBeVisible();
  });

  test("shows the nothing-to-plot empty state when no record carries GPS", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedGeoLineage(seededData, { withGeo: false });

    await page.goto(
      chainUrl(seededData.facility.id, {
        application: lineage.application.id,
        view: "map",
      })
    );

    const empty = page.getByTestId("carbon-viewer-empty");
    await expect(empty).toBeVisible({ timeout: 15000 });
    await expect(empty).toContainText("Nothing to plot.");
    await expect(page.getByTestId("carbon-viewer-legs-rail")).toHaveCount(0);
  });
});
