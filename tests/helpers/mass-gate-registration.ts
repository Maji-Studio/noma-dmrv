import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierBiocharApplications,
  certifierProductionBatches,
  certifierProjects,
  certifierStorageLocations,
  customerLocations,
} from "@/db/schema";
import { MISSING_TRUCK_MASSES_GATE_REASON } from "@/lib/certification/biochar-application-gates";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { TEST_ORG_ID } from "./test-org";

interface MassGateFixture {
  applicationId: string;
  batchId: string;
  customerId: string;
  facilityId: string;
}

export async function withMassGateRegistration<T>(
  fixture: MassGateFixture,
  testFn: () => Promise<T>,
): Promise<T> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const created = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(certifierProjects)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        externalProjectId: `prj_clg_${tag}`,
      })
      .returning({ id: certifierProjects.id });
    const [location] = await tx
      .insert(customerLocations)
      .values({
        organizationId: TEST_ORG_ID,
        customerId: fixture.customerId,
        name: `CLG Field ${tag}`,
        country: "Tanzania",
        gpsLatitude: -3.25,
        gpsLongitude: 37.42,
      })
      .returning({ id: customerLocations.id });
    const [production] = await tx
      .insert(certifierProductionBatches)
      .values({
        organizationId: TEST_ORG_ID,
        creditBatchId: fixture.batchId,
        externalProductionBatchId: `ptb_clg_${tag}`,
        supplierReference: `nm-ptb-clg-${tag}`,
        massKg: 285,
        startedOn: "2026-06-13",
        endedOn: "2026-06-16",
        payloadHash: `ptb-hash-${tag}`,
      })
      .returning({ id: certifierProductionBatches.id });
    const externalProjectId = `prj_clg_${tag}`;
    const storagePayload = buildCreateStorageLocationRequest({
      externalProjectId,
      name: `CLG Field ${tag}`,
      latitude: -3.25,
      longitude: 37.42,
      supplierReferenceId: `nm-slc-clg-${tag}`,
    });
    const [storage] = await tx
      .insert(certifierStorageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        customerLocationId: location.id,
        certifierProjectId: project.id,
        externalProjectId,
        externalStorageLocationId: `slc_clg_${tag}`,
        supplierReference: `nm-slc-clg-${tag}`,
        submittedPayload: storagePayload,
        payloadHash: `slc-hash-${tag}`,
      })
      .returning({ id: certifierStorageLocations.id });
    const [registration] = await tx
      .insert(certifierBiocharApplications)
      .values({
        organizationId: TEST_ORG_ID,
        applicationId: fixture.applicationId,
        creditBatchId: fixture.batchId,
        productionBatchRegistrationId: production.id,
        storageLocationRegistrationId: storage.id,
        externalProductionBatchId: `ptb_clg_${tag}`,
        externalStorageLocationId: `slc_clg_${tag}`,
        supplierReference: `nm-bca-clg-${tag}`,
        lifecycleStatus: "gated",
        gateReason: MISSING_TRUCK_MASSES_GATE_REASON,
      })
      .returning({ id: certifierBiocharApplications.id });
    return {
      locationId: location.id,
      productionId: production.id,
      projectId: project.id,
      registrationId: registration.id,
      storageId: storage.id,
    };
  });

  try {
    return await testFn();
  } finally {
    await db.transaction(async (tx) => {
      await tx.delete(certifierBiocharApplications).where(
        eq(certifierBiocharApplications.id, created.registrationId),
      );
      await tx.delete(certifierStorageLocations).where(
        eq(certifierStorageLocations.id, created.storageId),
      );
      await tx.delete(certifierProductionBatches).where(
        eq(certifierProductionBatches.id, created.productionId),
      );
      await tx.delete(customerLocations).where(
        eq(customerLocations.id, created.locationId),
      );
      await tx.delete(certifierProjects).where(
        eq(certifierProjects.id, created.projectId),
      );
    });
  }
}
