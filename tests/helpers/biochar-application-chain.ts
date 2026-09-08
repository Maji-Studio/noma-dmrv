import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  certifierProductionBatches,
  certifierStorageLocations,
  customerLocations,
  customers,
  deliveries,
  formulations,
  orders,
} from "@/db/schema";
import { persistStorageLocationRegistration } from "@/data-access/certifier-storage-locations";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { makeTestOrgContext, TEST_ORG_ID } from "./test-org";

/**
 * The customer-facing chain a Biochar Application registration depends on:
 * customer, location, formulation, product, order, delivery, application,
 * plus the Production Batch and Storage Location registrations its foreign
 * keys point at. Built on top of an existing facility, feedstock type,
 * credit batch, and certifier project.
 */
export interface BiocharApplicationChainArgs {
  tag: string;
  facilityId: string;
  creditBatchId: string;
  certifierProjectId: string;
  externalProjectId: string;
}

export interface BiocharApplicationChain {
  applicationId: string;
  productionBatchRegistrationId: string;
  storageLocationRegistrationId: string;
  externalProductionBatchId: string;
  externalStorageLocationId: string;
  cleanup: () => Promise<void>;
}

const APPLIED_WET_MASS_KG = 12_000;
const APPLIED_DRY_MASS_KG = 10_800;
const FIELD_SIZE_HA = 4;

export async function createBiocharApplicationChain(
  args: BiocharApplicationChainArgs,
): Promise<BiocharApplicationChain> {
  const { tag, facilityId, creditBatchId, certifierProjectId, externalProjectId } =
    args;
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: TEST_ORG_ID,
      code: `CU-${tag}`,
      name: `Chain Customer ${tag}`,
    })
    .returning({ id: customers.id });
  const [location] = await db
    .insert(customerLocations)
    .values({
      organizationId: TEST_ORG_ID,
      customerId: customer.id,
      name: `Chain Field ${tag}`,
      country: "Tanzania",
      gpsLatitude: -3.25,
      gpsLongitude: 37.42,
    })
    .returning({ id: customerLocations.id });
  const [formulation] = await db
    .insert(formulations)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FM-${tag}`,
      name: `Chain Formulation ${tag}`,
    })
    .returning({ id: formulations.id });
  const [product] = await db
    .insert(biocharProducts)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId,
      formulationId: formulation.id,
      code: `BP-${tag}`,
    })
    .returning({ id: biocharProducts.id });
  const [order] = await db
    .insert(orders)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId,
      customerId: customer.id,
      customerLocationId: location.id,
      biocharProductId: product.id,
      code: `OR-${tag}`,
      orderDate: new Date("2026-04-01T00:00:00Z"),
      quantityKg: APPLIED_WET_MASS_KG,
      packaging: "loose",
    })
    .returning({ id: orders.id });
  const [delivery] = await db
    .insert(deliveries)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId,
      orderId: order.id,
      code: `DL-${tag}`,
      deliveryDate: new Date("2026-04-04T00:00:00Z"),
      status: "delivered",
      deliveredWetMassKg: APPLIED_WET_MASS_KG,
      massDryKg: APPLIED_DRY_MASS_KG,
    })
    .returning({ id: deliveries.id });
  const [application] = await db
    .insert(applications)
    .values({
      organizationId: TEST_ORG_ID,
      deliveryId: delivery.id,
      code: `AP-${tag}`,
      applicationDate: new Date("2026-04-05T00:00:00Z"),
      biocharAppliedTons: APPLIED_WET_MASS_KG / 1000,
      biocharAppliedDryTons: APPLIED_DRY_MASS_KG / 1000,
      fieldSizeHa: FIELD_SIZE_HA,
    })
    .returning({ id: applications.id });
  const externalProductionBatchId = `ptb_${tag}`;
  const [production] = await db
    .insert(certifierProductionBatches)
    .values({
      organizationId: TEST_ORG_ID,
      creditBatchId,
      externalProductionBatchId,
      supplierReference: `nm-ptb-${tag}`,
      massKg: APPLIED_DRY_MASS_KG,
      startedOn: "2026-04-01",
      endedOn: "2026-04-30",
      payloadHash: `ptb-hash-${tag}`,
    })
    .returning({ id: certifierProductionBatches.id });
  const externalStorageLocationId = `slc_${tag}`;
  const storagePayload = buildCreateStorageLocationRequest({
    externalProjectId,
    name: `Chain Field ${tag}`,
    latitude: -3.25,
    longitude: 37.42,
    supplierReferenceId: `nm-slc-${tag}`,
  });
  const storage = await persistStorageLocationRegistration(makeTestOrgContext(), {
    customerLocationId: location.id,
    certifierProjectId,
    externalProjectId,
    externalStorageLocationId,
    supplierReference: `nm-slc-${tag}`,
    submittedPayload: storagePayload,
    payloadHash: payloadHash(storagePayload),
  });

  return {
    applicationId: application.id,
    productionBatchRegistrationId: production.id,
    storageLocationRegistrationId: storage.id,
    externalProductionBatchId,
    externalStorageLocationId,
    cleanup: async () => {
      await db.delete(certifierStorageLocations).where(eq(certifierStorageLocations.id, storage.id));
      await db.delete(certifierProductionBatches).where(eq(certifierProductionBatches.id, production.id));
      await db.delete(applications).where(eq(applications.id, application.id));
      await db.delete(deliveries).where(eq(deliveries.id, delivery.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(formulations).where(eq(formulations.id, formulation.id));
      await db.delete(customerLocations).where(eq(customerLocations.id, location.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
    },
  };
}
