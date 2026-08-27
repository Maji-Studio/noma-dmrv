import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  certificationSubmissions,
  certifierBiocharApplications,
  certifierProductionBatches,
  certifierProjects,
  certifierStorageLocations,
  creditBatches,
  customerLocations,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  formulations,
  orders,
  organizations,
  productionProcesses,
  biocharProducts,
} from "@/db/schema";
import {
  claimBiocharApplicationRegistration,
  confirmBiocharApplicationRegistration,
  getBiocharApplicationRegistration,
  getBiocharApplicationRegistryInputs,
} from "@/data-access/certifier-biochar-applications";
import { persistStorageLocationRegistration } from "@/data-access/certifier-storage-locations";
import type { OrgContext } from "@/lib/auth/server";
import { buildCreateBiocharApplicationRequest } from "@/lib/isometric/biochar-applications";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const FOREIGN_ORG_ID = "org_biochar_application_foreign";
const foreignCtx: OrgContext = {
  organizationId: FOREIGN_ORG_ID,
  userId: "user-biochar-application-foreign",
  orgRole: "owner",
  isPlatformAdmin: false,
};
const ids: Record<string, string> = {};
const tag = crypto.randomUUID().slice(0, 8);

beforeAll(async () => {
  await ensureTestOrg();
  await db
    .insert(organizations)
    .values({
      id: FOREIGN_ORG_ID,
      name: "Biochar Application Foreign Org",
      slug: `biochar-application-foreign-${tag}`,
    })
    .onConflictDoNothing();
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FAC-BCA-${tag}`,
      name: `Biochar Application Facility ${tag}`,
    })
    .returning({ id: facilities.id });
  ids.facility = facility.id;
  const [feedstock] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FT-BCA-${tag}`,
      name: `Biochar Application Feedstock ${tag}`,
      category: "forestry",
      usage: "pyrolysis",
    })
    .returning({ id: feedstockTypes.id });
  ids.feedstock = feedstock.id;
  const [process] = await db
    .insert(productionProcesses)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstock.id,
    })
    .returning({ id: productionProcesses.id });
  ids.process = process.id;
  const [batch] = await db
    .insert(creditBatches)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstock.id,
      productionProcessId: process.id,
      code: `CB-BCA-${tag}`,
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    })
    .returning({ id: creditBatches.id });
  ids.batch = batch.id;
  const [project] = await db
    .insert(certifierProjects)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      provider: "isometric",
      externalProjectId: `prj_bca_${tag}`,
    })
    .returning({ id: certifierProjects.id });
  ids.project = project.id;
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: TEST_ORG_ID,
      code: `CU-BCA-${tag}`,
      name: `Biochar Application Customer ${tag}`,
    })
    .returning({ id: customers.id });
  ids.customer = customer.id;
  const [location] = await db
    .insert(customerLocations)
    .values({
      organizationId: TEST_ORG_ID,
      customerId: customer.id,
      name: `Biochar Application Field ${tag}`,
      country: "Tanzania",
      gpsLatitude: -3.25,
      gpsLongitude: 37.42,
    })
    .returning({ id: customerLocations.id });
  ids.location = location.id;
  const [formulation] = await db
    .insert(formulations)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FM-BCA-${tag}`,
      name: `Biochar Application Formulation ${tag}`,
    })
    .returning({ id: formulations.id });
  ids.formulation = formulation.id;
  const [product] = await db
    .insert(biocharProducts)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      formulationId: formulation.id,
      code: `BP-BCA-${tag}`,
    })
    .returning({ id: biocharProducts.id });
  ids.product = product.id;
  const [order] = await db
    .insert(orders)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      customerId: customer.id,
      customerLocationId: location.id,
      biocharProductId: product.id,
      code: `OR-BCA-${tag}`,
      orderDate: new Date("2026-04-01T00:00:00Z"),
      quantityKg: 12_000,
      packaging: "loose",
    })
    .returning({ id: orders.id });
  ids.order = order.id;
  const [delivery] = await db
    .insert(deliveries)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      orderId: order.id,
      code: `DL-BCA-${tag}`,
      deliveryDate: new Date("2026-04-04T00:00:00Z"),
      status: "delivered",
      deliveredWetMassKg: 12_000,
      massDryKg: 10_800,
    })
    .returning({ id: deliveries.id });
  ids.delivery = delivery.id;
  const [application] = await db
    .insert(applications)
    .values({
      organizationId: TEST_ORG_ID,
      deliveryId: delivery.id,
      code: `AP-BCA-${tag}`,
      applicationDate: new Date("2026-04-05T00:00:00Z"),
      biocharAppliedTons: 12,
      biocharAppliedDryTons: 10.8,
      fieldSizeHa: 4,
    })
    .returning({ id: applications.id });
  ids.application = application.id;
  const [production] = await db
    .insert(certifierProductionBatches)
    .values({
      organizationId: TEST_ORG_ID,
      creditBatchId: batch.id,
      externalProductionBatchId: `ptb_bca_${tag}`,
      supplierReference: `nm-ptb-bca-${tag}`,
      massKg: 10_800,
      startedOn: "2026-04-01",
      endedOn: "2026-04-30",
      payloadHash: `ptb-hash-${tag}`,
    })
    .returning({ id: certifierProductionBatches.id });
  ids.production = production.id;
  const storagePayload = buildCreateStorageLocationRequest({
    externalProjectId: `prj_bca_${tag}`,
    name: `Biochar Application Field ${tag}`,
    latitude: -3.25,
    longitude: 37.42,
    supplierReferenceId: `nm-slc-bca-${tag}`,
  });
  const storage = await persistStorageLocationRegistration(
    makeTestOrgContext(),
    {
      customerLocationId: location.id,
      certifierProjectId: project.id,
      externalProjectId: `prj_bca_${tag}`,
      externalStorageLocationId: `slc_bca_${tag}`,
      supplierReference: `nm-slc-bca-${tag}`,
      submittedPayload: storagePayload,
      payloadHash: payloadHash(storagePayload),
    },
  );
  ids.storage = storage.id;
  const [submission] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: crypto.randomUUID(),
      version: 1,
    })
    .returning({ id: certificationSubmissions.id });
  ids.submission = submission.id;
  const [secondSubmission] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: crypto.randomUUID(),
      version: 2,
    })
    .returning({ id: certificationSubmissions.id });
  ids.secondSubmission = secondSubmission.id;
});

afterAll(async () => {
  const cleanup = async (table: Parameters<typeof db.delete>[0], id?: string) => {
    if (id) await db.delete(table).where(eq((table as never)["id"], id));
  };
  await db.delete(certifierBiocharApplications).where(
    and(
      eq(certifierBiocharApplications.organizationId, TEST_ORG_ID),
      eq(certifierBiocharApplications.applicationId, ids.application),
      eq(certifierBiocharApplications.creditBatchId, ids.batch),
    ),
  );
  await cleanup(certifierStorageLocations, ids.storage);
  await cleanup(certifierProductionBatches, ids.production);
  await cleanup(certificationSubmissions, ids.submission);
  await cleanup(certificationSubmissions, ids.secondSubmission);
  await cleanup(applications, ids.application);
  await cleanup(deliveries, ids.delivery);
  await cleanup(orders, ids.order);
  await cleanup(biocharProducts, ids.product);
  await cleanup(formulations, ids.formulation);
  await cleanup(customerLocations, ids.location);
  await cleanup(customers, ids.customer);
  await cleanup(certifierProjects, ids.project);
  await cleanup(creditBatches, ids.batch);
  await cleanup(productionProcesses, ids.process);
  await cleanup(feedstockTypes, ids.feedstock);
  await cleanup(facilities, ids.facility);
  await db.delete(organizations).where(eq(organizations.id, FOREIGN_ORG_ID));
});

describe("certifier Biochar Application data access", () => {
  it("loads operator facts and journals identity only within the active organization", async () => {
    const ctx = makeTestOrgContext();
    await expect(
      getBiocharApplicationRegistryInputs(ctx, [ids.application]),
    ).resolves.toEqual([
      expect.objectContaining({
        applicationId: ids.application,
        fieldSizeHa: 4,
        deliveredWetMassKg: 12_000,
      }),
    ]);
    await expect(
      getBiocharApplicationRegistryInputs(foreignCtx, [ids.application]),
    ).resolves.toEqual([]);

    const body = buildCreateBiocharApplicationRequest({
      applicationCode: `AP-BCA-${tag}`,
      applicationDate: "2026-04-05",
      applicationWetMassKg: 12_000,
      fieldSizeHa: 4,
      externalProjectId: `prj_bca_${tag}`,
      externalProductionBatchId: `ptb_bca_${tag}`,
      externalStorageLocationId: `slc_bca_${tag}`,
      supplierReferenceId: `nm-isometric-sandbox-bca-${tag}-v1`,
      sourceIds: [],
    });
    const journal = await claimBiocharApplicationRegistration(ctx, {
      applicationId: ids.application,
      creditBatchId: ids.batch,
      removalSubmissionId: ids.submission,
      productionBatchRegistrationId: ids.production,
      storageLocationRegistrationId: ids.storage,
      externalProductionBatchId: `ptb_bca_${tag}`,
      externalStorageLocationId: `slc_bca_${tag}`,
      supplierReference: `nm-isometric-sandbox-bca-${tag}-v1`,
      submittedPayload: body,
      payloadHash: payloadHash(body),
      observedGhgEntryId: "ghg-test",
      observedRemovalId: null,
    });
    await expect(
      getBiocharApplicationRegistration(
        foreignCtx,
        ids.application,
        ids.batch,
        ids.submission,
      ),
    ).resolves.toBeNull();
    await expect(
      confirmBiocharApplicationRegistration(foreignCtx, {
        registrationId: journal.id,
        expectedPayloadHash: journal.payloadHash,
        externalApplicationId: "bca-foreign",
        observedGhgEntryId: "ghg-test",
        observedRemovalId: null,
      }),
    ).rejects.toThrow(/changed before confirmation/i);
    await expect(
      confirmBiocharApplicationRegistration(ctx, {
        registrationId: journal.id,
        expectedPayloadHash: journal.payloadHash,
        externalApplicationId: "bca-test",
        observedGhgEntryId: "ghg-test",
        observedRemovalId: null,
      }),
    ).resolves.toMatchObject({
      lifecycleStatus: "confirmed",
      externalApplicationId: "bca-test",
    });

    const secondSupplierReference =
      `nm-isometric-sandbox-bca-${tag}-s2-v1`;
    const secondBody = {
      ...body,
      supplier_reference_id: secondSupplierReference,
    };
    await expect(
      claimBiocharApplicationRegistration(ctx, {
        applicationId: ids.application,
        creditBatchId: ids.batch,
        removalSubmissionId: ids.secondSubmission,
        productionBatchRegistrationId: ids.production,
        storageLocationRegistrationId: ids.storage,
        externalProductionBatchId: `ptb_bca_${tag}`,
        externalStorageLocationId: `slc_bca_${tag}`,
        supplierReference: secondSupplierReference,
        submittedPayload: secondBody,
        payloadHash: payloadHash(secondBody),
        observedGhgEntryId: null,
        observedRemovalId: null,
      }),
    ).resolves.toMatchObject({
      removalSubmissionId: ids.secondSubmission,
      supplierReference: secondSupplierReference,
    });
  });
});
