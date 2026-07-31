import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  biocharProducts,
  customers,
  deliveries,
  facilities,
  formulations,
  orders,
  productionRuns,
  reactors,
  storageLocations,
} from "@/db/schema";
import { updateOrder } from "@/data-access/orders";
import { updateBiocharProduct } from "@/data-access/biochar-products";
import { updateFormulation } from "@/data-access/formulations";
import { updateProductionRun } from "@/data-access/production-runs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const INITIAL_PRODUCT_MASS_KG = 400;
const TARGET_PRODUCT_MASS_KG = 500;
const INHERITED_DELIVERED_MASS_KG = 500;
const CROSS_BIN_TARGET_PRODUCT_MASS_KG = 1_000;
const CROSS_BIN_PRODUCT_LOSS_KG = -700;
const SHRINK_PRODUCT_INITIAL_MASS_KG = 1_000;
const SHRINK_PRODUCT_DELIVERED_MASS_KG = 800;
const SHRINK_PRODUCT_TARGET_MASS_KG = 200;
const FORMULATION_INITIAL_RATIO = 0.5;
const FORMULATION_TARGET_RATIO = 0.9;
const FORMULATION_PRODUCT_COUNT = 10;
const FORMULATION_PRODUCT_MASS_KG = 1_000;
const FORMULATION_RUN_OUTPUT_KG = 6_000;
const RUN_INITIAL_OUTPUT_KG = 1_000;
const RUN_LINKED_PRODUCT_MASS_KG = 900;
const RUN_TARGET_OUTPUT_KG = 100;

describe("stock-reducing update guards", () => {
  const createdDeliveryIds: string[] = [];
  const createdBinMovementIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdFormulationIds: string[] = [];
  const createdProductionRunIds: string[] = [];
  const createdReactorIds: string[] = [];
  const createdStorageLocationIds: string[] = [];
  const createdFacilityIds: string[] = [];

  beforeAll(() => ensureTestOrg());

  afterAll(async () => {
    if (createdBinMovementIds.length > 0) {
      await db
        .delete(binMovements)
        .where(inArray(binMovements.id, createdBinMovementIds));
    }
    if (createdDeliveryIds.length > 0) {
      await db
        .delete(deliveries)
        .where(inArray(deliveries.id, createdDeliveryIds));
    }
    if (createdOrderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, createdOrderIds));
    }
    if (createdCustomerIds.length > 0) {
      await db
        .delete(customers)
        .where(inArray(customers.id, createdCustomerIds));
    }
    if (createdProductIds.length > 0) {
      await db
        .delete(biocharProducts)
        .where(inArray(biocharProducts.id, createdProductIds));
    }
    if (createdFormulationIds.length > 0) {
      await db
        .delete(formulations)
        .where(inArray(formulations.id, createdFormulationIds));
    }
    if (createdProductionRunIds.length > 0) {
      await db
        .delete(productionRuns)
        .where(inArray(productionRuns.id, createdProductionRunIds));
    }
    if (createdReactorIds.length > 0) {
      await db.delete(reactors).where(inArray(reactors.id, createdReactorIds));
    }
    if (createdStorageLocationIds.length > 0) {
      await db
        .delete(storageLocations)
        .where(inArray(storageLocations.id, createdStorageLocationIds));
    }
    if (createdFacilityIds.length > 0) {
      await db
        .delete(facilities)
        .where(inArray(facilities.id, createdFacilityIds));
    }
  });

  it("allows inherited deliveries to move between products in the same bin", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-ORDER-REPOINT-${tag}`,
        name: `Order Repoint Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [productBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-ORDER-REPOINT-${tag}`,
        name: `Order Repoint Bin ${tag}`,
        type: "product_bin",
      })
      .returning({ id: storageLocations.id });
    createdStorageLocationIds.push(productBin.id);

    const [initialProduct, targetProduct] = await db
      .insert(biocharProducts)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: productBin.id,
          code: `BP-ORDER-OLD-${tag}`,
          massKg: INITIAL_PRODUCT_MASS_KG,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: productBin.id,
          code: `BP-ORDER-NEW-${tag}`,
          massKg: TARGET_PRODUCT_MASS_KG,
        },
      ])
      .returning({ id: biocharProducts.id });
    createdProductIds.push(initialProduct.id, targetProduct.id);

    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-ORDER-REPOINT-${tag}`,
        name: `Order Repoint Customer ${tag}`,
      })
      .returning({ id: customers.id });
    createdCustomerIds.push(customer.id);

    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        customerId: customer.id,
        biocharProductId: initialProduct.id,
        code: `OR-ORDER-REPOINT-${tag}`,
        orderDate: new Date("2026-07-01T00:00:00Z"),
        quantityKg: INHERITED_DELIVERED_MASS_KG,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    createdOrderIds.push(order.id);

    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: null,
        storageLocationId: productBin.id,
        code: `DL-ORDER-REPOINT-${tag}`,
        deliveryDate: new Date("2026-07-02T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: INHERITED_DELIVERED_MASS_KG,
      })
      .returning({ id: deliveries.id });
    createdDeliveryIds.push(delivery.id);

    const updated = await updateOrder(makeTestOrgContext(), order.id, {
      biocharProductId: targetProduct.id,
    });

    expect(updated.biocharProductId).toBe(targetProduct.id);

    const [persisted] = await db
      .select({ biocharProductId: orders.biocharProductId })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(persisted.biocharProductId).toBe(targetProduct.id);
  });

  it("rejects inherited deliveries that overdraw a different product bin", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-ORDER-CROSS-BIN-${tag}`,
        name: `Order Cross Bin Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [initialBin, targetBin] = await db
      .insert(storageLocations)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-ORDER-CROSS-OLD-${tag}`,
          name: `Order Cross Bin Old ${tag}`,
          type: "product_bin" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-ORDER-CROSS-NEW-${tag}`,
          name: `Order Cross Bin New ${tag}`,
          type: "product_bin" as const,
        },
      ])
      .returning({ id: storageLocations.id });
    createdStorageLocationIds.push(initialBin.id, targetBin.id);

    const [initialProduct, targetProduct] = await db
      .insert(biocharProducts)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: initialBin.id,
          code: `BP-ORDER-CROSS-OLD-${tag}`,
          massKg: INHERITED_DELIVERED_MASS_KG,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: targetBin.id,
          code: `BP-ORDER-CROSS-NEW-${tag}`,
          massKg: CROSS_BIN_TARGET_PRODUCT_MASS_KG,
        },
      ])
      .returning({ id: biocharProducts.id });
    createdProductIds.push(initialProduct.id, targetProduct.id);

    const [movement] = await db
      .insert(binMovements)
      .values({
        organizationId: TEST_ORG_ID,
        storageLocationId: targetBin.id,
        lane: "product",
        movementType: "loss",
        massDeltaKg: CROSS_BIN_PRODUCT_LOSS_KG,
        reason: `Cross-bin guard fixture ${tag}`,
      })
      .returning({ id: binMovements.id });
    createdBinMovementIds.push(movement.id);

    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-ORDER-CROSS-BIN-${tag}`,
        name: `Order Cross Bin Customer ${tag}`,
      })
      .returning({ id: customers.id });
    createdCustomerIds.push(customer.id);

    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        customerId: customer.id,
        biocharProductId: initialProduct.id,
        code: `OR-ORDER-CROSS-BIN-${tag}`,
        orderDate: new Date("2026-07-03T00:00:00Z"),
        quantityKg: INHERITED_DELIVERED_MASS_KG,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    createdOrderIds.push(order.id);

    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: null,
        storageLocationId: initialBin.id,
        code: `DL-ORDER-CROSS-BIN-${tag}`,
        deliveryDate: new Date("2026-07-04T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: INHERITED_DELIVERED_MASS_KG,
      })
      .returning({ id: deliveries.id });
    createdDeliveryIds.push(delivery.id);

    await expect(
      updateOrder(makeTestOrgContext(), order.id, {
        biocharProductId: targetProduct.id,
      }),
    ).rejects.toThrow("Not enough biochar in this bin");

    const [persisted] = await db
      .select({ biocharProductId: orders.biocharProductId })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(persisted.biocharProductId).toBe(initialProduct.id);
  });

  it("rejects reducing a product below its already-delivered wet mass", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const productCode = `BP-SHRINK-${tag}`;
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-SHRINK-${tag}`,
        name: `Product Shrink Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [productBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-SHRINK-${tag}`,
        name: `Product Shrink Bin ${tag}`,
        type: "product_bin",
      })
      .returning({ id: storageLocations.id });
    createdStorageLocationIds.push(productBin.id);

    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        storageLocationId: productBin.id,
        code: productCode,
        massKg: SHRINK_PRODUCT_INITIAL_MASS_KG,
      })
      .returning({ id: biocharProducts.id });
    createdProductIds.push(product.id);

    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-SHRINK-${tag}`,
        name: `Product Shrink Customer ${tag}`,
      })
      .returning({ id: customers.id });
    createdCustomerIds.push(customer.id);

    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        customerId: customer.id,
        biocharProductId: product.id,
        code: `OR-SHRINK-${tag}`,
        orderDate: new Date("2026-07-05T00:00:00Z"),
        quantityKg: SHRINK_PRODUCT_DELIVERED_MASS_KG,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    createdOrderIds.push(order.id);

    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        storageLocationId: productBin.id,
        code: `DL-SHRINK-${tag}`,
        deliveryDate: new Date("2026-07-06T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: SHRINK_PRODUCT_DELIVERED_MASS_KG,
      })
      .returning({ id: deliveries.id });
    createdDeliveryIds.push(delivery.id);

    await expect(
      updateBiocharProduct(makeTestOrgContext(), product.id, {
        massKg: SHRINK_PRODUCT_TARGET_MASS_KG,
      }),
    ).rejects.toThrow("Not enough biochar in this product");

    const [persisted] = await db
      .select({ massKg: biocharProducts.massKg })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, product.id));
    expect(persisted.massKg).toBe(SHRINK_PRODUCT_INITIAL_MASS_KG);
  });

  it("rejects raising a formulation ratio above linked biochar stock", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-RATIO-${tag}`,
        name: `Formulation Ratio Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `R-RATIO-${tag}`,
        identifier: `Formulation Ratio Reactor ${tag}`,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    createdReactorIds.push(reactor.id);

    const [biocharBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-RATIO-${tag}`,
        name: `Formulation Ratio Bin ${tag}`,
        type: "biochar_bin",
      })
      .returning({ id: storageLocations.id });
    createdStorageLocationIds.push(biocharBin.id);

    const [run] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        reactorId: reactor.id,
        biocharStorageLocationId: biocharBin.id,
        code: `PR-RATIO-${tag}`,
        status: "complete",
        startTime: new Date("2026-06-01T08:00:00Z"),
        endTime: new Date("2026-06-01T12:00:00Z"),
        biocharOutputKg: FORMULATION_RUN_OUTPUT_KG,
      })
      .returning({ id: productionRuns.id });
    createdProductionRunIds.push(run.id);

    const [formulation] = await db
      .insert(formulations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FM-RATIO-${tag}`,
        name: `Formulation Ratio ${tag}`,
        biocharRatio: FORMULATION_INITIAL_RATIO,
      })
      .returning({ id: formulations.id });
    createdFormulationIds.push(formulation.id);

    const products = await db
      .insert(biocharProducts)
      .values(
        Array.from({ length: FORMULATION_PRODUCT_COUNT }, (_, index) => ({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          linkedProductionRunId: run.id,
          formulationId: formulation.id,
          code: `BP-RATIO-${tag}-${index}`,
          massKg: FORMULATION_PRODUCT_MASS_KG,
        })),
      )
      .returning({ id: biocharProducts.id });
    createdProductIds.push(...products.map((product) => product.id));

    await expect(
      updateFormulation(makeTestOrgContext(), formulation.id, {
        biocharRatio: FORMULATION_TARGET_RATIO,
      }),
    ).rejects.toThrow("Not enough biochar in this bin");

    const [persisted] = await db
      .select({ biocharRatio: formulations.biocharRatio })
      .from(formulations)
      .where(eq(formulations.id, formulation.id));
    expect(persisted.biocharRatio).toBe(FORMULATION_INITIAL_RATIO);
  });

  it("rejects reducing a production run below its allocated biochar mass", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-RUN-OUTPUT-${tag}`,
        name: `Run Output Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `R-RUN-OUTPUT-${tag}`,
        identifier: `Run Output Reactor ${tag}`,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    createdReactorIds.push(reactor.id);

    const [biocharBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-RUN-OUTPUT-${tag}`,
        name: `Run Output Bin ${tag}`,
        type: "biochar_bin",
      })
      .returning({ id: storageLocations.id });
    createdStorageLocationIds.push(biocharBin.id);

    const [run] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        reactorId: reactor.id,
        biocharStorageLocationId: biocharBin.id,
        code: `PR-RUN-OUTPUT-${tag}`,
        status: "complete",
        startTime: new Date("2026-06-02T08:00:00Z"),
        endTime: new Date("2026-06-02T12:00:00Z"),
        biocharOutputKg: RUN_INITIAL_OUTPUT_KG,
      })
      .returning({ id: productionRuns.id });
    createdProductionRunIds.push(run.id);

    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        linkedProductionRunId: run.id,
        code: `BP-RUN-OUTPUT-${tag}`,
        massKg: RUN_LINKED_PRODUCT_MASS_KG,
      })
      .returning({ id: biocharProducts.id });
    createdProductIds.push(product.id);

    await expect(
      updateProductionRun(makeTestOrgContext(), run.id, {
        biocharOutputKg: RUN_TARGET_OUTPUT_KG,
      }),
    ).rejects.toThrow("Not enough biochar in this bin");

    const [persisted] = await db
      .select({ biocharOutputKg: productionRuns.biocharOutputKg })
      .from(productionRuns)
      .where(eq(productionRuns.id, run.id));
    expect(persisted.biocharOutputKg).toBe(RUN_INITIAL_OUTPUT_KG);
  });
});
