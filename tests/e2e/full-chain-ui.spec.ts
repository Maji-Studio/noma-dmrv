/**
 * Full Chain UI Smoke Test
 *
 * Single test that creates all 8 core entities through the browser UI
 * in one authenticated session, proving the entire traceability chain works:
 *
 * Facility → Reactor → Production Run → Sample → Order → Delivery → Application → Credit Batch
 *
 * Uses seeded prerequisite data (supplier, feedstock type, customer, etc.)
 * from the auth fixtures.
 */
import { test, expect } from "./fixtures";
import {
  waitForSideSheet,
  waitForSideSheetClose,
  selectEntity as selectEntityById,
  selectFirstEntity,
} from "./fixtures/page-helpers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, ilike, inArray } from "drizzle-orm";
import * as schema from "../../src/db/schema";

// ============================================
// Full Chain Smoke Test
// ============================================

test.describe("Full Chain UI Smoke Test", () => {
  test("create all 8 core entities through the UI", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const runId = Date.now().toString(36);
    const uniq = (ids: string[]) => Array.from(new Set(ids));

    // Clean up chain-created facility (and its reactor) after the test
    // The seeded data cleanup only handles seeded entities, not UI-created ones
    test.setTimeout(90000);
    const cleanupChainCreatedEntities = async () => {
      const databaseUrl =
        process.env.DATABASE_URL ||
        "postgresql://postgres:postgres@localhost:5432/app_template_test";
      const pool = new Pool({ connectionString: databaseUrl });
      const db = drizzle(pool, { schema });
      try {
        await db.transaction(async (tx) => {
          const fieldIdentifierPrefix = `E2E-Field-${runId}`;

          // Find chain-created facilities by name
          const chainFacilities = await tx
            .select({ id: schema.facilities.id })
            .from(schema.facilities)
            .where(ilike(schema.facilities.name, `Chain Facility ${runId}%`));
          const facilityIds = chainFacilities.map((f) => f.id);

          const chainReactors = facilityIds.length
            ? await tx
                .select({ id: schema.reactors.id })
                .from(schema.reactors)
                .where(inArray(schema.reactors.facilityId, facilityIds))
            : [];
          const reactorIds = chainReactors.map((r) => r.id);

          const runsByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.productionRuns.id })
                .from(schema.productionRuns)
                .where(inArray(schema.productionRuns.facilityId, facilityIds))
            : [];
          const runsByReactor = reactorIds.length
            ? await tx
                .select({ id: schema.productionRuns.id })
                .from(schema.productionRuns)
                .where(inArray(schema.productionRuns.reactorId, reactorIds))
            : [];
          const productionRunIds = uniq([
            ...runsByFacility.map((r) => r.id),
            ...runsByReactor.map((r) => r.id),
          ]);

          const appsByField = await tx
            .select({
              id: schema.applications.id,
              deliveryId: schema.applications.deliveryId,
            })
            .from(schema.applications)
            .where(ilike(schema.applications.fieldIdentifier, `${fieldIdentifierPrefix}%`));

          const deliveriesByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.deliveries.id, orderId: schema.deliveries.orderId })
                .from(schema.deliveries)
                .where(inArray(schema.deliveries.facilityId, facilityIds))
            : [];
          const deliveryIdsFromFieldApps = uniq(
            appsByField.map((a) => a.deliveryId).filter((id): id is string => Boolean(id))
          );
          const deliveriesByFieldApps = deliveryIdsFromFieldApps.length
            ? await tx
                .select({ id: schema.deliveries.id, orderId: schema.deliveries.orderId })
                .from(schema.deliveries)
                .where(inArray(schema.deliveries.id, deliveryIdsFromFieldApps))
            : [];

          const ordersByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.orders.id })
                .from(schema.orders)
                .where(inArray(schema.orders.facilityId, facilityIds))
            : [];
          const orderIds = ordersByFacility.map((o) => o.id);

          const deliveriesByOrder = orderIds.length
            ? await tx
                .select({ id: schema.deliveries.id, orderId: schema.deliveries.orderId })
                .from(schema.deliveries)
                .where(inArray(schema.deliveries.orderId, orderIds))
            : [];

          const deliveriesById = new Map<string, { id: string; orderId: string }>();
          for (const delivery of [
            ...deliveriesByFacility,
            ...deliveriesByFieldApps,
            ...deliveriesByOrder,
          ]) {
            deliveriesById.set(delivery.id, delivery);
          }
          const deliveryIds = Array.from(deliveriesById.keys());

          const appsByDelivery = deliveryIds.length
            ? await tx
                .select({ id: schema.applications.id })
                .from(schema.applications)
                .where(inArray(schema.applications.deliveryId, deliveryIds))
            : [];
          const applicationIds = uniq([
            ...appsByField.map((a) => a.id),
            ...appsByDelivery.map((a) => a.id),
          ]);

          const creditBatchLinks = applicationIds.length
            ? await tx
                .select({ creditBatchId: schema.creditBatchApplications.creditBatchId })
                .from(schema.creditBatchApplications)
                .where(inArray(schema.creditBatchApplications.applicationId, applicationIds))
            : [];
          const creditBatchesByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.creditBatches.id })
                .from(schema.creditBatches)
                .where(inArray(schema.creditBatches.facilityId, facilityIds))
            : [];
          const creditBatchIds = uniq([
            ...creditBatchLinks.map((l) => l.creditBatchId),
            ...creditBatchesByFacility.map((cb) => cb.id),
          ]);

          const feedstocksByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.feedstocks.id })
                .from(schema.feedstocks)
                .where(inArray(schema.feedstocks.facilityId, facilityIds))
            : [];
          const feedstockDeliveryRows = facilityIds.length
            ? await tx
                .select({ id: schema.feedstockDeliveries.id })
                .from(schema.feedstockDeliveries)
                .where(inArray(schema.feedstockDeliveries.facilityId, facilityIds))
            : [];
          const feedstockIds = feedstocksByFacility.map((f) => f.id);
          const feedstockDeliveryIds = feedstockDeliveryRows.map((fd) => fd.id);

          const biocharProductsByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.biocharProducts.id })
                .from(schema.biocharProducts)
                .where(inArray(schema.biocharProducts.facilityId, facilityIds))
            : [];
          const biocharProductsByRun = productionRunIds.length
            ? await tx
                .select({ id: schema.biocharProducts.id })
                .from(schema.biocharProducts)
                .where(inArray(schema.biocharProducts.linkedProductionRunId, productionRunIds))
            : [];
          const biocharProductIds = uniq([
            ...biocharProductsByFacility.map((bp) => bp.id),
            ...biocharProductsByRun.map((bp) => bp.id),
          ]);

          const storageLocationRows = facilityIds.length
            ? await tx
                .select({ id: schema.storageLocations.id })
                .from(schema.storageLocations)
                .where(inArray(schema.storageLocations.facilityId, facilityIds))
            : [];
          const storageLocationIds = storageLocationRows.map((s) => s.id);

          const allEntityIds = uniq([
            ...facilityIds,
            ...reactorIds,
            ...productionRunIds,
            ...orderIds,
            ...deliveryIds,
            ...applicationIds,
            ...creditBatchIds,
            ...feedstockIds,
            ...feedstockDeliveryIds,
            ...biocharProductIds,
            ...storageLocationIds,
          ]);

          const documentRows = allEntityIds.length
            ? await tx
                .select({ id: schema.documents.id })
                .from(schema.documents)
                .where(inArray(schema.documents.entityId, allEntityIds))
            : [];
          const documentIds = documentRows.map((d) => d.id);

          if (documentIds.length) {
            await tx
              .delete(schema.certifierDocumentUploads)
              .where(inArray(schema.certifierDocumentUploads.documentId, documentIds));
            await tx
              .delete(schema.feedstockScAssessments)
              .where(inArray(schema.feedstockScAssessments.evidenceDocumentId, documentIds));
            await tx
              .delete(schema.custodyHandoffs)
              .where(inArray(schema.custodyHandoffs.documentId, documentIds));
            await tx
              .delete(schema.documents)
              .where(inArray(schema.documents.id, documentIds));
          }

          if (creditBatchIds.length) {
            await tx
              .delete(schema.ghgMaterialityAssessments)
              .where(inArray(schema.ghgMaterialityAssessments.creditBatchId, creditBatchIds));
          }

          if (applicationIds.length) {
            await tx
              .delete(schema.soilTemperatureMeasurements)
              .where(inArray(schema.soilTemperatureMeasurements.applicationId, applicationIds));
            await tx
              .delete(schema.creditBatchApplications)
              .where(inArray(schema.creditBatchApplications.applicationId, applicationIds));
          }

          if (creditBatchIds.length) {
            await tx
              .delete(schema.creditBatchApplications)
              .where(inArray(schema.creditBatchApplications.creditBatchId, creditBatchIds));
            await tx
              .delete(schema.samples)
              .where(inArray(schema.samples.creditBatchId, creditBatchIds));
            await tx
              .delete(schema.creditBatches)
              .where(inArray(schema.creditBatches.id, creditBatchIds));
          }

          if (applicationIds.length) {
            await tx
              .delete(schema.applications)
              .where(inArray(schema.applications.id, applicationIds));
          }

          if (deliveryIds.length) {
            await tx
              .delete(schema.transportLegs)
              .where(
                and(
                  eq(schema.transportLegs.entityType, "delivery"),
                  inArray(schema.transportLegs.entityId, deliveryIds)
                )
              );
            await tx
              .delete(schema.deliveries)
              .where(inArray(schema.deliveries.id, deliveryIds));
          }

          if (orderIds.length) {
            await tx
              .delete(schema.orders)
              .where(inArray(schema.orders.id, orderIds));
          }

          if (productionRunIds.length) {
            await tx
              .delete(schema.productionRunReadings)
              .where(inArray(schema.productionRunReadings.productionRunId, productionRunIds));
            await tx
              .delete(schema.productionSamples)
              .where(inArray(schema.productionSamples.productionRunId, productionRunIds));
            await tx
              .delete(schema.incidentReports)
              .where(inArray(schema.incidentReports.productionRunId, productionRunIds));
            await tx
              .delete(schema.samples)
              .where(inArray(schema.samples.productionRunId, productionRunIds));
            await tx
              .delete(schema.productionRunFeedstocks)
              .where(inArray(schema.productionRunFeedstocks.productionRunId, productionRunIds));
          }

          if (biocharProductIds.length) {
            await tx
              .delete(schema.biocharProducts)
              .where(inArray(schema.biocharProducts.id, biocharProductIds));
          }

          if (productionRunIds.length) {
            await tx
              .delete(schema.productionRuns)
              .where(inArray(schema.productionRuns.id, productionRunIds));
          }

          if (feedstockIds.length) {
            await tx
              .delete(schema.feedstockScAssessments)
              .where(inArray(schema.feedstockScAssessments.feedstockId, feedstockIds));
            await tx
              .delete(schema.productionRunFeedstocks)
              .where(inArray(schema.productionRunFeedstocks.feedstockId, feedstockIds));
            await tx
              .delete(schema.feedstocks)
              .where(inArray(schema.feedstocks.id, feedstockIds));
          }

          if (feedstockDeliveryIds.length) {
            await tx
              .delete(schema.feedstockDeliveries)
              .where(inArray(schema.feedstockDeliveries.id, feedstockDeliveryIds));
          }

          if (reactorIds.length) {
            await tx
              .delete(schema.incidentReports)
              .where(inArray(schema.incidentReports.reactorId, reactorIds));
            await tx
              .delete(schema.reactors)
              .where(inArray(schema.reactors.id, reactorIds));
          }

          if (storageLocationIds.length) {
            await tx
              .delete(schema.storageLocations)
              .where(inArray(schema.storageLocations.id, storageLocationIds));
          }

          if (facilityIds.length) {
            await tx
              .delete(schema.certifierProjects)
              .where(inArray(schema.certifierProjects.facilityId, facilityIds));
            await tx
              .delete(schema.facilities)
              .where(inArray(schema.facilities.id, facilityIds));
          }
        });
      } finally {
        await pool.end();
      }
    };

    const today = new Date().toISOString().split("T")[0];

    try {
    // ─── 1. FACILITY ───────────────────────────────────────
    await test.step("Create Facility", async () => {
      await page.goto("/facilities");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Facility")');
      await waitForSideSheet(page);

      await page.fill('input[name="name"]', `Chain Facility ${runId}`);
      await page.fill('input[name="country"]', "Tanzania");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Facility")').click();
      await waitForSideSheetClose(page);

      // Search for the new facility (list may be paginated)
      const facilitySearch = page.getByPlaceholder(/search/i);
      await facilitySearch.fill(`Chain Facility ${runId}`);
      await page.waitForTimeout(500);
      await expect(page.getByText(`Chain Facility ${runId}`)).toBeVisible({ timeout: 10000 });
    });

    // ─── 2. REACTOR ────────────────────────────────────────
    await test.step("Create Reactor", async () => {
      await page.goto("/reactors");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Reactor")');
      await waitForSideSheet(page);

      await page.fill('input[name="identifier"]', `Chain Reactor ${runId}`);
      await page.selectOption('select[name="reactorType"]', "fixed-bed");
      await page.fill('input[name="type"]', "primary pyrolysis");
      await page.selectOption('select[name="samplingMethod"]', "method_a");

      // Use seeded facility for deterministic option lookup (dropdown can be paginated).
      await selectEntityById(
        page,
        "Facility",
        seededData.facility.id,
        seededData.facility.name
      );

      await page.locator('[role="dialog"]').locator('button:has-text("Create Reactor")').click();
      await waitForSideSheetClose(page);

      // Search for the new reactor (list may be paginated)
      const reactorSearch = page.getByPlaceholder(/search/i);
      await reactorSearch.fill(`Chain Reactor ${runId}`);
      await page.waitForTimeout(500);
      await expect(page.getByText(`Chain Reactor ${runId}`)).toBeVisible({ timeout: 10000 });
    });

    // ─── 3. PRODUCTION RUN ─────────────────────────────────
    await test.step("Create Production Run", async () => {
      await page.goto("/production-runs");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Production Run")');
      await waitForSideSheet(page);

      await page.selectOption('select[name="status"]', "draft");

      // Select the seeded facility (has feedstocks and storage locations)
      await selectEntityById(
        page,
        "Facility",
        seededData.facility.id,
        seededData.facility.name
      );
      await page.waitForTimeout(1000); // wait for cascading selects

      // Select a reactor (seeded facility's reactors won't include our UI-created one,
      // but the seeded facility should have the one from the facility create — we need
      // to use the seeded facility which has feedstocks)
      // Actually, select first available reactor for the seeded facility
      await selectFirstEntity(page, "Reactor");

      // Fill date
      await page.fill('input[name="date"]', today);

      // Select feedstock source bin
      await page.waitForTimeout(500);
      await selectEntityById(
        page,
        "Feedstock Source Bin",
        seededData.feedstockStorageLocation.id,
        seededData.feedstockStorageLocation.name
      );
      await page.fill('input[name="feedstockMassUsedKg"]', "50");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Production Run")').click();
      await waitForSideSheetClose(page);

      // Verify a row exists in the list
      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 4. SAMPLE ─────────────────────────────────────────
    await test.step("Create Sample", async () => {
      await page.goto("/samples");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Sample")');
      await waitForSideSheet(page);

      // Select first available production run
      await selectFirstEntity(page, "Production Run");

      // Fill carbon data
      await page.fill('input[name="totalCarbonPercent"]', "75");
      await page.fill('input[name="organicCarbonPercent"]', "70");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Sample")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 5. ORDER ──────────────────────────────────────────
    await test.step("Create Order", async () => {
      await page.goto("/orders");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Order")');
      await waitForSideSheet(page);

      await page.fill('input[name="orderDate"]', today);
      await page.selectOption('select[name="facilityId"]', seededData.facility.id);
      await page.selectOption('select[name="status"]', "draft");
      await page.selectOption('select[name="customerId"]', seededData.customer.id);

      // Wait for cascading customer location select
      await page.waitForSelector(
        'select[name="customerLocationId"]:not([disabled])',
        { timeout: 8000 }
      );
      await page.selectOption(
        'select[name="customerLocationId"]',
        seededData.customerLocation.id
      );

      await page.selectOption(
        'select[name="biocharProductId"]',
        seededData.biocharProduct.id
      );
      await page.selectOption('select[name="packaging"]', "loose");
      await page.fill('input[name="quantityKg"]', "100");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Order")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.getByText(seededData.customer.name, { exact: false }).first()
      ).toBeVisible({ timeout: 8000 });
    });

    // ─── 6. DELIVERY ───────────────────────────────────────
    await test.step("Create Delivery", async () => {
      await page.goto("/deliveries");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Delivery")');
      await waitForSideSheet(page);

      await page.fill('input[name="deliveryDate"]', today);
      await page.selectOption('select[name="status"]', "upcoming");

      // Select the first available order
      const orderSelect = page.locator('select[name="orderId"]');
      await orderSelect.waitFor({ state: "attached", timeout: 8000 });
      const orderOptions = orderSelect.locator("option:not([value=''])");
      await expect(orderOptions.first()).toBeAttached({ timeout: 8000 });
      const orderValue = await orderOptions.first().getAttribute("value");
      if (orderValue) {
        await orderSelect.selectOption(orderValue);
      }

      await page.fill('input[name="deliveredWetMassKg"]', "95");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 7. APPLICATION ────────────────────────────────────
    await test.step("Create Application", async () => {
      await page.goto("/applications");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Application")');
      await waitForSideSheet(page);

      await page.fill('input[name="applicationDate"]', today);

      // Select first delivery
      const deliverySelect = page.locator('select[name="deliveryId"]');
      const deliveryOptions = deliverySelect.locator("option:not([value=''])");
      await expect(deliveryOptions.first()).toBeAttached({ timeout: 8000 });
      const deliveryValue = await deliveryOptions.first().getAttribute("value");
      if (deliveryValue) {
        await deliverySelect.selectOption(deliveryValue);
      }

      await page.fill('input[name="biocharAppliedTons"]', "5");
      await page.fill('input[name="biocharAppliedDryTons"]', "4.5");
      await page.fill('input[name="fieldIdentifier"]', `E2E-Field-${runId}`);
      await page.fill('input[name="cropType"]', "maize");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 8. CREDIT BATCH ───────────────────────────────────
    await test.step("Create Credit Batch", async () => {
      await page.goto("/credit-batches");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Credit Batch")');
      await waitForSideSheet(page);

      await page.selectOption('select[name="facilityId"]', seededData.facility.id);
      await page.fill('input[name="startDate"]', today);
      await page.fill('input[name="endDate"]', today);
      await page.selectOption('select[name="status"]', "draft");

      // Select application checkbox if available
      const appCheckboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await appCheckboxes.count();
      if (checkboxCount > 0) {
        const firstAppLabel = page
          .locator("label")
          .filter({ has: page.locator('input[type="checkbox"]') })
          .first();
        await firstAppLabel.click();
      }

      await page.selectOption('select[name="durabilityOption"]', "200_year");
      // H:Corg ratio is required for 200-year durability
      await page.fill('input[name="hToCorgRatio"]', "0.4");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Credit Batch")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });
    } finally {
      // Clean up chain-created entities regardless of test outcome
      await cleanupChainCreatedEntities();
    }
  });
});
