import { desc, eq, count, sum, ne, and } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  soilTemperatureMeasurements,
  type Application,
} from "@/db/schema/application";
import { creditBatches, creditBatchApplications } from "@/db/schema/credits";
import { deliveries } from "@/db/schema/logistics";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { tonnesToKg, kgToTonnes } from "@/lib/calculations/unit-conversions";
import { checkDeliveryCapacity } from "@/lib/calculations/delivery-inventory";
import type { CreateApplicationData, UpdateApplicationData } from "@/schemas/applications";

import { requireAuth } from "./utils";

// ============================================
// Application Data Access Layer
// ============================================

const DEFAULT_PAGE_SIZE = 100;
const IMMUTABLE_CREDIT_BATCH_STATUSES = new Set<string>(["verified", "issued"]);

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getDeliveryMoistureContentPercent(deliveryId: string): Promise<number | null> {
  const [delivery] = await db
    .select({
      moistureContentPercent: deliveries.moistureContentPercent,
    })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!delivery) {
    throw new Error("Delivery not found");
  }

  return delivery.moistureContentPercent;
}

async function getDeliveryCapacityAndApplied(
  deliveryId: string,
  excludeApplicationId?: string,
): Promise<{ capacityKg: number | null; alreadyAppliedTons: number }> {
  const [delivery] = await db
    .select({ deliveredWetMassKg: deliveries.deliveredWetMassKg })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!delivery) throw new Error("Delivery not found");

  const conditions = excludeApplicationId
    ? and(eq(applications.deliveryId, deliveryId), ne(applications.id, excludeApplicationId))
    : eq(applications.deliveryId, deliveryId);

  const [{ total }] = await db
    .select({ total: sum(applications.biocharAppliedTons) })
    .from(applications)
    .where(conditions);

  return {
    capacityKg: delivery.deliveredWetMassKg,
    alreadyAppliedTons: Number(total ?? 0),
  };
}

async function getLinkedCreditBatches(
  tx: DbTransaction,
  applicationId: string,
): Promise<
  Array<{
    creditBatchId: string;
    code: string;
    status: string;
  }>
> {
  const rows = await tx
    .select({
      creditBatchId: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
    })
    .from(creditBatchApplications)
    .innerJoin(
      creditBatches,
      eq(creditBatchApplications.creditBatchId, creditBatches.id),
    )
    .where(eq(creditBatchApplications.applicationId, applicationId))
    .for("update");

  return rows.map((row) => ({
    creditBatchId: row.creditBatchId,
    code: row.code,
    status: row.status,
  }));
}

async function refreshCreditBatchSummaries(
  tx: DbTransaction,
  creditBatchId: string,
): Promise<void> {
  const linkedApplications = await tx
    .select({
      biocharAppliedTons: applications.biocharAppliedTons,
      co2eStoredTonnes: applications.co2eStoredTonnes,
    })
    .from(creditBatchApplications)
    .innerJoin(
      applications,
      eq(creditBatchApplications.applicationId, applications.id),
    )
    .where(eq(creditBatchApplications.creditBatchId, creditBatchId));

  const weightTons = linkedApplications.reduce(
    (total, application) => total + application.biocharAppliedTons,
    0,
  );
  const hasUnknownStoredTotal = linkedApplications.some(
    (application) => application.co2eStoredTonnes == null,
  );
  const totalCo2eStoredTons = hasUnknownStoredTotal
    ? null
    : linkedApplications.reduce(
        (total, application) =>
          total + Number(application.co2eStoredTonnes ?? 0),
        0,
      );

  await tx
    .update(creditBatches)
    .set({
      weightTons,
      totalCo2eStoredTons,
      // These batch-level values are no longer trustworthy once membership changes.
      totalCo2eEmissionsTons: null,
      totalCo2eCounterfactualTons: null,
      fDurableCalculated: null,
      updatedAt: new Date(),
    })
    .where(eq(creditBatches.id, creditBatchId));
}

async function resolveApplicationDryMassTons(input: {
  deliveryId: string;
  biocharAppliedTons: number;
  biocharAppliedDryTons?: number | null;
  fallbackDryTons?: number | null;
}): Promise<number> {
  if (input.biocharAppliedDryTons != null) {
    return input.biocharAppliedDryTons;
  }

  const moistureContentPercent = await getDeliveryMoistureContentPercent(input.deliveryId);

  if (moistureContentPercent != null) {
    return kgToTonnes(
      deriveMassDryKg(
        tonnesToKg(input.biocharAppliedTons),
        moistureContentPercent
      )
    );
  }

  if (input.fallbackDryTons != null) {
    return input.fallbackDryTons;
  }

  throw new Error("Dry mass is required when delivery has no moisture content");
}

/**
 * Get applications with pagination
 */
export async function getApplications(
  userId: string,
  options?: { page?: number; pageSize?: number }
): Promise<{ items: Application[]; total: number; page: number; pageSize: number; totalPages: number }> {
  requireAuth(userId);

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(applications);

  const total = Number(totalCount);

  const items = await db
    .select()
    .from(applications)
    .orderBy(desc(applications.applicationDate))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get application by ID
 */
export async function getApplicationById(userId: string, id: string): Promise<Application | null> {
  requireAuth(userId);
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id));
  return application ?? null;
}

/**
 * Get application by code
 */
export async function getApplicationByCode(userId: string, code: string): Promise<Application | null> {
  requireAuth(userId);
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.code, code));
  return application ?? null;
}

/**
 * Get applications by delivery ID
 */
export async function getApplicationsByDeliveryId(
  userId: string,
  deliveryId: string
): Promise<Application[]> {
  requireAuth(userId);
  return db
    .select()
    .from(applications)
    .where(eq(applications.deliveryId, deliveryId))
    .orderBy(desc(applications.applicationDate));
}

/**
 * Create a new application
 */
export async function createApplication(
  userId: string,
  data: CreateApplicationData & { code: string }
): Promise<Application> {
  requireAuth(userId);

  const { capacityKg, alreadyAppliedTons } = await getDeliveryCapacityAndApplied(data.deliveryId);
  const check = checkDeliveryCapacity({ capacityKg, alreadyAppliedTons, requestedTons: data.biocharAppliedTons });
  if (!check.ok) throw new Error(check.errorMessage);

  const biocharAppliedDryTons = await resolveApplicationDryMassTons({
    deliveryId: data.deliveryId,
    biocharAppliedTons: data.biocharAppliedTons,
    biocharAppliedDryTons: data.biocharAppliedDryTons,
  });

  const [application] = await db
    .insert(applications)
    .values({
      code: data.code,
      status: "applied",
      applicationDate: data.applicationDate,
      deliveryId: data.deliveryId,
      biocharAppliedTons: data.biocharAppliedTons,
      biocharAppliedDryTons,
      fieldSizeHa: data.fieldSizeHa ?? null,
      fieldIdentifier: data.fieldIdentifier || null,
      cropType: data.cropType || null,
      gpsLatitude: data.gpsLatitude ?? null,
      gpsLongitude: data.gpsLongitude ?? null,
      applicationMethodType: data.applicationMethodType ?? null,
      gisBoundaryReference: data.gisBoundaryReference || null,
      soilTemperatureSource: data.soilTemperatureSource ?? null,
      soilTemperatureC: data.soilTemperatureC ?? null,
    })
    .returning();

  return application;
}

/**
 * Update an application
 */
export async function updateApplication(
  userId: string,
  id: string,
  data: Omit<UpdateApplicationData, "applicationId">
): Promise<Application> {
  requireAuth(userId);
  const existingApplication = await getApplicationById(userId, id);

  if (!existingApplication) {
    throw new Error("Application not found");
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  const effectiveDeliveryId = data.deliveryId ?? existingApplication.deliveryId;
  const effectiveAppliedTons = data.biocharAppliedTons ?? existingApplication.biocharAppliedTons;

  // Validate inventory — exclude the current application from the already-applied sum
  if (data.deliveryId !== undefined || data.biocharAppliedTons !== undefined) {
    const { capacityKg, alreadyAppliedTons } = await getDeliveryCapacityAndApplied(effectiveDeliveryId, id);
    const check = checkDeliveryCapacity({
      capacityKg,
      alreadyAppliedTons,
      requestedTons: effectiveAppliedTons,
    });
    if (!check.ok) throw new Error(check.errorMessage);
  }

  const shouldRecalculateDryMass =
    data.deliveryId !== undefined ||
    data.biocharAppliedTons !== undefined ||
    data.biocharAppliedDryTons !== undefined;

  if (shouldRecalculateDryMass) {
    updateData.biocharAppliedDryTons = await resolveApplicationDryMassTons({
      deliveryId: effectiveDeliveryId,
      biocharAppliedTons: effectiveAppliedTons,
      biocharAppliedDryTons: data.biocharAppliedDryTons,
      fallbackDryTons:
        data.deliveryId === undefined && data.biocharAppliedTons === undefined
          ? existingApplication.biocharAppliedDryTons
          : null,
    });
  }

  // Only include fields that are explicitly provided
  if (data.code !== undefined) updateData.code = data.code;
  if (data.applicationDate !== undefined) updateData.applicationDate = data.applicationDate;
  if (data.deliveryId !== undefined) updateData.deliveryId = data.deliveryId;
  if (data.biocharAppliedTons !== undefined) updateData.biocharAppliedTons = data.biocharAppliedTons;
  if (data.fieldSizeHa !== undefined) updateData.fieldSizeHa = data.fieldSizeHa;
  if (data.fieldIdentifier !== undefined) updateData.fieldIdentifier = data.fieldIdentifier || null;
  if (data.cropType !== undefined) updateData.cropType = data.cropType || null;
  if (data.gpsLatitude !== undefined) updateData.gpsLatitude = data.gpsLatitude;
  if (data.gpsLongitude !== undefined) updateData.gpsLongitude = data.gpsLongitude;
  if (data.applicationMethodType !== undefined) updateData.applicationMethodType = data.applicationMethodType;
  if (data.gisBoundaryReference !== undefined) updateData.gisBoundaryReference = data.gisBoundaryReference || null;
  if (data.soilTemperatureSource !== undefined) updateData.soilTemperatureSource = data.soilTemperatureSource;
  if (data.soilTemperatureC !== undefined) updateData.soilTemperatureC = data.soilTemperatureC;

  const [application] = await db
    .update(applications)
    .set(updateData)
    .where(eq(applications.id, id))
    .returning();

  return application;
}

/**
 * Delete an application
 */
export async function deleteApplication(userId: string, id: string): Promise<void> {
  requireAuth(userId);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.id, id));

    if (!existing) {
      throw new Error("Application not found");
    }

    const linkedCreditBatches = await getLinkedCreditBatches(tx, id);
    const blockingBatches = linkedCreditBatches.filter((batch) =>
      IMMUTABLE_CREDIT_BATCH_STATUSES.has(batch.status),
    );

    if (blockingBatches.length > 0) {
      const blockingCodes = blockingBatches.map((batch) => batch.code).join(", ");
      throw new Error(
        `Cannot delete application linked to verified or issued credit batches: ${blockingCodes}`,
      );
    }

    await tx
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.applicationId, id));

    for (const creditBatchId of new Set(
      linkedCreditBatches.map((batch) => batch.creditBatchId),
    )) {
      await refreshCreditBatchSummaries(tx, creditBatchId);
    }

    await tx
      .delete(soilTemperatureMeasurements)
      .where(eq(soilTemperatureMeasurements.applicationId, id));

    await tx.delete(applications).where(eq(applications.id, id));
  });
}

/**
 * Check if application code exists
 */
export async function applicationCodeExists(
  userId: string,
  code: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await getApplicationByCode(userId, code);
  if (!existing) return false;
  if (excludeId && existing.id === excludeId) return false;
  return true;
}
