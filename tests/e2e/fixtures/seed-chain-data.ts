/**
 * Seed Chain Data
 *
 * Seeds all prerequisite "lookup" entities needed for UI CRUD tests.
 * These entities populate form dropdowns so users can create the core chain
 * (Facility → Reactor → Production Run → Sample → Order → Delivery → Application → Credit Batch)
 * through the browser UI.
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import * as crypto from "crypto";
import { createDbConnection } from "./db";

const SEEDED_CREDIT_BATCH_CODE_PREFIX = "E2E-CB";
const SEEDED_CREDIT_BATCH_DURATION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEEDED_H_TO_CORG_RATIO = 0.4;

export interface SeededChainData {
  facility: { id: string; code: string; name: string };
  reactor: { id: string; code: string; identifier: string };
  supplier: { id: string; code: string; name: string };
  feedstockType: { id: string; code: string; name: string };
  customer: { id: string; code: string; name: string };
  customerLocation: { id: string; name: string; customerId: string };
  formulation: { id: string; code: string; name: string };
  biocharProduct: { id: string; code: string };
  feedstockStorageLocation: { id: string; code: string; name: string };
  biocharStorageLocation: { id: string; code: string; name: string };
  vehicle: { id: string; code: string; name: string };
  feedstockDelivery: { id: string; code: string };
  feedstock: { id: string; code: string };
}

/**
 * Seed all prerequisite entities for UI CRUD tests.
 * Returns IDs so tests can reference them (e.g., to verify dropdown selections).
 */
export async function seedChainData(
  testRunId: string
): Promise<SeededChainData> {
  const { db, pool } = createDbConnection();

  try {
    const facilityId = crypto.randomUUID();
    const reactorId = crypto.randomUUID();
    const supplierId = crypto.randomUUID();
    const feedstockTypeId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const customerLocationId = crypto.randomUUID();
    const formulationId = crypto.randomUUID();
    const biocharProductId = crypto.randomUUID();
    const feedstockStorageId = crypto.randomUUID();
    const biocharStorageId = crypto.randomUUID();
    const vehicleId = crypto.randomUUID();
    const feedstockDeliveryId = crypto.randomUUID();
    const feedstockId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      // 1. Facility (needed by storage locations, biochar product, orders, etc.)
      await tx.insert(schema.facilities).values({
        id: facilityId,
        code: `E2E-FAC-${testRunId}`,
        name: `E2E Seed Facility ${testRunId}`,
        country: "Tanzania",
        location: "Dar es Salaam",
        // Dodoma stub-geocode fixture coords — gives CALC a facility endpoint
        // and makes stub reverse-geocode/route-distance assertions exact.
        gpsLatitude: -6.163,
        gpsLongitude: 35.7516,
      });

      // 2. Reactor (needs facility)
      await tx.insert(schema.reactors).values({
        id: reactorId,
        code: `E2E-RCT-${testRunId}`,
        identifier: `E2E Seed Reactor ${testRunId}`,
        facilityId: facilityId,
        reactorType: "fixed-bed",
      });

      // 3. Supplier
      await tx.insert(schema.suppliers).values({
        id: supplierId,
        code: `E2E-SUP-${testRunId}`,
        name: `E2E Seed Supplier ${testRunId}`,
        gpsLatitude: -6.8,
        gpsLongitude: 39.28,
      });

      // 3. Feedstock Type
      await tx.insert(schema.feedstockTypes).values({
        id: feedstockTypeId,
        code: `E2E-FST-${testRunId}`,
        name: `E2E Seed Feedstock Type ${testRunId}`,
        category: "forestry",
      });

      // 4. Customer
      await tx.insert(schema.customers).values({
        id: customerId,
        code: `E2E-CUST-${testRunId}`,
        name: `E2E Seed Customer ${testRunId}`,
      });

      // 5. Customer Location (needs customer). The stored distance lets the
      // app derive a biochar distribution leg when a test records a delivery
      // to this location.
      await tx.insert(schema.customerLocations).values({
        id: customerLocationId,
        customerId: customerId,
        name: `E2E Seed Location ${testRunId}`,
        country: "Tanzania",
        address: "123 Farm Road, Dar es Salaam",
        gpsLatitude: -6.8,
        gpsLongitude: 39.28,
        distanceFromFacilityKm: 25,
        distanceSource: "manual",
      });

      // 6. Formulation
      await tx.insert(schema.formulations).values({
        id: formulationId,
        code: `E2E-FORM-${testRunId}`,
        name: `E2E Seed Formulation ${testRunId}`,
        biocharRatio: 0.7,
      });

      // 7. Storage Locations (need facility)
      await tx.insert(schema.storageLocations).values({
        id: feedstockStorageId,
        code: `E2E-SL-FS-${testRunId}`,
        name: `E2E Feedstock Bin ${testRunId}`,
        type: "feedstock_bin",
        facilityId: facilityId,
        feedstockTypeId: feedstockTypeId,
      });

      await tx.insert(schema.storageLocations).values({
        id: biocharStorageId,
        code: `E2E-SL-BC-${testRunId}`,
        name: `E2E Biochar Pile ${testRunId}`,
        type: "biochar_bin",
        facilityId: facilityId,
      });

      // 8. Biochar Product (needs facility + formulation)
      const productionDate = new Date();
      const expiresAt = new Date(productionDate);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await tx.insert(schema.biocharProducts).values({
        id: biocharProductId,
        code: `E2E-BP-${testRunId}`,
        facilityId: facilityId,
        formulationId: formulationId,
        status: "ready",
        massKg: 500,
        productionDate,
        expiresAt,
      });

      // 9. Vehicle
      await tx.insert(schema.vehicles).values({
        id: vehicleId,
        code: `E2E-VEH-${testRunId}`,
        name: `E2E Seed Vehicle ${testRunId}`,
        identifier: `TZ-${testRunId}`,
        vehicleType: "truck",
        fuelType: "diesel",
        fuelConsumptionLPerKm: 0.25,
        modelYear: 2022,
      });

      // 10. Feedstock Delivery (needs facility + supplier)
      const deliveryDate = new Date();
      await tx.insert(schema.feedstockDeliveries).values({
        id: feedstockDeliveryId,
        code: `E2E-FSD-${testRunId}`,
        facilityId: facilityId,
        supplierId: supplierId,
        deliveryDate,
        feedstockTypeId: feedstockTypeId,
      });

      // 11. Feedstock (needs facility + delivery + type)
      await tx.insert(schema.feedstocks).values({
        id: feedstockId,
        code: `E2E-FS-${testRunId}`,
        facilityId: facilityId,
        feedstockDeliveryId: feedstockDeliveryId,
        // Delivery fields (absorbed from feedstock_deliveries)
        deliveryDate,
        supplierId: supplierId,
        // Material fields
        feedstockTypeId: feedstockTypeId,
        massDryKg: 100,
        massWetKg: 120,
        moistureContentPercent: 16.7,
        storageLocationId: feedstockStorageId,
      });
    });

    return {
      facility: { id: facilityId, code: `E2E-FAC-${testRunId}`, name: `E2E Seed Facility ${testRunId}` },
      reactor: { id: reactorId, code: `E2E-RCT-${testRunId}`, identifier: `E2E Seed Reactor ${testRunId}` },
      supplier: { id: supplierId, code: `E2E-SUP-${testRunId}`, name: `E2E Seed Supplier ${testRunId}` },
      feedstockType: { id: feedstockTypeId, code: `E2E-FST-${testRunId}`, name: `E2E Seed Feedstock Type ${testRunId}` },
      customer: { id: customerId, code: `E2E-CUST-${testRunId}`, name: `E2E Seed Customer ${testRunId}` },
      customerLocation: { id: customerLocationId, name: `E2E Seed Location ${testRunId}`, customerId },
      formulation: { id: formulationId, code: `E2E-FORM-${testRunId}`, name: `E2E Seed Formulation ${testRunId}` },
      biocharProduct: { id: biocharProductId, code: `E2E-BP-${testRunId}` },
      feedstockStorageLocation: { id: feedstockStorageId, code: `E2E-SL-FS-${testRunId}`, name: `E2E Feedstock Bin ${testRunId}` },
      biocharStorageLocation: { id: biocharStorageId, code: `E2E-SL-BC-${testRunId}`, name: `E2E Biochar Pile ${testRunId}` },
      vehicle: { id: vehicleId, code: `E2E-VEH-${testRunId}`, name: `E2E Seed Vehicle ${testRunId}` },
      feedstockDelivery: { id: feedstockDeliveryId, code: `E2E-FSD-${testRunId}` },
      feedstock: { id: feedstockId, code: `E2E-FS-${testRunId}` },
    };
  } finally {
    await pool.end();
  }
}

/**
 * Insert a minimal credit batch on a seeded facility. Used by the
 * Phase 3 Certify-panel rendering spec, which only needs the batch to
 * exist (no linked applications). Uses a code prefix that global teardown
 * can match if a test aborts mid-run.
 */
export async function seedCreditBatch(
  facilityId: string,
  testRunId: string,
  feedstockTypeId: string
): Promise<{ id: string; code: string }> {
  const { db, pool } = createDbConnection();
  try {
    const id = crypto.randomUUID();
    const productionProcessId = crypto.randomUUID();
    const code = `${SEEDED_CREDIT_BATCH_CODE_PREFIX}-${testRunId}`;
    const now = new Date();
    const start = now.toISOString().slice(0, 10);
    const end = new Date(
      now.getTime() + SEEDED_CREDIT_BATCH_DURATION_DAYS * MS_PER_DAY,
    )
      .toISOString()
      .slice(0, 10);
    await db.insert(schema.productionProcesses).values({
      id: productionProcessId,
      facilityId,
      feedstockTypeId,
    });

    await db.insert(schema.creditBatches).values({
      id,
      code,
      facilityId,
      // ADR 0016: a credit batch is the protocol production batch — single
      // feedstock (NOT NULL). The spec only needs the batch to exist, so any
      // feedstock type on the facility's seeded chain satisfies the column.
      feedstockTypeId,
      productionProcessId,
      startDate: start,
      endDate: end,
      // Default durabilityOption='200_year' has a CHECK constraint
      // (credit_batches_200_year_requires_h_to_corg) that requires this
      // field. Any non-null value satisfies it; the spec doesn't depend
      // on the actual durability calculation.
      hToCorgRatio: SEEDED_H_TO_CORG_RATIO,
    });
    return { id, code };
  } finally {
    await pool.end();
  }
}

/**
 * Clean up all seeded chain data in FK-safe order.
 */
export async function cleanupChainData(data: SeededChainData): Promise<void> {
  const { db, pool } = createDbConnection();

  try {
    await db.transaction(async (tx) => {
      // Delete in reverse dependency order
      // First, clean up UI-created entities that reference seeded data

      // Find and delete credit batch membership linked to facility-scoped credit batches
      const facilityBatches = await tx
        .select({ id: schema.creditBatches.id })
        .from(schema.creditBatches)
        .where(eq(schema.creditBatches.facilityId, data.facility.id));
      if (facilityBatches.length > 0) {
        const batchIds = facilityBatches.map((b) => b.id);
        // Certifier sync events and submissions reference credit batches by
        // uuid (no FK constraint), but stale rows would accumulate across
        // test runs. Sweep them first so the spec is idempotent.
        await tx
          .delete(schema.certifierSyncEvents)
          .where(
            inArray(schema.certifierSyncEvents.entityId, batchIds)
          );
        await tx
          .delete(schema.certificationSubmissions)
          .where(
            inArray(
              schema.certificationSubmissions.localEntityId,
              batchIds
            )
          );
        await tx
          .delete(schema.creditBatchProductionRuns)
          .where(
            inArray(
              schema.creditBatchProductionRuns.creditBatchId,
              batchIds
            )
          );
        await tx
          .delete(schema.creditBatches)
          .where(eq(schema.creditBatches.facilityId, data.facility.id));
      }
      await tx
        .delete(schema.productionProcesses)
        .where(eq(schema.productionProcesses.facilityId, data.facility.id));

      // Find and delete applications linked to facility-scoped deliveries
      const facilityDeliveries = await tx
        .select({ id: schema.deliveries.id })
        .from(schema.deliveries)
        .where(eq(schema.deliveries.facilityId, data.facility.id));
      if (facilityDeliveries.length > 0) {
        await tx
          .delete(schema.applications)
          .where(
            inArray(
              schema.applications.deliveryId,
              facilityDeliveries.map((delivery) => delivery.id)
            )
          );
        await tx
          .delete(schema.deliveries)
          .where(eq(schema.deliveries.facilityId, data.facility.id));
      }

      const facilityOrders = await tx
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.facilityId, data.facility.id));
      if (facilityOrders.length > 0) {
        await tx
          .delete(schema.orders)
          .where(eq(schema.orders.facilityId, data.facility.id));
      }

      // Delete storage inventory records before biochar products (FK dependency)
      const facilityBiocharProducts = await tx
        .select({ id: schema.biocharProducts.id })
        .from(schema.biocharProducts)
        .where(eq(schema.biocharProducts.facilityId, data.facility.id));
      if (facilityBiocharProducts.length > 0) {
        await tx
          .delete(schema.biocharStorageInventory)
          .where(
            inArray(
              schema.biocharStorageInventory.biocharProductId,
              facilityBiocharProducts.map((p) => p.id)
            )
          );
      }

      // Delete biochar products before production runs because products can
      // retain linkedProductionRunId references to UI-created runs.
      await tx
        .update(schema.biocharProducts)
        .set({ linkedProductionRunId: null })
        .where(eq(schema.biocharProducts.facilityId, data.facility.id));
      await tx
        .delete(schema.biocharProducts)
        .where(eq(schema.biocharProducts.facilityId, data.facility.id));

      // Clean up UI-created production run feedstocks and production runs
      const facilityReactors = await tx
        .select({ id: schema.reactors.id })
        .from(schema.reactors)
        .where(eq(schema.reactors.facilityId, data.facility.id));
      if (facilityReactors.length > 0) {
        const facilityRuns = await tx
          .select({ id: schema.productionRuns.id })
          .from(schema.productionRuns)
          .where(
            inArray(
              schema.productionRuns.reactorId,
              facilityReactors.map((r) => r.id)
            )
          );
        if (facilityRuns.length > 0) {
          const facilityRunIds = facilityRuns.map((r) => r.id);
          await tx
            .delete(schema.documents)
            .where(
              and(
                eq(schema.documents.entityType, "production_run"),
                inArray(schema.documents.entityId, facilityRunIds)
              )
            );
          await tx
            .delete(schema.productionRunReadings)
            .where(
              inArray(
                schema.productionRunReadings.productionRunId,
                facilityRunIds
              )
            );
          // Delete samples linked to production runs
          await tx
            .delete(schema.samples)
            .where(
              inArray(
                schema.samples.productionRunId,
                facilityRunIds
              )
            );
          // Delete in-process production samples linked to production runs
          await tx
            .delete(schema.productionSamples)
            .where(
              inArray(
                schema.productionSamples.productionRunId,
                facilityRunIds
              )
            );
          // Delete production run feedstocks
          await tx
            .delete(schema.productionRunFeedstocks)
            .where(
              inArray(
                schema.productionRunFeedstocks.productionRunId,
                facilityRunIds
              )
            );
          await tx
            .delete(schema.productionRuns)
            .where(
              inArray(
                schema.productionRuns.reactorId,
                facilityReactors.map((r) => r.id)
              )
            );
        }
        // Delete UI-created reactors (beyond the seeded one)
        await tx
          .delete(schema.reactors)
          .where(eq(schema.reactors.facilityId, data.facility.id));
      }

      // Now delete seeded entities in reverse dependency order

      // Feedstocks
      // Delete all facility-scoped feedstocks because UI tests can create
      // additional rows that still point at the seeded storage locations.
      await tx
        .delete(schema.feedstocks)
        .where(eq(schema.feedstocks.facilityId, data.facility.id));

      // Feedstock deliveries
      await tx
        .delete(schema.feedstockDeliveries)
        .where(eq(schema.feedstockDeliveries.facilityId, data.facility.id));

      // Vehicles
      await tx
        .delete(schema.vehicles)
        .where(eq(schema.vehicles.id, data.vehicle.id));

      // Customer locations
      await tx
        .delete(schema.customerLocations)
        .where(eq(schema.customerLocations.id, data.customerLocation.id));

      // Storage locations
      await tx
        .delete(schema.storageLocations)
        .where(
          inArray(schema.storageLocations.id, [
            data.feedstockStorageLocation.id,
            data.biocharStorageLocation.id,
          ])
        );

      // Feedstock types
      await tx
        .delete(schema.feedstockTypes)
        .where(eq(schema.feedstockTypes.id, data.feedstockType.id));

      // Formulations
      await tx
        .delete(schema.formulations)
        .where(eq(schema.formulations.id, data.formulation.id));

      // Customers
      await tx
        .delete(schema.customers)
        .where(eq(schema.customers.id, data.customer.id));

      // Suppliers
      await tx
        .delete(schema.suppliers)
        .where(eq(schema.suppliers.id, data.supplier.id));

      // Certifier rows FK to facility — must clear before the facility delete
      // or PG raises "violates foreign key constraint". Removals must go before
      // ghg_statements (removal.ghg_statement_id FKs it).
      await tx
        .delete(schema.certifierRemovals)
        .where(eq(schema.certifierRemovals.facilityId, data.facility.id));
      await tx
        .delete(schema.certifierGhgStatements)
        .where(eq(schema.certifierGhgStatements.facilityId, data.facility.id));
      await tx
        .delete(schema.certifierProjects)
        .where(eq(schema.certifierProjects.facilityId, data.facility.id));

      // Facility (must be last — everything references it)
      await tx
        .delete(schema.facilities)
        .where(eq(schema.facilities.id, data.facility.id));
    });
  } finally {
    await pool.end();
  }
}
