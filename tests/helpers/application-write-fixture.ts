import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, certifierProjects, facilities, deliveries, orders, customerLocations, customers, biocharProducts, formulations } from "@/db/schema";
import { TEST_SITE_POSITION, TEST_ORG_ID } from "./test-org";
import { outputProductFixtureValues, outputOrderFixtureValues, insertOutputDeliveryFixture, deleteOutputApplicationFixtures, deleteOutputDeliveryFixtures, deleteOutputProductFixtures, deleteOutputFacilityFixtures } from "./output-contract-fixtures";
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

export async function createMutationFixture(runId: string): Promise<ApplicationMutationFixture> {
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
      .values({ ...TEST_SITE_POSITION, timezone: "UTC", organizationId: TEST_ORG_ID, name: `Application Mutation Facility ${runId}`, code: `FAC-AM-${runId}` })
      .returning({ id: facilities.id });

    await tx.insert(certifierProjects).values({
      externalFacilityId: `fcl_test_${facility.id}`,
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      provider: "isometric",
      externalProjectId: `iso-project-${runId}`,
      defaultSoilTemperatureC: 24.8,
    });

    const [product] = await tx
      .insert(biocharProducts)
      .values(await outputProductFixtureValues(tx, {
        organizationId: TEST_ORG_ID,
        code: `BP-AM-${runId}`,
        facilityId: facility.id,
        formulationId: formulation.id,
      }))
      .returning({ id: biocharProducts.id });

    const [order] = await tx
      .insert(orders)
      .values(await outputOrderFixtureValues(tx, {
        organizationId: TEST_ORG_ID,
        code: `OR-AM-${runId}`,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        customerLocationId: customerLocation.id,
        orderDate: new Date("2025-07-01"),
        quantityKg: 10_000,
        packaging: "bagged",
      }))
      .returning({ id: orders.id });

    const insertedDeliveries = await insertOutputDeliveryFixture(tx, [
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
      ], row => ({ id: row.id }));

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

export async function cleanupMutationFixture(fixture: ApplicationMutationFixture): Promise<void> {
  await db.transaction(async (tx) => {
    if (fixture.applicationIds.length > 0) {
      await deleteOutputApplicationFixtures(tx, inArray(applications.id, fixture.applicationIds));
    }

    await deleteOutputDeliveryFixtures(tx, inArray(deliveries.id, fixture.deliveryIds));
    await tx.delete(orders).where(eq(orders.id, fixture.orderId));
    await deleteOutputProductFixtures(tx, eq(biocharProducts.id, fixture.productId));
    await tx.delete(formulations).where(eq(formulations.id, fixture.formulationId));
    await tx.delete(certifierProjects).where(eq(certifierProjects.facilityId, fixture.facilityId));
    await tx.delete(customerLocations).where(eq(customerLocations.id, fixture.customerLocationId));
    await tx.delete(customers).where(eq(customers.id, fixture.customerId));
    await deleteOutputFacilityFixtures(tx, eq(facilities.id, fixture.facilityId));
  });
}


