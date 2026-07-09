import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Page } from "@playwright/test";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { test, expect, type SeededChainData } from "./fixtures";

function createDbConnection() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}

function chainUrl(
  facilityId: string,
  params: Record<string, string> = {}
) {
  const search = new URLSearchParams({ facility: facilityId, ...params });
  return `/chain-of-custody?${search.toString()}`;
}

async function seedApplicationLineage(seededData: SeededChainData) {
  const { db, pool } = createDbConnection();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();

  const ids = {
    productionRun: crypto.randomUUID(),
    productionRunFeedstock: crypto.randomUUID(),
    order: crypto.randomUUID(),
    delivery: crypto.randomUUID(),
    application: crypto.randomUUID(),
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
        id: ids.productionRun,
        code: codes.productionRun,
        facilityId: seededData.facility.id,
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
      });
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

// Scope by the wrapping testid — the trigger testid itself is not unique.
async function selectEntity(
  page: Page,
  wrapperTestId: "chain-batch-select",
  entityId: string,
  entityCode: string
) {
  await page
    .getByTestId(wrapperTestId)
    .getByTestId("entity-select-trigger")
    .click();
  await expect(page.getByTestId("entity-select-listbox")).toBeVisible();
  await page.getByTestId("entity-select-search").fill(entityCode);
  await page.getByTestId(`entity-option-${entityId}`).click();
}

/**
 * Seeds a credit batch whose two member applications share one production run
 * and one biochar lot — the shared-run dedupe case — with masses chosen so
 * the Sankey emits all three planned exits:
 *   feedstock 1000 → (ineligible 100) → runs out 300 → lots 300
 *   → applied 250 (0.1 t + 0.15 t) → in storage 50; conversion loss 600.
 * The ineligible exit derives from a second feedstock flagged
 * `eligibilityStatus: 'ineligible'` with a 100 kg run allocation (issue #285)
 * — there is no batch-level ineligible-mass column anymore.
 */
async function seedBatchChain(seededData: SeededChainData) {
  const { db, pool } = createDbConnection();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();

  const ids = {
    productionRun: crypto.randomUUID(),
    ineligibleFeedstock: crypto.randomUUID(),
    orderA: crypto.randomUUID(),
    orderB: crypto.randomUUID(),
    deliveryA: crypto.randomUUID(),
    deliveryB: crypto.randomUUID(),
    applicationA: crypto.randomUUID(),
    applicationB: crypto.randomUUID(),
    creditBatch: crypto.randomUUID(),
    productionProcess: crypto.randomUUID(),
    document: crypto.randomUUID(),
    productionSample: crypto.randomUUID(),
  };
  const codes = {
    productionRun: `E2E-BPR-${suffix}`,
    ineligibleFeedstock: `E2E-BFSI-${suffix}`,
    applicationA: `E2E-BAPA-${suffix}`,
    applicationB: `E2E-BAPB-${suffix}`,
    creditBatch: `E2E-CB-${suffix}`,
    deliveryDocument: `E2E-receipt-${suffix}.pdf`,
    productionSample: `E2E-PS-${suffix}`,
  };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.productionRuns).values({
        id: ids.productionRun,
        code: codes.productionRun,
        facilityId: seededData.facility.id,
        status: "complete",
        startTime: new Date("2026-03-02T07:00:00.000Z"),
        endTime: new Date("2026-03-02T15:00:00.000Z"),
        reactorId: seededData.reactor.id,
        feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
        biocharStorageLocationId: seededData.biocharStorageLocation.id,
        feedstockMassDryKg: 1000,
        biocharDryMassKg: 300,
        biocharOutputKg: 320,
      });

      // 900 kg eligible + 100 kg ineligible allocations; the run's recorded
      // 1000 kg input stays authoritative for the Sankey's feedstock column.
      await tx.insert(schema.feedstocks).values({
        id: ids.ineligibleFeedstock,
        code: codes.ineligibleFeedstock,
        facilityId: seededData.facility.id,
        feedstockTypeId: seededData.feedstockType.id,
        massDryKg: 100,
        eligibilityStatus: "ineligible",
        storageLocationId: seededData.feedstockStorageLocation.id,
      });
      await tx.insert(schema.productionRunFeedstocks).values([
        {
          id: crypto.randomUUID(),
          productionRunId: ids.productionRun,
          feedstockId: seededData.feedstock.id,
          massUsedKg: 900,
        },
        {
          id: crypto.randomUUID(),
          productionRunId: ids.productionRun,
          feedstockId: ids.ineligibleFeedstock,
          massUsedKg: 100,
        },
      ]);

      await tx
        .update(schema.biocharProducts)
        .set({
          linkedProductionRunId: ids.productionRun,
          storageLocationId: seededData.biocharStorageLocation.id,
          massKg: 300,
        })
        .where(eq(schema.biocharProducts.id, seededData.biocharProduct.id));

      const memberChains = [
        {
          orderId: ids.orderA,
          deliveryId: ids.deliveryA,
          applicationId: ids.applicationA,
          applicationCode: codes.applicationA,
          appliedDryTons: 0.1,
          day: "05",
        },
        {
          orderId: ids.orderB,
          deliveryId: ids.deliveryB,
          applicationId: ids.applicationB,
          applicationCode: codes.applicationB,
          appliedDryTons: 0.15,
          day: "06",
        },
      ];
      for (const member of memberChains) {
        await tx.insert(schema.orders).values({
          id: member.orderId,
          code: `E2E-BOR-${member.day}-${suffix}`,
          facilityId: seededData.facility.id,
          orderDate: new Date(`2026-03-${member.day}T08:00:00.000Z`),
          customerId: seededData.customer.id,
          customerLocationId: seededData.customerLocation.id,
          biocharProductId: seededData.biocharProduct.id,
          quantityKg: 150,
          packaging: "loose",
        });
        await tx.insert(schema.deliveries).values({
          id: member.deliveryId,
          code: `E2E-BDL-${member.day}-${suffix}`,
          facilityId: seededData.facility.id,
          orderId: member.orderId,
          biocharProductId: seededData.biocharProduct.id,
          deliveryDate: new Date(`2026-03-${member.day}T11:00:00.000Z`),
          status: "delivered",
          massDryKg: 125,
          deliveredWetMassKg: 134,
          moistureContentPercent: 6.5,
        });
        await tx.insert(schema.applications).values({
          id: member.applicationId,
          code: member.applicationCode,
          deliveryId: member.deliveryId,
          applicationDate: new Date(`2026-03-${member.day}T15:00:00.000Z`),
          biocharAppliedTons: member.appliedDryTons + 0.01,
          biocharAppliedDryTons: member.appliedDryTons,
          fieldIdentifier: `Field ${member.day}-${suffix}`,
          status: "applied",
        });
      }

      await tx.insert(schema.productionProcesses).values({
        id: ids.productionProcess,
        facilityId: seededData.facility.id,
        feedstockTypeId: seededData.feedstockType.id,
      });

      await tx.insert(schema.creditBatches).values({
        id: ids.creditBatch,
        code: codes.creditBatch,
        facilityId: seededData.facility.id,
        feedstockTypeId: seededData.feedstockType.id,
        productionProcessId: ids.productionProcess,
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        // Default durabilityOption='200_year' has a CHECK constraint that
        // requires this field; the spec doesn't read the durability math.
        hToCorgRatio: 0.4,
      });
      await tx.insert(schema.creditBatchProductionRuns).values({
        creditBatchId: ids.creditBatch,
        productionRunId: ids.productionRun,
      });

      // Trail evidence: a document on delivery A and a production-run sample.
      await tx.insert(schema.documents).values({
        id: ids.document,
        entityType: "delivery",
        entityId: ids.deliveryA,
        documentType: "delivery_receipt",
        fileName: codes.deliveryDocument,
        fileUrl: "https://example.com/e2e-delivery-receipt.pdf",
      });
      await tx.insert(schema.productionSamples).values({
        id: ids.productionSample,
        productionRunId: ids.productionRun,
        sampleCode: codes.productionSample,
        timestamp: new Date("2026-03-02T12:00:00.000Z"),
        weightGrams: 500,
      });
    });

    return { ids, codes };
  } finally {
    await pool.end();
  }
}

test.describe("Chain of Custody Visualization", () => {
  test("page loads with the batch-selector empty state", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    // Anchor a facility explicitly: without one the page renders the
    // "Select a facility" empty state instead, so this test only passed
    // when an earlier spec in the shard happened to leave a facility.
    await adminPage.goto(chainUrl(seededData.facility.id));

    await expect(
      adminPage.getByRole("heading", { name: /Chain of Custody/i })
    ).toBeVisible();
    await expect(
      adminPage.getByText(
        /Select a credit batch above to view its chain of custody/i
      )
    ).toBeVisible();
    await expect(
      adminPage.getByTestId("chain-batch-select").getByTestId("entity-select-trigger")
    ).toBeVisible();
    // The run filter is derived from the batch, so it only renders once a
    // batch anchors the page.
    await expect(adminPage.getByTestId("chain-run-select")).toHaveCount(0);
  });

  test("application deep link renders its full rollback graph", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedApplicationLineage(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, { application: lineage.application.id })
    );

    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });

    const expectedCodes = [
      seededData.feedstock.code,
      seededData.reactor.code,
      lineage.productionRun.code,
      seededData.biocharProduct.code,
      lineage.order.code,
      lineage.delivery.code,
      lineage.application.code,
    ];

    for (const code of expectedCodes) {
      await expect(
        adminPage.locator(".react-flow__node").filter({ hasText: code }).first()
      ).toBeVisible({ timeout: 10000 });
    }

    const edges = adminPage.locator(".react-flow__edge");
    const edgeCount = await edges.count();
    expect(edgeCount).toBeGreaterThanOrEqual(6);
  });

  test("application query param opens the lineage directly", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedApplicationLineage(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, { application: lineage.application.id })
    );

    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      adminPage.getByText(`${seededData.facility.code} - ${seededData.facility.name}`)
    ).toBeVisible({ timeout: 10000 });
    await expect(
      adminPage.locator(".react-flow__node").filter({ hasText: lineage.application.code }).first()
    ).toBeVisible();
    await expect(
      adminPage.locator(".react-flow__node").filter({ hasText: seededData.feedstock.code }).first()
    ).toBeVisible();
  });

  test("lineage nodes expose the linked entity page", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedApplicationLineage(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, { application: lineage.application.id })
    );
    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });

    const reactorNode = adminPage.locator(
      '[data-testid="rf__node-reactor:' + seededData.reactor.id + '"]'
    );
    await expect(reactorNode).toBeVisible({ timeout: 10000 });
    await reactorNode.click();
    const sheet = adminPage.locator('[role="dialog"]').first();
    await expect(sheet.getByRole("heading", { name: seededData.reactor.code })).toBeVisible();
    await sheet.getByRole("button", { name: "View full record" }).click();
    await expect(adminPage).toHaveURL(/\/reactors/);
  });
});

test.describe("Chain of Custody Views (credit-batch anchor)", () => {
  test("batch deep link renders the merged roll-up with shared runs deduped", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const batch = await seedBatchChain(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, { batch: batch.ids.creditBatch })
    );

    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      adminPage.getByText(`${seededData.facility.code} - ${seededData.facility.name}`)
    ).toBeVisible({ timeout: 10000 });

    // Both member applications render…
    await expect(
      adminPage.locator(
        `[data-testid="rf__node-application:${batch.ids.applicationA}"]`
      )
    ).toBeVisible({ timeout: 10000 });
    await expect(
      adminPage.locator(
        `[data-testid="rf__node-application:${batch.ids.applicationB}"]`
      )
    ).toBeVisible();
    // …while the shared production run appears exactly once.
    await expect(
      adminPage.locator(".react-flow__node").filter({
        hasText: batch.codes.productionRun,
      })
    ).toHaveCount(1);

    // Batch anchor exposes the batch view modes.
    const segment = adminPage.getByTestId("chain-view-segment");
    await expect(segment.getByRole("button", { name: "DAG" })).toBeVisible();
    await expect(segment.getByRole("button", { name: "Map" })).toBeVisible();
    await expect(segment.getByRole("button", { name: "Sankey" })).toBeVisible();
  });

  test("dual selector drills down from batch to application and back", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const batch = await seedBatchChain(seededData);

    await adminPage.goto(chainUrl(seededData.facility.id));
    await selectEntity(
      adminPage,
      "chain-batch-select",
      batch.ids.creditBatch,
      batch.codes.creditBatch
    );

    await expect(adminPage).toHaveURL(
      new RegExp(`/chain-of-custody\\?.*batch=${batch.ids.creditBatch}`)
    );
    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });

    // Clicking a member application card drills down, keeping the batch.
    await adminPage
      .locator(`[data-testid="rf__node-application:${batch.ids.applicationA}"]`)
      .click();
    await adminPage
      .getByRole("button", { name: "Trace rollback" })
      .click();
    await expect(adminPage).toHaveURL(
      new RegExp(`application=${batch.ids.applicationA}`)
    );
    await expect(adminPage).toHaveURL(
      new RegExp(`batch=${batch.ids.creditBatch}`)
    );
    // Drill-down shows the application view modes, incl. the Trail.
    await expect(
      adminPage
        .getByTestId("chain-view-segment")
        .getByRole("button", { name: "Trail" })
    ).toBeVisible({ timeout: 15000 });

    // The roll-up stays one click away.
    await adminPage.getByTestId("chain-back-to-batch").click();
    await expect(adminPage).not.toHaveURL(/application=/);
    await expect(adminPage).toHaveURL(
      new RegExp(`batch=${batch.ids.creditBatch}`)
    );
  });

  test("production run filter narrows the batch roll-up", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const batch = await seedBatchChain(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, { batch: batch.ids.creditBatch })
    );
    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });

    // The filter lists only runs derived from the batch's lineages.
    await adminPage.getByTestId("chain-run-select-trigger").click();
    await adminPage
      .getByTestId(`chain-run-option-${batch.ids.productionRun}`)
      .click();

    await expect(adminPage).toHaveURL(
      new RegExp(`run=${batch.ids.productionRun}`)
    );
    // The shared run flows into both member applications, so both survive
    // the narrowing.
    await expect(
      adminPage.locator(
        `[data-testid="rf__node-application:${batch.ids.applicationA}"]`
      )
    ).toBeVisible({ timeout: 10000 });
    await expect(
      adminPage.locator(
        `[data-testid="rf__node-application:${batch.ids.applicationB}"]`
      )
    ).toBeVisible();

    // Clearing the filter returns the full roll-up.
    await adminPage.getByTestId("chain-run-select-clear").click();
    await expect(adminPage).not.toHaveURL(/run=/);
  });

  test("sankey balances dry mass with explicit labeled exits", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const batch = await seedBatchChain(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, {
        batch: batch.ids.creditBatch,
        view: "sankey",
      })
    );

    const sankey = adminPage.getByTestId("batch-sankey");
    await expect(sankey).toBeVisible({ timeout: 15000 });

    // Seeded balance: 1000 in − 100 ineligible − 300 out = 600 conversion
    // loss; 300 lot − 250 applied = 50 in storage.
    const ineligible = sankey.getByTestId("sankey-exit-ineligible_feedstock");
    await expect(ineligible).toBeVisible();
    await expect(ineligible).toContainText("Ineligible feedstock");
    await expect(ineligible).toContainText("100 kg");

    const conversion = sankey.getByTestId("sankey-exit-conversion_loss");
    await expect(conversion).toBeVisible();
    await expect(conversion).toContainText("Conversion loss");
    await expect(conversion).toContainText("600 kg");

    const inStorage = sankey.getByTestId("sankey-exit-in_storage");
    await expect(inStorage).toBeVisible();
    await expect(inStorage).toContainText("In storage / undelivered");
    await expect(inStorage).toContainText("50 kg");

    await expect(sankey.getByText("Feedstock", { exact: true })).toBeVisible();
    await expect(sankey.getByText("Applied", { exact: true })).toBeVisible();
  });

  test("trail lists custody steps with their attesting evidence", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const batch = await seedBatchChain(seededData);

    await adminPage.goto(
      chainUrl(seededData.facility.id, {
        application: batch.ids.applicationA,
        view: "trail",
      })
    );

    const trail = adminPage.getByTestId("application-trail");
    await expect(trail).toBeVisible({ timeout: 15000 });

    // Full chain: 2 feedstocks (eligible + ineligible) → run → lot → order
    // → delivery → application.
    await expect(trail.getByTestId("trail-step")).toHaveCount(7);
    await expect(
      trail.getByText(batch.codes.productionRun, { exact: true })
    ).toBeVisible();

    // Evidence rows: the delivery document and the production-run sample.
    await expect(
      trail
        .getByTestId("trail-evidence-document")
        .filter({ hasText: batch.codes.deliveryDocument })
    ).toBeVisible();
    await expect(
      trail
        .getByTestId("trail-evidence-sample")
        .filter({ hasText: batch.codes.productionSample })
    ).toBeVisible();
  });
});
