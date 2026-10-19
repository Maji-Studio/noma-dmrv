import { chooseApplicationTimeZone } from "./application-time-zone";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationOutputAllocations, creditBatchApplications, soilTemperatureMeasurements, customerLocations, documents, storageObjectDeletions } from "@/db/schema";
import { addDaysIso, combineDateAndTime, formatFacilityDate } from "@/lib/date-utils";
import { recordDeliveryForUi } from "@/lib/operations/deliveries";
import { runOperationInProcess } from "@/lib/operations/runner";
import { APPLICATION_SCOPES, DELIVERY_MOISTURE_PERCENT, type ApplicationCaseId } from "./config";
import { cleanupDeliveryFixture, seedDeliveryFixture, type DeliveryEvalFixture } from "./fixture-delivery";
import type { ApplicationDatabaseSnapshot, ApplicationTarget } from "./score-applications";

const REMAINING_WET_KG = 2400;
const LOW_REMAINING_WET_KG = 500;
const DELIVERY_DAYS_AGO = 2;
const DELIVERY_LOCAL_TIME = "14:00";

export interface ApplicationEvalFixture extends DeliveryEvalFixture { applicationTarget: ApplicationTarget }

/** Real delivery posting preserves provenance; no Removal or submitted lineage is seeded. */
export async function seedApplicationFixture(caseId: ApplicationCaseId, now = new Date()): Promise<ApplicationEvalFixture> {
  const fixture = await seedDeliveryFixture("delivery-complete", now, APPLICATION_SCOPES, chooseApplicationTimeZone(now));
  try {
    const overCapacity = caseId === "application-over-capacity";
    const remainingWetMassKg = overCapacity ? LOW_REMAINING_WET_KG : REMAINING_WET_KG;
    const timeZone = fixture.target.timeZone;
    const deliveredAt = combineDateAndTime(addDaysIso(formatFacilityDate(now, timeZone), -DELIVERY_DAYS_AGO),
      DELIVERY_LOCAL_TIME, timeZone).toISOString();
    const { delivery } = await runOperationInProcess(recordDeliveryForUi, fixture.ctx, {
      code: overCapacity ? "DL-Y" : "DL-X", orderId: fixture.target.orderId, storageLocationId: fixture.target.binId,
      deliveredAt, deliveredWetMassKg: remainingWetMassKg, moisturePercent: DELIVERY_MOISTURE_PERCENT,
    }, { activitySource: "script" });
    const [site] = await db.select().from(customerLocations).where(eq(customerLocations.id, fixture.locationId));
    if (site.gpsLatitude == null || site.gpsLongitude == null) throw new Error("Application fixture needs site GPS.");
    return { ...fixture, applicationTarget: {
      deliveryId: delivery.id, deliveryCode: delivery.code, remainingWetMassKg, timeZone,
      siteName: site.name, gpsLatitude: site.gpsLatitude, gpsLongitude: site.gpsLongitude,
    } };
  } catch (error) {
    await cleanupApplicationFixture(fixture);
    throw error;
  }
}

/** Read the entire isolated organization so an application on another delivery cannot escape scoring. */
export async function readApplicationSnapshot(fixture: ApplicationEvalFixture): Promise<ApplicationDatabaseSnapshot> {
  const rows = await db.select({
    deliveryId: applications.deliveryId, biocharAppliedTons: applications.biocharAppliedTons,
    applicationDate: applications.applicationDate, fieldSizeHa: applications.fieldSizeHa,
    fieldIdentifier: applications.fieldIdentifier, cropType: applications.cropType,
    gpsLatitude: applications.gpsLatitude, gpsLongitude: applications.gpsLongitude,
  }).from(applications).where(eq(applications.organizationId, fixture.ctx.organizationId));
  return { applications: rows.map((row) => ({ ...row, applicationDate: row.applicationDate.toISOString() })) };
}

export async function cleanupApplicationFixture(fixture: DeliveryEvalFixture): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [storageObjectDeletions, documents, creditBatchApplications, applicationOutputAllocations, soilTemperatureMeasurements, applications]) {
      await tx.delete(table).where(eq(table.organizationId, fixture.ctx.organizationId));
    }
  });
  await cleanupDeliveryFixture(fixture);
}
