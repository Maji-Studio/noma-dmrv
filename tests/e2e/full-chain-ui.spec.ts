/**
 * Full Chain UI Smoke Test
 *
 * Single test that creates all 8 core entities through the browser UI
 * in one authenticated session, proving the entire traceability chain works:
 *
 * Facility → Reactor → Production Run → Order → Delivery → Application → Credit Batch → Sample
 * (Samples anchor on a credit batch — issue #309 — so the batch precedes them.)
 *
 * Uses seeded prerequisite data (supplier, feedstock type, customer, etc.)
 * from the auth fixtures.
 */
import { test, expect } from "./fixtures";
import {
  ACTION_LABEL_PREFIX,
  dismissCertifierLinkDialog,
  getCreatedActionCode,
  getListedActionCodes,
  waitForSideSheet,
  waitForSideSheetClose,
  selectEntity as selectEntityById,
  selectFirstCreditBatchProductionRun,
  selectFirstEntity,
} from "./fixtures/page-helpers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, ilike, inArray } from "drizzle-orm";
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
          const chainReactorIdentifier = `Chain Reactor ${runId}`;

          // Find chain-created facilities by name
          const chainFacilities = await tx
            .select({ id: schema.facilities.id })
            .from(schema.facilities)
            .where(ilike(schema.facilities.name, `Chain Facility ${runId}%`));
          const facilityIds = chainFacilities.map((f) => f.id);

          const chainReactorsByFacility = facilityIds.length
            ? await tx
                .select({ id: schema.reactors.id })
                .from(schema.reactors)
                .where(inArray(schema.reactors.facilityId, facilityIds))
            : [];
          const chainReactorsByIdentifier = await tx
            .select({ id: schema.reactors.id })
            .from(schema.reactors)
            .where(eq(schema.reactors.identifier, chainReactorIdentifier));
          const reactorIds = uniq([
            ...chainReactorsByFacility.map((r) => r.id),
            ...chainReactorsByIdentifier.map((r) => r.id),
          ]);

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
          const relatedOrderIds = uniq([
            ...orderIds,
            ...Array.from(deliveriesById.values())
              .map((delivery) => delivery.orderId)
              .filter((id): id is string => Boolean(id)),
          ]);
          const deliveriesByRelatedOrders = relatedOrderIds.length
            ? await tx
                .select({ id: schema.deliveries.id, orderId: schema.deliveries.orderId })
                .from(schema.deliveries)
                .where(inArray(schema.deliveries.orderId, relatedOrderIds))
            : [];
          for (const delivery of deliveriesByRelatedOrders) {
            deliveriesById.set(delivery.id, delivery);
          }
          const allDeliveryIds = Array.from(deliveriesById.keys());

          const appsByDelivery = allDeliveryIds.length
            ? await tx
                .select({ id: schema.applications.id })
                .from(schema.applications)
                .where(inArray(schema.applications.deliveryId, allDeliveryIds))
            : [];
          const applicationIds = uniq([
            ...appsByField.map((a) => a.id),
            ...appsByDelivery.map((a) => a.id),
          ]);

          const creditBatchLinks = productionRunIds.length
            ? await tx
                .select({ creditBatchId: schema.creditBatchProductionRuns.creditBatchId })
                .from(schema.creditBatchProductionRuns)
                .where(inArray(schema.creditBatchProductionRuns.productionRunId, productionRunIds))
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
            ...relatedOrderIds,
            ...allDeliveryIds,
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
              .delete(schema.documents)
              .where(inArray(schema.documents.id, documentIds));
          }

          if (applicationIds.length) {
            await tx
              .delete(schema.soilTemperatureMeasurements)
              .where(inArray(schema.soilTemperatureMeasurements.applicationId, applicationIds));
          }

          if (productionRunIds.length) {
            await tx
              .delete(schema.creditBatchProductionRuns)
              .where(inArray(schema.creditBatchProductionRuns.productionRunId, productionRunIds));
          }

          if (creditBatchIds.length) {
            // Samples anchor on the credit batch (issue #309) with a NO ACTION
            // FK — delete them before their batches.
            await tx
              .delete(schema.samples)
              .where(inArray(schema.samples.creditBatchId, creditBatchIds));
            await tx
              .delete(schema.creditBatchProductionRuns)
              .where(inArray(schema.creditBatchProductionRuns.creditBatchId, creditBatchIds));
            await tx
              .delete(schema.creditBatches)
              .where(inArray(schema.creditBatches.id, creditBatchIds));
          }

          if (applicationIds.length) {
            await tx
              .delete(schema.applications)
              .where(inArray(schema.applications.id, applicationIds));
          }

          if (allDeliveryIds.length) {
            await tx
              .delete(schema.deliveries)
              .where(inArray(schema.deliveries.id, allDeliveryIds));
          }

          if (relatedOrderIds.length) {
            await tx
              .delete(schema.orders)
              .where(inArray(schema.orders.id, relatedOrderIds));
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
            // Reverse FK order: removals must go before ghg_statements
            // (removal.ghg_statement_id FKs it) and all certifier rows before
            // the facility.
            await tx
              .delete(schema.certifierRemovals)
              .where(inArray(schema.certifierRemovals.facilityId, facilityIds));
            await tx
              .delete(schema.certifierGhgStatements)
              .where(inArray(schema.certifierGhgStatements.facilityId, facilityIds));
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
    const productionRunDate = "2025-06-15";

    try {
    // ─── 1. FACILITY ───────────────────────────────────────
    await test.step("Create Facility", async () => {
      await page.goto("/facilities");
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Facility")');
      await waitForSideSheet(page);
      const facilityDialog = page
        .getByRole("dialog")
        .filter({ has: page.getByRole("button", { name: "Create Facility" }) });

      await page.fill('input[name="name"]', `Chain Facility ${runId}`);
      await page.fill('input[name="country"]', "Tanzania");
      await facilityDialog
        .getByRole("combobox", { name: "Timezone" })
        .fill("Dar es Salaam");
      await page
        .getByRole("option", { name: "Africa/Dar es Salaam (UTC+3)" })
        .click();

      await facilityDialog
        .getByRole("button", { name: "Create Facility" })
        .click();
      await facilityDialog.waitFor({ state: "hidden", timeout: 10000 });

      // Admins get an optional "Link Isometric project" prompt after create;
      // it aria-hides the page, so dismiss it before asserting on the list.
      await dismissCertifierLinkDialog(page);

      // Search for the new facility (list may be paginated). Scope to the list
      // card's heading — the sidebar FacilitySelector falls back to the first
      // facility, which is this one, so a bare getByText matches twice.
      const facilitySearch = page.getByRole("textbox", {
        name: "Search facilities",
      });
      await facilitySearch.fill(`Chain Facility ${runId}`);
      await page.waitForTimeout(500);
      await expect(
        page.getByRole("heading", { name: `Chain Facility ${runId}` }),
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 2. REACTOR ────────────────────────────────────────
    await test.step("Create Reactor", async () => {
      await page.goto(`/reactors?facility=${seededData.facility.id}`);
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Reactor")');
      await waitForSideSheet(page);

      await page.fill('input[name="identifier"]', `Chain Reactor ${runId}`);
      await page.selectOption('select[name="reactorType"]', "fixed-bed");
      await page.fill('input[name="capacityTph"]', "500");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Reactor")').click();
      await waitForSideSheetClose(page);

      // Search for the new reactor (list may be paginated)
      const reactorSearch = page.getByPlaceholder(/search/i);
      await reactorSearch.fill(`Chain Reactor ${runId}`);
      await page.waitForTimeout(500);
      await expect(
        page.getByRole("button", { name: `Chain Reactor ${runId}` }).first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 3. PRODUCTION RUN ─────────────────────────────────
    await test.step("Create Production Run", async () => {
      await page.goto(`/production-runs?facility=${seededData.facility.id}`);
      await page.waitForLoadState("networkidle");
      const existingRunCodes = await getListedActionCodes(page);

      await page.click('button:has-text("New Production Run")');
      await waitForSideSheet(page);

      await page.selectOption('select[name="status"]', "running");

      await selectEntityById(
        page,
        "Reactor",
        seededData.reactor.id,
        seededData.reactor.identifier
      );

      // Fill start date
      await page.fill('input[name="startDate"]', productionRunDate);
      await page.fill('input[name="startTime"]', "08:00");

      await selectEntityById(
        page,
        "Source Bin",
        seededData.feedstockStorageLocation.id,
        seededData.feedstockStorageLocation.name
      );
      await page.fill('input[name="feedstockWetMassKg"]', "50");
      await page.fill('input[name="feedstockMoisturePercent"]', "15");
      await selectEntityById(
        page,
        "Biochar Storage",
        seededData.biocharStorageLocation.id,
        seededData.biocharStorageLocation.name
      );
      await page.fill('input[name="biocharOutputKg"]', "10");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Production Run")').click();
      await waitForSideSheetClose(page);
      const createdRunCode = await getCreatedActionCode(
        page,
        existingRunCodes,
      );

      await expect(async () => {
        await page
          .locator("tbody")
          .getByRole("button", {
            name: `${ACTION_LABEL_PREFIX}${createdRunCode}`,
            exact: true,
          })
          .click({ timeout: 5000 });
        await page
          .getByRole("menuitem", { name: "Edit" })
          .click({ timeout: 5000 });
      }).toPass({ timeout: 30000 });
      await waitForSideSheet(page);
      await page.fill('input[name="endDate"]', productionRunDate);
      await page.fill('input[name="endTime"]', "12:00");
      await page.selectOption('select[name="status"]', "complete");
      await page
        .locator('[role="dialog"]')
        .getByRole("button", { name: "Save Changes" })
        .click();
      await waitForSideSheetClose(page);

      // Verify a row exists in the list
      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 4. ORDER ──────────────────────────────────────────
    await test.step("Create Order", async () => {
      await page.goto(`/orders?facility=${seededData.facility.id}`);
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Order")');
      await waitForSideSheet(page);

      await page.fill('input[name="orderDate"]', today);
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

      // Product bin is a FormEntitySelect (custom dropdown), not a native <select>
      await selectEntityById(
        page,
        "Product bin",
        seededData.biocharProduct.id
      );
      await page.selectOption('select[name="packaging"]', "loose");
      await page.fill('input[name="quantityKg"]', "100");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Order")').click();
      await waitForSideSheetClose(page);

      // Scope to the table body so the #264 customer-filter <select> options
      // (same names, hidden while collapsed) don't shadow the order-row cell.
      await expect(
        page
          .locator("table tbody")
          .getByText(seededData.customer.name, { exact: false })
          .first()
      ).toBeVisible({ timeout: 8000 });
    });

    // ─── 5. DELIVERY ───────────────────────────────────────
    await test.step("Create Delivery", async () => {
      await page.goto(`/deliveries?facility=${seededData.facility.id}`);
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Delivery")');
      await waitForSideSheet(page);

      await page.fill('input[name="deliveryDate"]', today);
      // Applications require a delivered delivery (issue #284)
      await page.selectOption('select[name="status"]', "delivered");

      // Select the first available order (FormEntitySelect, not a native <select>)
      await selectFirstEntity(page, "Order");

      await page.fill('input[name="deliveredWetMassKg"]', "95");
      await page.fill('input[name="moistureContentPercent"]', "10");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 6. APPLICATION ────────────────────────────────────
    await test.step("Create Application", async () => {
      await page.goto(`/applications?facility=${seededData.facility.id}`);
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

      await page.fill('input[name="biocharAppliedTons"]', "50");
      await page.fill('input[name="fieldIdentifier"]', `E2E-Field-${runId}`);
      await page.fill('input[name="cropType"]', "maize");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
      await waitForSideSheetClose(page);

      await expect(
        page.locator("table tbody tr, [role='row']").first()
      ).toBeVisible({ timeout: 10000 });
    });

    // ─── 7. CREDIT BATCH ───────────────────────────────────
    await test.step("Create Credit Batch", async () => {
      await page.goto(`/credit-batches?facility=${seededData.facility.id}`);
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Credit Batch")');
      await waitForSideSheet(page);

      await page.fill('input[name="startDate"]', productionRunDate);
      await page.fill('input[name="endDate"]', productionRunDate);

      await selectFirstCreditBatchProductionRun(page, seededData.feedstockType);

      await page.locator('[role="dialog"]').locator('button:has-text("Create Credit Batch")').click();
      await waitForSideSheetClose(page);

      await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });
    });

    // ─── 8. SAMPLE ─────────────────────────────────────────
    // Samples anchor on a credit batch (issue #309), so the batch must exist
    // first — the sample is the last link in the chain.
    await test.step("Create Sample", async () => {
      await page.goto(`/samples?facility=${seededData.facility.id}`);
      await page.waitForLoadState("networkidle");

      await page.click('button:has-text("New Sample")');
      await waitForSideSheet(page);

      // Select the credit batch created above
      await selectFirstEntity(page, "Credit Batch");

      // Fill carbon data
      await page.fill('input[name="totalCarbonPercent"]', "75");
      await page.fill('input[name="organicCarbonPercent"]', "70");

      await page.locator('[role="dialog"]').locator('button:has-text("Create Sample")').click();
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
