import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  createApplication,
  getApplicationDeliveryOptions,
  updateApplication,
} from "@/data-access/applications";
import { applications } from "@/db/schema/application";
import { certifierProjects } from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations, customers } from "@/db/schema/parties";
import { biocharProducts, formulations } from "@/db/schema/products";
import { TEST_GIS_BOUNDARY } from "./helpers/application-evidence-fixtures";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

interface ApplicationMutationFixture {
  facilityId: string;
  customerId: string;
  customerLocationId: string;
  formulationId: string;
  productId: string;
  orderId: string;
  deliveryIds: string[];
  applicationIds: string[];
}

async function createMutationFixture(runId: string): Promise<ApplicationMutationFixture> {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ organizationId: TEST_ORG_ID, name: `Application Mutation Customer ${runId}`, code: `CU-AM-${runId}` })
      .returning({ id: customers.id });

    const [customerLocation] = await tx
      .insert(customerLocations)
      .values({
        organizationId: TEST_ORG_ID,
        customerId: customer.id,
        name: `Application Mutation Location ${runId}`,
        country: "Tanzania",
        address: `Application Mutation Location ${runId}`,
        gpsLatitude: -3.3,
        gpsLongitude: 37.3,
        defaultSoilTemperatureC: 21.4,
      })
      .returning({ id: customerLocations.id });

    const [formulation] = await tx
      .insert(formulations)
      .values({ organizationId: TEST_ORG_ID, name: `Application Mutation Formulation ${runId}`, code: `FM-AM-${runId}` })
      .returning({ id: formulations.id });

    const [facility] = await tx
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, name: `Application Mutation Facility ${runId}`, code: `FAC-AM-${runId}` })
      .returning({ id: facilities.id });

    await tx.insert(certifierProjects).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      provider: "isometric",
      externalProjectId: `iso-project-${runId}`,
      defaultSoilTemperatureC: 24.8,
    });

    const [product] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-AM-${runId}`,
        facilityId: facility.id,
        formulationId: formulation.id,
      })
      .returning({ id: biocharProducts.id });

    const [order] = await tx
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        code: `OR-AM-${runId}`,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        customerLocationId: customerLocation.id,
        orderDate: new Date("2025-07-01"),
        quantityKg: 10_000,
        packaging: "bagged",
      })
      .returning({ id: orders.id });

    const insertedDeliveries = await tx
      .insert(deliveries)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `DL-AM-${runId}-A`,
          facilityId: facility.id,
          orderId: order.id,
          status: "delivered",
          deliveryDate: new Date("2025-07-05"),
          deliveredWetMassKg: 5_000,
          moistureContentPercent: 20,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `DL-AM-${runId}-B`,
          facilityId: facility.id,
          orderId: order.id,
          status: "delivered",
          deliveryDate: new Date("2025-07-06"),
          deliveredWetMassKg: 3_000,
          moistureContentPercent: 10,
        },
      ])
      .returning({ id: deliveries.id });

    return {
      facilityId: facility.id,
      customerId: customer.id,
      customerLocationId: customerLocation.id,
      formulationId: formulation.id,
      productId: product.id,
      orderId: order.id,
      deliveryIds: insertedDeliveries.map((delivery) => delivery.id),
      applicationIds: [],
    };
  });
}

/** Delivery left at the schema default status ('upcoming') for guard tests. */
async function insertUpcomingDelivery(
  fixture: ApplicationMutationFixture,
  runId: string,
): Promise<string> {
  const [delivery] = await db
    .insert(deliveries)
    .values({
      organizationId: TEST_ORG_ID,
      code: `DL-AM-${runId}-UPCOMING`,
      facilityId: fixture.facilityId,
      orderId: fixture.orderId,
      deliveryDate: new Date("2025-07-07"),
      deliveredWetMassKg: 4_000,
      moistureContentPercent: 15,
    })
    .returning({ id: deliveries.id });

  fixture.deliveryIds.push(delivery.id);
  return delivery.id;
}

async function cleanupMutationFixture(fixture: ApplicationMutationFixture): Promise<void> {
  await db.transaction(async (tx) => {
    if (fixture.applicationIds.length > 0) {
      await tx
        .delete(applications)
        .where(inArray(applications.id, fixture.applicationIds));
    }

    await tx.delete(deliveries).where(inArray(deliveries.id, fixture.deliveryIds));
    await tx.delete(orders).where(eq(orders.id, fixture.orderId));
    await tx.delete(biocharProducts).where(eq(biocharProducts.id, fixture.productId));
    await tx.delete(formulations).where(eq(formulations.id, fixture.formulationId));
    await tx.delete(certifierProjects).where(eq(certifierProjects.facilityId, fixture.facilityId));
    await tx.delete(customerLocations).where(eq(customerLocations.id, fixture.customerLocationId));
    await tx.delete(customers).where(eq(customers.id, fixture.customerId));
    await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
  });
}


beforeAll(() => ensureTestOrg());

describe("application mutations", () => {
  it("creates an application and derives dry mass from delivery moisture", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-CREATE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      expect(application.biocharAppliedTons).toBe(2);
      expect(application.biocharAppliedDryTons).toBeCloseTo(1.6);
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("defaults new applications to visual evidence", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-EVIDENCE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      expect(application.evidenceMethod).toBe("visual");
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("persists boundary evidence method with the GIS boundary", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-BOUNDARY`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        evidenceMethod: "boundary",
        gisBoundary: TEST_GIS_BOUNDARY,
      });
      fixture.applicationIds.push(application.id);

      expect(application.evidenceMethod).toBe("boundary");
      expect(application.gisBoundary).toEqual(TEST_GIS_BOUNDARY);
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("clears a GIS boundary to null", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-CLEAR-GIS`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        evidenceMethod: "boundary",
        gisBoundary: TEST_GIS_BOUNDARY,
      });
      fixture.applicationIds.push(application.id);

      expect(application.gisBoundary).toEqual(TEST_GIS_BOUNDARY);

      const updated = await updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
        gisBoundary: null,
      });
      expect(updated.gisBoundary).toBeNull();
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("includes location and facility soil temperature defaults in delivery options", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const options = await getApplicationDeliveryOptions(
        makeTestOrgContext(TEST_USER_ID),
        fixture.facilityId,
      );
      const deliveryOption = options.find(
        (option) => option.id === fixture.deliveryIds[0],
      );

      expect(deliveryOption).toMatchObject({
        defaultSoilTemperatureC: 21.4,
        facilityDefaultSoilTemperatureC: 24.8,
        destinationGpsLatitude: -3.3,
        destinationGpsLongitude: 37.3,
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects create when requested wet mass exceeds delivery capacity", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);
    const code = `AP-AM-${runId}-OVER`;

    try {
      await expect(
        createApplication(makeTestOrgContext(TEST_USER_ID), {
          code,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 6,
        }),
      ).rejects.toThrow("Cannot apply");

      const [application] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.code, code));

      expect(application).toBeUndefined();
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects create against a delivery not yet marked delivered", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);
    const code = `AP-AM-${runId}-UPCOMING`;

    try {
      const upcomingDeliveryId = await insertUpcomingDelivery(fixture, runId);

      await expect(
        createApplication(makeTestOrgContext(TEST_USER_ID), {
          code,
          deliveryId: upcomingDeliveryId,
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 2,
        }),
      ).rejects.toThrow(
        `Delivery DL-AM-${runId}-UPCOMING is not marked as delivered. Mark it as delivered before recording an application.`,
      );

      const [application] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.code, code));

      expect(application).toBeUndefined();
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects create when the application date precedes the delivery date", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      await expect(
        createApplication(makeTestOrgContext(TEST_USER_ID), {
          code: `AP-AM-${runId}-EARLY`,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-04"),
          biocharAppliedTons: 2,
        }),
      ).rejects.toThrow("cannot be before the delivery date");
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("accepts an application dated the same day as the delivery", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-SAME-DAY`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-05"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      expect(application.applicationDate).toEqual(new Date("2025-07-05"));
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects update when the application date precedes the delivery date", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-EARLY-UPDATE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          applicationDate: new Date("2025-07-04"),
        }),
      ).rejects.toThrow("cannot be before the delivery date");
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects update re-pointing an application to an undelivered delivery", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-REPOINT`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      const upcomingDeliveryId = await insertUpcomingDelivery(fixture, runId);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          deliveryId: upcomingDeliveryId,
        }),
      ).rejects.toThrow(
        `Delivery DL-AM-${runId}-UPCOMING is not marked as delivered. Mark it as delivered before recording an application.`,
      );
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("updates delivery and amount while recalculating dry mass", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-UPDATE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      const updated = await updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
        deliveryId: fixture.deliveryIds[1],
        biocharAppliedTons: 2,
      });

      expect(updated.deliveryId).toBe(fixture.deliveryIds[1]);
      expect(updated.biocharAppliedTons).toBe(2);
      expect(updated.biocharAppliedDryTons).toBeCloseTo(1.8);
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("clears both GPS coordinates when they are explicitly set to null", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-GPS-CLEAR`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
      fixture.applicationIds.push(application.id);

      const updated = await updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
        gpsLatitude: null,
        gpsLongitude: null,
      });

      expect(updated.gpsLatitude).toBeNull();
      expect(updated.gpsLongitude).toBeNull();

      const [persisted] = await db
        .select({
          gpsLatitude: applications.gpsLatitude,
          gpsLongitude: applications.gpsLongitude,
        })
        .from(applications)
        .where(eq(applications.id, application.id));

      expect(persisted).toEqual({
        gpsLatitude: null,
        gpsLongitude: null,
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("leaves the existing application unchanged after rejected capacity update", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-REJECT`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          biocharAppliedTons: 6,
        }),
      ).rejects.toThrow("Cannot apply");

      const [persisted] = await db
        .select({
          deliveryId: applications.deliveryId,
          biocharAppliedTons: applications.biocharAppliedTons,
          biocharAppliedDryTons: applications.biocharAppliedDryTons,
        })
        .from(applications)
        .where(eq(applications.id, application.id));

      expect(persisted).toEqual({
        deliveryId: fixture.deliveryIds[0],
        biocharAppliedTons: 2,
        biocharAppliedDryTons: expect.closeTo(1.6),
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });
});
