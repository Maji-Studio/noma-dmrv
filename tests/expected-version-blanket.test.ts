/**
 * Expected-version check, blanket rule (decision 2026-09-17, issue #768).
 *
 * Every updater that backs an edit form refuses a save whose
 * `expectedUpdatedAt` no longer matches the locked row, and still saves when
 * the payload carries no version. One table drives all nine updaters so a new
 * edit form cannot silently opt out. Deeper per-entity semantics (metadata vs
 * mass edits) stay in `expected-version-conflicts.test.ts`.
 *
 * Runs against the real database: the guard lives inside each updater's
 * transaction. Every fixture owns a unique organization and deletes it again.
 */

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql, type ColumnBaseConfig } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  customerLocations,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  feedstocks,
  formulations,
  orders,
  organizations,
  productionRuns,
  reactors,
  storageLocations,
  supplierLocations,
  suppliers,
  users,
} from "@/db/schema";
import {
  createApplication,
  updateApplication,
} from "@/data-access/applications";
import {
  updateCustomer,
  updateCustomerLocation,
} from "@/data-access/customers";
import { updateFacility } from "@/data-access/facility-mutations";
import { updateFeedstock } from "@/data-access/feedstocks";
import { updateProductionRun } from "@/data-access/production-runs";
import { updateStorageLocation } from "@/data-access/storage-locations";
import {
  updateSupplier,
  updateSupplierLocation,
} from "@/data-access/suppliers";
import type { OrgContext } from "@/lib/auth/server";
import {
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
} from "@/lib/stale-version";
import {
  deleteOutputApplicationFixtures,
  deleteOutputDeliveryFixtures,
  deleteOutputFacilityFixtures,
  deleteOutputProductFixtures,
  insertOutputDeliveryFixture,
  outputOrderFixtureValues,
  outputProductFixtureValues,
} from "./helpers/output-contract-fixtures";

const ORG_PREFIX = "e2e-expected-version-blanket-org-";
const RUN_START = new Date("2025-06-15T08:00:00Z");
const RUN_END = new Date("2025-06-15T12:00:00Z");
const RUN_DRY_OUTPUT_KG = 1_000;
const ORDER_DATE = new Date("2025-07-01");
const DELIVERY_DATE = new Date("2025-07-05");
const APPLICATION_DATE = new Date("2025-07-08");
const ORDER_QUANTITY_KG = 10_000;
const DELIVERED_WET_KG = 5_000;
const DELIVERED_DRY_KG = 4_000;
const DELIVERY_MOISTURE_PERCENT = 20;
const APPLIED_TONS = 2;
const FIELD_SIZE_HA = 1;
const BIN_CAPACITY_KG = 10_000;
const INTAKE_WET_KG = 100;
const INTAKE_DRY_KG = 80;
const INTAKE_MOISTURE_PERCENT = 20;
const FIRST_FEEDING_RATE = 50;
const SECOND_FEEDING_RATE = 60;
const GPS = { lat: -3.3, lng: 37.3 } as const;

interface Fixture {
  tag: string;
  ctx: OrgContext;
  ids: Record<EntityKey, string>;
}

type EntityKey =
  | "facility"
  | "feedstock"
  | "storageLocation"
  | "customer"
  | "customerLocation"
  | "supplier"
  | "supplierLocation"
  | "productionRun"
  | "application";

/** One row per updater: how to read its version and how to save a small edit. */
interface UpdaterCase {
  entity: EntityKey;
  readUpdatedAt: (id: string) => Promise<Date>;
  /** Save `label` into a harmless text-like field, passing the version. */
  save: (
    f: Fixture,
    id: string,
    label: string,
    expectedUpdatedAt: Date | undefined,
  ) => Promise<unknown>;
}

/** Any table whose row versions the check compares. */
type VersionedTable = PgTable & {
  id: PgColumn<{ data: string } & ColumnBaseConfig<"string", string>>;
  updatedAt: PgColumn<{ data: Date } & ColumnBaseConfig<"date", string>>;
};

const versionOf = (table: VersionedTable) => async (id: string): Promise<Date> => {
  const [row] = await db
    .select({ updatedAt: table.updatedAt })
    .from(table)
    .where(eq(table.id, id));
  if (!row?.updatedAt) throw new Error("Fixture row or its version is missing");
  return row.updatedAt;
};

const UPDATERS: UpdaterCase[] = [
  {
    entity: "facility",
    readUpdatedAt: versionOf(facilities),
    save: (f, id, label, expectedUpdatedAt) =>
      updateFacility(f.ctx, id, { location: label, expectedUpdatedAt }),
  },
  {
    entity: "feedstock",
    readUpdatedAt: versionOf(feedstocks),
    save: (f, id, label, expectedUpdatedAt) =>
      updateFeedstock(f.ctx, id, { notes: label, expectedUpdatedAt }),
  },
  {
    entity: "storageLocation",
    readUpdatedAt: versionOf(storageLocations),
    save: (f, id, label, expectedUpdatedAt) =>
      updateStorageLocation(f.ctx, id, {
        storageDescription: label,
        expectedUpdatedAt,
      }),
  },
  {
    entity: "customer",
    readUpdatedAt: versionOf(customers),
    save: (f, id, label, expectedUpdatedAt) =>
      updateCustomer(f.ctx, id, { address: label, expectedUpdatedAt }),
  },
  {
    entity: "customerLocation",
    readUpdatedAt: versionOf(customerLocations),
    save: (f, id, label, expectedUpdatedAt) =>
      updateCustomerLocation(f.ctx, id, { address: label, expectedUpdatedAt }),
  },
  {
    entity: "supplier",
    readUpdatedAt: versionOf(suppliers),
    save: (f, id, label, expectedUpdatedAt) =>
      updateSupplier(f.ctx, id, { address: label, expectedUpdatedAt }),
  },
  {
    entity: "supplierLocation",
    readUpdatedAt: versionOf(supplierLocations),
    save: (f, id, label, expectedUpdatedAt) =>
      updateSupplierLocation(f.ctx, id, { address: label, expectedUpdatedAt }),
  },
  {
    entity: "productionRun",
    readUpdatedAt: versionOf(productionRuns),
    save: (f, id, label, expectedUpdatedAt) =>
      updateProductionRun(f.ctx, id, {
        feedingRateKgHr:
          label.endsWith("first") ? FIRST_FEEDING_RATE : SECOND_FEEDING_RATE,
        expectedUpdatedAt,
      }),
  },
  {
    entity: "application",
    readUpdatedAt: versionOf(applications),
    save: (f, id, label, expectedUpdatedAt) =>
      updateApplication(f.ctx, id, { fieldIdentifier: label, expectedUpdatedAt }),
  },
];

async function seedFixture(): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const organizationId = `${ORG_PREFIX}${tag}`;
  const userId = `e2e-expected-version-blanket-user-${tag}`;
  const ctx: OrgContext = {
    organizationId,
    userId,
    orgRole: "owner",
    isPlatformAdmin: false,
  };

  const seeded = await db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: organizationId,
      name: `E2E Expected version blanket ${tag}`,
      slug: `e2e-expected-version-blanket-${tag.toLowerCase()}`,
    });
    await tx.insert(users).values({
      id: userId,
      name: "E2E expected version blanket operator",
      email: `expected-version-blanket-${tag.toLowerCase()}@e2e.local`,
      emailVerified: true,
    });

    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId,
        code: `E2E-EXVB-F-${tag}`,
        name: `E2E Expected version blanket ${tag}`,
        country: "Tanzania",
      })
      .returning({ id: facilities.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId,
        code: `E2E-EXVB-T-${tag}`,
        name: `E2E Expected version blanket type ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });

    const [bin] = await tx
      .insert(storageLocations)
      .values({
        organizationId,
        facilityId: facility.id,
        code: `E2E-EXVB-B-${tag}`,
        name: `E2E Expected version blanket bin ${tag}`,
        type: "feedstock_bin",
        feedstockTypeId: feedstockType.id,
        capacityKg: BIN_CAPACITY_KG,
      })
      .returning({ id: storageLocations.id });

    const [feedstock] = await tx
      .insert(feedstocks)
      .values({
        organizationId,
        code: `E2E-EXVB-FS-${tag}`,
        facilityId: facility.id,
        status: "complete",
        feedstockTypeId: feedstockType.id,
        massDryKg: INTAKE_DRY_KG,
        massWetKg: INTAKE_WET_KG,
        moistureContentPercent: INTAKE_MOISTURE_PERCENT,
        storageLocationId: bin.id,
      })
      .returning({ id: feedstocks.id });

    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId,
        code: `E2E-EXVB-CU-${tag}`,
        name: `E2E Expected version blanket customer ${tag}`,
      })
      .returning({ id: customers.id });

    const [customerLocation] = await tx
      .insert(customerLocations)
      .values({
        organizationId,
        customerId: customer.id,
        name: `E2E Expected version blanket field ${tag}`,
        country: "Tanzania",
        gpsLatitude: GPS.lat,
        gpsLongitude: GPS.lng,
      })
      .returning({ id: customerLocations.id });

    const [supplier] = await tx
      .insert(suppliers)
      .values({
        organizationId,
        code: `E2E-EXVB-SU-${tag}`,
        name: `E2E Expected version blanket supplier ${tag}`,
      })
      .returning({ id: suppliers.id });

    const [supplierLocation] = await tx
      .insert(supplierLocations)
      .values({
        organizationId,
        supplierId: supplier.id,
        name: `E2E Expected version blanket yard ${tag}`,
        country: "Tanzania",
        gpsLatitude: GPS.lat,
        gpsLongitude: GPS.lng,
        isDefault: true,
      })
      .returning({ id: supplierLocations.id });

    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId,
        code: `E2E-EXVB-RE-${tag}`,
        facilityId: facility.id,
        identifier: `E2E Expected version blanket reactor ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });

    const [productionRun] = await tx
      .insert(productionRuns)
      .values({
        organizationId,
        code: `E2E-EXVB-PR-${tag}`,
        facilityId: facility.id,
        reactorId: reactor.id,
        startTime: RUN_START,
        endTime: RUN_END,
        biocharDryMassKg: RUN_DRY_OUTPUT_KG,
      })
      .returning({ id: productionRuns.id });

    const [formulation] = await tx
      .insert(formulations)
      .values({
        organizationId,
        code: `E2E-EXVB-FM-${tag}`,
        name: `E2E Expected version blanket formulation ${tag}`,
      })
      .returning({ id: formulations.id });

    const [product] = await tx
      .insert(biocharProducts)
      .values(
        await outputProductFixtureValues(tx, {
          organizationId,
          code: `E2E-EXVB-BP-${tag}`,
          facilityId: facility.id,
          formulationId: formulation.id,
        }),
      )
      .returning({ id: biocharProducts.id });

    const [order] = await tx
      .insert(orders)
      .values(
        await outputOrderFixtureValues(tx, {
          organizationId,
          code: `E2E-EXVB-OR-${tag}`,
          facilityId: facility.id,
          biocharProductId: product.id,
          customerId: customer.id,
          customerLocationId: customerLocation.id,
          orderDate: ORDER_DATE,
          quantityKg: ORDER_QUANTITY_KG,
          packaging: "bagged",
        }),
      )
      .returning({ id: orders.id });

    const [delivery] = await insertOutputDeliveryFixture(
      tx,
      {
        organizationId,
        code: `E2E-EXVB-DL-${tag}`,
        facilityId: facility.id,
        orderId: order.id,
        status: "delivered",
        deliveryDate: DELIVERY_DATE,
        deliveredWetMassKg: DELIVERED_WET_KG,
        massDryKg: DELIVERED_DRY_KG,
        moistureContentPercent: DELIVERY_MOISTURE_PERCENT,
      },
      (row) => ({ id: row.id }),
    );

    return {
      facilityId: facility.id,
      feedstockId: feedstock.id,
      binId: bin.id,
      customerId: customer.id,
      customerLocationId: customerLocation.id,
      supplierId: supplier.id,
      supplierLocationId: supplierLocation.id,
      productionRunId: productionRun.id,
      deliveryId: delivery.id,
    };
  });

  // The creator writes the application's source allocations, which the updater
  // re-validates; a raw insert would fail that check.
  const application = await createApplication(ctx, {
    code: `E2E-EXVB-AP-${tag}`,
    deliveryId: seeded.deliveryId,
    applicationDate: APPLICATION_DATE,
    biocharAppliedTons: APPLIED_TONS,
    fieldSizeHa: FIELD_SIZE_HA,
    gpsLatitude: GPS.lat,
    gpsLongitude: GPS.lng,
  });

  const ids: Record<EntityKey, string> = {
    facility: seeded.facilityId,
    feedstock: seeded.feedstockId,
    storageLocation: seeded.binId,
    customer: seeded.customerId,
    customerLocation: seeded.customerLocationId,
    supplier: seeded.supplierId,
    supplierLocation: seeded.supplierLocationId,
    productionRun: seeded.productionRunId,
    application: application.id,
  };

  return { tag, ctx, ids };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId, userId } = fixture.ctx;
  if (!organizationId.startsWith(ORG_PREFIX)) {
    throw new Error("Expected an isolated expected-version test organization");
  }
  await db.transaction(async (tx) => {
    await deleteOutputApplicationFixtures(
      tx,
      eq(applications.organizationId, organizationId),
    );
    await deleteOutputDeliveryFixtures(
      tx,
      eq(deliveries.organizationId, organizationId),
    );
    await tx.delete(orders).where(eq(orders.organizationId, organizationId));
    await deleteOutputProductFixtures(
      tx,
      eq(biocharProducts.organizationId, organizationId),
    );
    for (const table of [
      "bin_movements",
      "transport_legs",
      "feedstocks",
      "production_runs",
      "reactors",
      "storage_locations",
      "formulations",
      "feedstock_types",
      "customer_locations",
      "customers",
      "supplier_locations",
      "suppliers",
    ]) {
      await tx.execute(
        sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`,
      );
    }
    await deleteOutputFacilityFixtures(
      tx,
      eq(facilities.organizationId, organizationId),
    );
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

const fixtures: Fixture[] = [];
async function fixture(): Promise<Fixture> {
  const created = await seedFixture();
  fixtures.push(created);
  return created;
}
afterEach(async () => {
  for (const created of fixtures.splice(0)) await cleanup(created);
});

describe.each(UPDATERS)("$entity saves carry an expected version", (updater) => {
  it("refuses the second of two snapshots taken from the same read", async () => {
    const f = await fixture();
    const id = f.ids[updater.entity];
    const opened = await updater.readUpdatedAt(id);

    await updater.save(f, id, `${f.tag} first`, opened);
    const afterFirst = await updater.readUpdatedAt(id);
    expect(afterFirst.getTime()).not.toBe(opened.getTime());

    await expect(
      updater.save(f, id, `${f.tag} second`, opened),
    ).rejects.toMatchObject({
      name: "ActionConflictError",
      message: STALE_VERSION_MESSAGE,
      conflict: { entity: updater.entity, id, code: STALE_VERSION_CONFLICT_CODE },
    });

    expect((await updater.readUpdatedAt(id)).getTime()).toBe(afterFirst.getTime());
  });

  it("still saves when the payload carries no expected version", async () => {
    const f = await fixture();
    const id = f.ids[updater.entity];
    const opened = await updater.readUpdatedAt(id);

    await updater.save(f, id, `${f.tag} first`, opened);
    await updater.save(f, id, `${f.tag} second`, undefined);

    expect((await updater.readUpdatedAt(id)).getTime()).not.toBe(opened.getTime());
  });
});
