import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { organizations } from "@/db/schema/auth";
import { certifierProjects, certifierSyncEvents } from "@/db/schema/certification";
import { certifierStorageLocations } from "@/db/schema/certifier-storage-locations";
import { facilities } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations, customers } from "@/db/schema/parties";
import { biocharProducts, formulations } from "@/db/schema/products";
import {
  getStorageLocationRegistration,
  getStorageLocationRegistryInput,
  persistStorageLocationRegistration,
} from "@/data-access/certifier-storage-locations";
import {
  appendSyncEvent,
  deleteCertifierProject,
  listRecentSyncEvents,
  upsertCertifierProject,
} from "@/data-access/certification";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import type { OrgContext } from "@/lib/auth/server";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const FOREIGN_ORG_ID = "org_storage_location_foreign";
const FOREIGN_CONTEXT: OrgContext = {
  organizationId: FOREIGN_ORG_ID,
  userId: "user-storage-location-foreign",
  orgRole: "owner",
  isPlatformAdmin: false,
};

interface Fixture {
  applicationId: string;
  customerLocationId: string;
  certifierProjectId: string;
  facilityId: string;
  customerId: string;
  formulationId: string;
  productId: string;
  orderId: string;
  deliveryId: string;
}

async function createFixture(): Promise<Fixture> {
  const runId = crypto.randomUUID().slice(0, 8);
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-SLC-${runId}`,
        name: `Storage Location Customer ${runId}`,
      })
      .returning({ id: customers.id });
    const [customerLocation] = await tx
      .insert(customerLocations)
      .values({
        organizationId: TEST_ORG_ID,
        customerId: customer.id,
        name: `Storage Location Site ${runId}`,
        country: "Tanzania",
        gpsLatitude: -3.25,
        gpsLongitude: 37.42,
      })
      .returning({ id: customerLocations.id });
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-SLC-${runId}`,
        name: `Storage Location Facility ${runId}`,
      })
      .returning({ id: facilities.id });
    const [certifierProject] = await tx
      .insert(certifierProjects)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        provider: "isometric",
        externalProjectId: `prj_slc_${runId}`,
      })
      .returning({ id: certifierProjects.id });
    const [formulation] = await tx
      .insert(formulations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FM-SLC-${runId}`,
        name: `Storage Location Formulation ${runId}`,
      })
      .returning({ id: formulations.id });
    const [product] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        formulationId: formulation.id,
        code: `BP-SLC-${runId}`,
      })
      .returning({ id: biocharProducts.id });
    const [order] = await tx
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        customerId: customer.id,
        customerLocationId: customerLocation.id,
        biocharProductId: product.id,
        code: `OR-SLC-${runId}`,
        orderDate: new Date("2026-08-01T00:00:00Z"),
        quantityKg: 1_000,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    const [delivery] = await tx
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        code: `DL-SLC-${runId}`,
        deliveryDate: new Date("2026-08-02T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: 1_000,
        massDryKg: 900,
      })
      .returning({ id: deliveries.id });
    const [application] = await tx
      .insert(applications)
      .values({
        organizationId: TEST_ORG_ID,
        deliveryId: delivery.id,
        code: `AP-SLC-${runId}`,
        applicationDate: new Date("2026-08-03T00:00:00Z"),
        biocharAppliedTons: 1,
        biocharAppliedDryTons: 0.9,
        fieldSizeHa: 1,
      })
      .returning({ id: applications.id });
    return {
      applicationId: application.id,
      customerLocationId: customerLocation.id,
      certifierProjectId: certifierProject.id,
      facilityId: facility.id,
      customerId: customer.id,
      formulationId: formulation.id,
      productId: product.id,
      orderId: order.id,
      deliveryId: delivery.id,
    };
  });
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(certifierStorageLocations)
      .where(
        and(
          eq(certifierStorageLocations.organizationId, TEST_ORG_ID),
          eq(
            certifierStorageLocations.customerLocationId,
            fixture.customerLocationId,
          ),
        ),
      );
    await tx.delete(applications).where(eq(applications.id, fixture.applicationId));
    await tx.delete(deliveries).where(eq(deliveries.id, fixture.deliveryId));
    await tx.delete(orders).where(eq(orders.id, fixture.orderId));
    await tx.delete(biocharProducts).where(eq(biocharProducts.id, fixture.productId));
    await tx.delete(formulations).where(eq(formulations.id, fixture.formulationId));
    await tx
      .delete(certifierProjects)
      .where(eq(certifierProjects.id, fixture.certifierProjectId));
    await tx
      .delete(customerLocations)
      .where(eq(customerLocations.id, fixture.customerLocationId));
    await tx.delete(customers).where(eq(customers.id, fixture.customerId));
    await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
  });
}

beforeAll(async () => {
  await ensureTestOrg();
  await db
    .insert(organizations)
    .values({
      id: FOREIGN_ORG_ID,
      name: "Storage Location Foreign Org",
      slug: "storage-location-foreign-org",
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, FOREIGN_ORG_ID));
});

describe("certifier Storage Location data access", () => {
  it("resolves only the active organization's application path and project mapping", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        getStorageLocationRegistryInput(
          makeTestOrgContext(),
          fixture.applicationId,
        ),
      ).resolves.toMatchObject({
        applicationId: fixture.applicationId,
        facilityId: fixture.facilityId,
        customerLocationId: fixture.customerLocationId,
        certifierProjectId: fixture.certifierProjectId,
        latitude: -3.25,
        longitude: 37.42,
      });
      await expect(
        getStorageLocationRegistryInput(FOREIGN_CONTEXT, fixture.applicationId),
      ).resolves.toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps confirmed identity immutable under concurrent writers and tenant-isolated", async () => {
    const fixture = await createFixture();
    try {
      const input = await getStorageLocationRegistryInput(
        makeTestOrgContext(),
        fixture.applicationId,
      );
      if (!input?.externalProjectId || !input.name) {
        throw new Error("Storage Location fixture did not resolve");
      }
      const body = buildCreateStorageLocationRequest({
        externalProjectId: input.externalProjectId,
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        supplierReferenceId: "nm-slc-concurrency-a",
      });
      const common = {
        customerLocationId: fixture.customerLocationId,
        certifierProjectId: fixture.certifierProjectId,
        externalProjectId: input.externalProjectId,
      };
      const secondBody = buildCreateStorageLocationRequest({
        externalProjectId: input.externalProjectId,
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        supplierReferenceId: "nm-slc-concurrency-b",
      });
      const [left, right] = await Promise.all([
        persistStorageLocationRegistration(makeTestOrgContext(), {
          ...common,
          externalStorageLocationId: "slc-concurrency-a",
          supplierReference: "nm-slc-concurrency-a",
          submittedPayload: body,
          payloadHash: "payload-hash-a",
        }),
        persistStorageLocationRegistration(makeTestOrgContext(), {
          ...common,
          externalStorageLocationId: "slc-concurrency-b",
          supplierReference: "nm-slc-concurrency-b",
          submittedPayload: secondBody,
          payloadHash: "payload-hash-b",
        }),
      ]);
      expect(right.externalStorageLocationId).toBe(left.externalStorageLocationId);
      expect(right.supplierReference).toBe(left.supplierReference);
      await expect(
        getStorageLocationRegistration(
          FOREIGN_CONTEXT,
          fixture.customerLocationId,
          common.externalProjectId,
        ),
      ).resolves.toBeNull();
      await expect(
        persistStorageLocationRegistration(FOREIGN_CONTEXT, {
          ...common,
          externalStorageLocationId: "slc-foreign",
          supplierReference: "nm-slc-foreign",
          submittedPayload: body,
          payloadHash: "payload-hash-a",
        }),
      ).rejects.toThrow();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps separate identities for one site used under two certifier projects", async () => {
    const fixture = await createFixture();
    let secondFacilityId: string | null = null;
    let secondProjectId: string | null = null;
    try {
      const registryInput = await getStorageLocationRegistryInput(
        makeTestOrgContext(),
        fixture.applicationId,
      );
      if (!registryInput?.externalProjectId) {
        throw new Error("Storage Location fixture did not resolve its project");
      }
      const runId = crypto.randomUUID().slice(0, 8);
      const [secondFacility] = await db
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-SLC-P2-${runId}`,
          name: `Storage Location Facility P2 ${runId}`,
        })
        .returning({ id: facilities.id });
      secondFacilityId = secondFacility.id;
      const [secondProject] = await db
        .insert(certifierProjects)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: secondFacility.id,
          provider: "isometric",
          externalProjectId: `prj_slc_p2_${runId}`,
        })
        .returning({ id: certifierProjects.id });
      secondProjectId = secondProject.id;

      const firstBody = buildCreateStorageLocationRequest({
        externalProjectId: registryInput.externalProjectId,
        name: "Shared Site",
        latitude: -3.25,
        longitude: 37.42,
        supplierReferenceId: `nm-slc-first-${runId}`,
      });
      const secondBody = buildCreateStorageLocationRequest({
        externalProjectId: `prj_slc_p2_${runId}`,
        name: "Shared Site",
        latitude: -3.25,
        longitude: 37.42,
        supplierReferenceId: `nm-slc-second-${runId}`,
      });
      const first = await persistStorageLocationRegistration(
        makeTestOrgContext(),
        {
          customerLocationId: fixture.customerLocationId,
          certifierProjectId: fixture.certifierProjectId,
          externalProjectId: registryInput.externalProjectId,
          externalStorageLocationId: `slc-first-${runId}`,
          supplierReference: `nm-slc-first-${runId}`,
          submittedPayload: firstBody,
          payloadHash: `hash-first-${runId}`,
        },
      );
      const second = await persistStorageLocationRegistration(
        makeTestOrgContext(),
        {
          customerLocationId: fixture.customerLocationId,
          certifierProjectId: secondProject.id,
          externalProjectId: `prj_slc_p2_${runId}`,
          externalStorageLocationId: `slc-second-${runId}`,
          supplierReference: `nm-slc-second-${runId}`,
          submittedPayload: secondBody,
          payloadHash: `hash-second-${runId}`,
        },
      );

      expect(second.id).not.toBe(first.id);
      await expect(
        getStorageLocationRegistration(
          makeTestOrgContext(),
          fixture.customerLocationId,
          `prj_slc_p2_${runId}`,
        ),
      ).resolves.toMatchObject({ id: second.id });
    } finally {
      await cleanupFixture(fixture);
      if (secondProjectId) {
        await db
          .delete(certifierProjects)
          .where(eq(certifierProjects.id, secondProjectId));
      }
      if (secondFacilityId) {
        await db.delete(facilities).where(eq(facilities.id, secondFacilityId));
      }
    }
  });

  it("blocks project rebinding and unlink after a site is registered", async () => {
    const fixture = await createFixture();
    try {
      const ctx = makeTestOrgContext();
      const input = await getStorageLocationRegistryInput(
        ctx,
        fixture.applicationId,
      );
      if (!input?.externalProjectId || !input.name) {
        throw new Error("Storage Location fixture did not resolve");
      }
      const supplierReference = `nm-slc-map-guard-${crypto.randomUUID().slice(0, 8)}`;
      const body = buildCreateStorageLocationRequest({
        externalProjectId: input.externalProjectId,
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        supplierReferenceId: supplierReference,
      });
      await persistStorageLocationRegistration(ctx, {
        customerLocationId: fixture.customerLocationId,
        certifierProjectId: fixture.certifierProjectId,
        externalProjectId: input.externalProjectId,
        externalStorageLocationId: `slc-map-guard-${crypto.randomUUID().slice(0, 8)}`,
        supplierReference,
        submittedPayload: body,
        payloadHash: "map-guard-hash",
      });

      await expect(
        upsertCertifierProject(ctx, {
          facilityId: fixture.facilityId,
          provider: "isometric",
          externalProjectId: "prj_rebound",
        }),
      ).rejects.toThrow(/registered application sites/);
      await expect(
        deleteCertifierProject(ctx, fixture.facilityId, "isometric"),
      ).rejects.toThrow(/registered application sites/);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("blocks every facility mapping that shares a registered external project", async () => {
    const fixture = await createFixture();
    let sharedFacilityId: string | null = null;
    try {
      const ctx = makeTestOrgContext();
      const input = await getStorageLocationRegistryInput(
        ctx,
        fixture.applicationId,
      );
      if (!input?.externalProjectId || !input.name) {
        throw new Error("Storage Location fixture did not resolve");
      }
      const runId = crypto.randomUUID().slice(0, 8);
      const [sharedFacility] = await db
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-SLC-SHARED-${runId}`,
          name: `Storage Location Shared Facility ${runId}`,
        })
        .returning({ id: facilities.id });
      sharedFacilityId = sharedFacility.id;
      await upsertCertifierProject(ctx, {
        facilityId: sharedFacility.id,
        provider: "isometric",
        externalProjectId: input.externalProjectId,
      });

      const supplierReference = `nm-slc-shared-guard-${runId}`;
      await persistStorageLocationRegistration(ctx, {
        customerLocationId: fixture.customerLocationId,
        certifierProjectId: fixture.certifierProjectId,
        externalProjectId: input.externalProjectId,
        externalStorageLocationId: `slc-shared-guard-${runId}`,
        supplierReference,
        submittedPayload: buildCreateStorageLocationRequest({
          externalProjectId: input.externalProjectId,
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          supplierReferenceId: supplierReference,
        }),
        payloadHash: `shared-guard-hash-${runId}`,
      });

      await expect(
        upsertCertifierProject(ctx, {
          facilityId: sharedFacility.id,
          provider: "isometric",
          externalProjectId: `prj_rebound_${runId}`,
        }),
      ).rejects.toThrow(/registered application sites/);
      await expect(
        deleteCertifierProject(ctx, sharedFacility.id, "isometric"),
      ).rejects.toThrow(/registered application sites/);
    } finally {
      await cleanupFixture(fixture);
      if (sharedFacilityId) {
        await db
          .delete(certifierProjects)
          .where(eq(certifierProjects.facilityId, sharedFacilityId));
        await db.delete(facilities).where(eq(facilities.id, sharedFacilityId));
      }
    }
  });
});

describe("certifier sync events with supplier-reference keys", () => {
  it("round-trips a non-UUID entity id through append and list", async () => {
    // Storage Location sync events are keyed by supplier reference
    // (nm-slc-<hex>), not a local UUID - the reason entity_id is text.
    const ctx = makeTestOrgContext();
    const entityId = `nm-slc-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    try {
      await appendSyncEvent(ctx, {
        provider: "isometric",
        entityType: "storageLocation",
        entityId,
        operation: "storage_location:create",
        status: "succeeded",
        responsePayload: { id: "isl_test_1" },
      });

      const events = await listRecentSyncEvents(ctx, {
        entityType: "storageLocation",
        entityId,
        limit: 5,
      });
      expect(events).toHaveLength(1);
      expect(events[0].entityId).toBe(entityId);
      expect(events[0].status).toBe("succeeded");

      const foreign = await listRecentSyncEvents(FOREIGN_CONTEXT, {
        entityType: "storageLocation",
        entityId,
        limit: 5,
      });
      expect(foreign).toHaveLength(0);
    } finally {
      await db
        .delete(certifierSyncEvents)
        .where(eq(certifierSyncEvents.entityId, entityId));
    }
  });
});
