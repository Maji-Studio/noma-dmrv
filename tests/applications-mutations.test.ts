import { describe, expect, it } from "vitest";
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
      .values({ name: `Application Mutation Customer ${runId}`, code: `CU-AM-${runId}` })
      .returning({ id: customers.id });

    const [customerLocation] = await tx
      .insert(customerLocations)
      .values({
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
      .values({ name: `Application Mutation Formulation ${runId}`, code: `FM-AM-${runId}` })
      .returning({ id: formulations.id });

    const [facility] = await tx
      .insert(facilities)
      .values({ name: `Application Mutation Facility ${runId}`, code: `FAC-AM-${runId}` })
      .returning({ id: facilities.id });

    await tx.insert(certifierProjects).values({
      facilityId: facility.id,
      provider: "isometric",
      externalProjectId: `iso-project-${runId}`,
      defaultSoilTemperatureC: 24.8,
    });

    const [product] = await tx
      .insert(biocharProducts)
      .values({
        code: `BP-AM-${runId}`,
        facilityId: facility.id,
        formulationId: formulation.id,
      })
      .returning({ id: biocharProducts.id });

    const [order] = await tx
      .insert(orders)
      .values({
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
          code: `DL-AM-${runId}-A`,
          facilityId: facility.id,
          orderId: order.id,
          deliveryDate: new Date("2025-07-05"),
          deliveredWetMassKg: 5_000,
          moistureContentPercent: 20,
        },
        {
          code: `DL-AM-${runId}-B`,
          facilityId: facility.id,
          orderId: order.id,
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

describe("application mutations", () => {
  it("creates an application and derives dry mass from delivery moisture", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(TEST_USER_ID, {
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
      const application = await createApplication(TEST_USER_ID, {
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

  it("persists boundary evidence method with the GIS boundary reference", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(TEST_USER_ID, {
        code: `AP-AM-${runId}-BOUNDARY`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        evidenceMethod: "boundary",
        gisBoundaryReference: "https://maps.example.test/field-a",
      });
      fixture.applicationIds.push(application.id);

      expect(application.evidenceMethod).toBe("boundary");
      expect(application.gisBoundaryReference).toBe(
        "https://maps.example.test/field-a",
      );
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("normalizes blank GIS boundary references to null", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(TEST_USER_ID, {
        code: `AP-AM-${runId}-BLANK-GIS`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
        evidenceMethod: "boundary",
        gisBoundaryReference: "   ",
      });
      fixture.applicationIds.push(application.id);

      expect(application.gisBoundaryReference).toBeNull();

      const updated = await updateApplication(TEST_USER_ID, application.id, {
        gisBoundaryReference: "  https://maps.example.test/field-a  ",
      });
      expect(updated.gisBoundaryReference).toBe(
        "https://maps.example.test/field-a",
      );
    } finally {
      await cleanupMutationFixture(fixture);
    }
  });

  it("includes location and facility soil temperature defaults in delivery options", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const options = await getApplicationDeliveryOptions(
        TEST_USER_ID,
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
        createApplication(TEST_USER_ID, {
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

  it("updates delivery and amount while recalculating dry mass", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(TEST_USER_ID, {
        code: `AP-AM-${runId}-UPDATE`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      const updated = await updateApplication(TEST_USER_ID, application.id, {
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

  it("leaves the existing application unchanged after rejected capacity update", async () => {
    const runId = crypto.randomUUID();
    const fixture = await createMutationFixture(runId);

    try {
      const application = await createApplication(TEST_USER_ID, {
        code: `AP-AM-${runId}-REJECT`,
        deliveryId: fixture.deliveryIds[0],
        applicationDate: new Date("2025-07-08"),
        biocharAppliedTons: 2,
      });
      fixture.applicationIds.push(application.id);

      await expect(
        updateApplication(TEST_USER_ID, application.id, {
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
