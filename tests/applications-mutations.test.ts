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
          massDryKg: 4_000,
          moistureContentPercent: 40,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `DL-AM-${runId}-B`,
          facilityId: facility.id,
          orderId: order.id,
          status: "delivered",
          deliveryDate: new Date("2025-07-06"),
          deliveredWetMassKg: 3_000,
          massDryKg: 2_700,
          moistureContentPercent: 5,
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
  it("rejects missing or zero field size at the data-access create boundary", async () => {
    const base = {
      code: `AP-AM-${crypto.randomUUID()}-INVALID-FIELD`,
      deliveryId: crypto.randomUUID(),
      applicationDate: new Date("2025-07-08"),
      biocharAppliedTons: 1,
    };

    await expect(
      createApplication(makeTestOrgContext(TEST_USER_ID), {
        ...base,
        fieldSizeHa: 0,
      }),
    ).rejects.toThrow(
      `Application ${base.code} needs a field size greater than 0 ha. Enter a field size and save again.`,
    );
    await expect(
      createApplication(
        makeTestOrgContext(TEST_USER_ID),
        base as unknown as Parameters<typeof createApplication>[1],
      ),
    ).rejects.toThrow(
      `Application ${base.code} needs a field size greater than 0 ha. Enter a field size and save again.`,
    );
  });

  it("creates an application from the delivery's tracked dry-biochar ratio", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-CREATE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
      });
      fixture.applicationIds.push(application.id);

      expect(application.biocharAppliedTons).toBe(2);
      expect(application.biocharAppliedDryTons).toBeCloseTo(1.6);
      await expect(
        updateApplication(
          makeTestOrgContext(TEST_USER_ID),
          application.id,
          { fieldSizeHa: 0 },
        ),
      ).rejects.toThrow(
        `Application ${application.code} needs a field size greater than 0 ha. Enter a field size and save again.`,
      );

      const options = await getApplicationDeliveryOptions(
        makeTestOrgContext(TEST_USER_ID),
        fixture.facilityId,
      );
      expect(
        options.find((option) => option.id === fixture.deliveryIds[0]),
      ).toMatchObject({
        alreadyAppliedWetKg: 2_000,
        alreadyAppliedDryKg: 1_600,
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("carries all remaining delivery dry biochar on full application", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const first = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-PARTIAL`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
      });
      const last = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-REMAINDER`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-09"),
        biocharAppliedTons: 3,
        fieldSizeHa: 1,
      });
      fixture.applicationIds.push(first.id, last.id);

      expect(first.biocharAppliedDryTons).toBe(1.6);
      expect(last.biocharAppliedDryTons).toBe(2.4);
      expect(first.biocharAppliedDryTons + last.biocharAppliedDryTons).toBe(4);
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects a final allocation when prior dry mass exceeds the delivery", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const [corrupt] = await db
        .insert(applications)
        .values({
          organizationId: TEST_ORG_ID,
          code: `AP-AM-${runId}-CORRUPT`,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 4,
          fieldSizeHa: 1,
          biocharAppliedDryTons: 4.1,
        })
        .returning({ id: applications.id });
      fixture.applicationIds.push(corrupt.id);

      await expect(
        createApplication(makeTestOrgContext(TEST_USER_ID), {
          code: `AP-AM-${runId}-AFTER-CORRUPT`,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-09"),
          biocharAppliedTons: 1,
          fieldSizeHa: 1,
        }),
      ).rejects.toThrow("Tracked dry biochar is not available");
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("defaults new applications to customer location evidence", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-EVIDENCE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
      fixture.applicationIds.push(application.id);

      expect(application.evidenceMethod).toBe("location");
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
        fieldSizeHa: 1,
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
        fieldSizeHa: 1,
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
          fieldSizeHa: 1,
        }),
      ).rejects.toThrow("Not enough biochar in this delivery");

      const [application] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.code, code));

      expect(application).toBeUndefined();
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("derives dry mass from the delivery allocation", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);
    const code = `AP-AM-${runId}-DRY-OVER-WET`;

    try {
      await db
        .update(deliveries)
        .set({ moistureContentPercent: null })
        .where(eq(deliveries.id, fixture.deliveryIds[0]));

      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
          code,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 2,
          fieldSizeHa: 1,
        });
      fixture.applicationIds.push(application.id);
      expect(application.biocharAppliedDryTons).toBeCloseTo(1.6);
    } finally {
      await db.delete(applications).where(eq(applications.code, code));
      await cleanupMutationFixture(fixture);
    }
  });

  it("does not recalculate dry biochar for an unrelated update", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      await db
        .update(deliveries)
        .set({ moistureContentPercent: null })
        .where(eq(deliveries.id, fixture.deliveryIds[0]));

      const application = await createApplication(
        makeTestOrgContext(TEST_USER_ID),
        {
          code: `AP-AM-${runId}-DRY-UPDATE`,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 2,
          fieldSizeHa: 1,
          gpsLatitude: -3.3349,
          gpsLongitude: 37.3404,
        },
      );
      fixture.applicationIds.push(application.id);

      const updated = await updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          fieldIdentifier: "Updated field",
        });
      expect(updated.biocharAppliedDryTons).toBeCloseTo(1.6);
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
          fieldSizeHa: 1,
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
          fieldSizeHa: 1,
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
        fieldSizeHa: 1,
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
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
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
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
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
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
      fixture.applicationIds.push(application.id);

      const updated = await updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
        deliveryId: fixture.deliveryIds[1],
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
      });

      expect(updated.deliveryId).toBe(fixture.deliveryIds[1]);
      expect(updated.biocharAppliedTons).toBe(2);
      expect(updated.biocharAppliedDryTons).toBeCloseTo(1.8);
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects clearing coordinates when the saved evidence method is location", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-GPS-CLEAR`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          gpsLatitude: null,
          gpsLongitude: null,
        }),
      ).rejects.toThrow("Customer location coordinates are required.");

      const [persisted] = await db
        .select({
          gpsLatitude: applications.gpsLatitude,
          gpsLongitude: applications.gpsLongitude,
        })
        .from(applications)
        .where(eq(applications.id, application.id));

      expect(persisted).toEqual({
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects clearing only one saved location coordinate", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(makeTestOrgContext(TEST_USER_ID), {
        code: `AP-AM-${runId}-GPS-HALF-CLEAR`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          gpsLongitude: null,
        }),
      ).rejects.toThrow("Longitude is required when a latitude is entered.");

      const [persisted] = await db
        .select({
          gpsLatitude: applications.gpsLatitude,
          gpsLongitude: applications.gpsLongitude,
        })
        .from(applications)
        .where(eq(applications.id, application.id));

      expect(persisted).toEqual({
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("rejects switching coordinate-less boundary evidence to location", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(
        makeTestOrgContext(TEST_USER_ID),
        {
          code: `AP-AM-${runId}-LOCATION-WITHOUT-GPS`,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 2,
          fieldSizeHa: 1,
          evidenceMethod: "boundary",
        },
      );
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          evidenceMethod: "location",
        }),
      ).rejects.toThrow("Customer location coordinates are required.");

      const [persisted] = await db
        .select({ evidenceMethod: applications.evidenceMethod })
        .from(applications)
        .where(eq(applications.id, application.id));

      expect(persisted.evidenceMethod).toBe("boundary");
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("allows a coordinate-only partial update for boundary evidence", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(
        makeTestOrgContext(TEST_USER_ID),
        {
          code: `AP-AM-${runId}-BOUNDARY-GPS-CLEAR`,
          deliveryId: fixture.deliveryIds[0],
          applicationDate: new Date("2025-07-08"),
          biocharAppliedTons: 2,
          fieldSizeHa: 1,
          evidenceMethod: "boundary",
          gpsLatitude: -3.3349,
          gpsLongitude: 37.3404,
        },
      );
      fixture.applicationIds.push(application.id);

      const updated = await updateApplication(
        makeTestOrgContext(TEST_USER_ID),
        application.id,
        {
          gpsLatitude: null,
          gpsLongitude: null,
        },
      );

      expect(updated).toMatchObject({
        evidenceMethod: "boundary",
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
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      });
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), application.id, {
          biocharAppliedTons: 6,
          fieldSizeHa: 1,
        }),
      ).rejects.toThrow("Not enough biochar in this delivery");

      const [persisted] = await db
        .select({
          deliveryId: applications.deliveryId,
          biocharAppliedTons: applications.biocharAppliedTons,
          fieldSizeHa: applications.fieldSizeHa,
          biocharAppliedDryTons: applications.biocharAppliedDryTons,
        })
        .from(applications)
        .where(eq(applications.id, application.id));

      expect(persisted).toEqual({
        deliveryId: fixture.deliveryIds[0],
        biocharAppliedTons: 2,
        fieldSizeHa: 1,
        biocharAppliedDryTons: expect.closeTo(1.6),
      });
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });
});
