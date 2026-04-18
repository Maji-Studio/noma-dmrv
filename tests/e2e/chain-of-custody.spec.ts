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

async function selectApplication(
  page: Page,
  applicationId: string,
  applicationCode: string
) {
  await page.getByTestId("entity-select-trigger").click();
  await expect(page.getByTestId("entity-select-listbox")).toBeVisible();
  await page.getByTestId("entity-select-search").fill(applicationCode);
  await page.getByTestId(`entity-option-${applicationId}`).click();
}

test.describe("Chain of Custody Visualization", () => {
  test("page loads with application-first empty state", async ({
    adminPage,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    await adminPage.goto("/chain-of-custody");

    await expect(
      adminPage.getByRole("heading", { name: /Chain of Custody/i })
    ).toBeVisible();
    await expect(
      adminPage.getByText(/Select an application above to view its rollback to feedstock/i)
    ).toBeVisible();
    await expect(adminPage.getByTestId("entity-select-trigger")).toBeVisible();
  });

  test("selecting an application renders its rollback graph", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const lineage = await seedApplicationLineage(seededData);

    await adminPage.goto("/chain-of-custody");
    await selectApplication(adminPage, lineage.application.id, lineage.application.code);

    await expect(adminPage).toHaveURL(
      new RegExp(`/chain-of-custody\\?.*application=${lineage.application.id}`)
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

    await adminPage.goto(`/chain-of-custody?application=${lineage.application.id}`);

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

    await adminPage.goto(`/chain-of-custody?application=${lineage.application.id}`);
    await expect(adminPage.locator(".react-flow__viewport")).toBeVisible({
      timeout: 15000,
    });

    const reactorNode = adminPage.locator(
      '[data-testid="rf__node-reactor:' + seededData.reactor.id + '"]'
    );
    await expect(reactorNode).toBeVisible({ timeout: 10000 });
    await expect(reactorNode.locator("a").first()).toHaveAttribute(
      "href",
      "/reactors"
    );
  });
});
