import { desc, eq, count, sum, ne, and, isNull, SQL, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications,
  soilTemperatureMeasurements,
  type Application,
} from "@/db/schema/application";
import { certifierProjects } from "@/db/schema/certification";
import {
  creditBatches,
  creditBatchApplications,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers, customerLocations } from "@/db/schema/parties";
import { biocharProducts, formulations } from "@/db/schema/products";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { tonnesToKg, kgToTonnes, KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { checkDeliveryCapacity } from "@/lib/calculations/delivery-inventory";
import type {
  ApplicationEvidenceMethod,
  CreateApplicationData,
  UpdateApplicationData,
} from "@/schemas/applications";

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";

// ============================================
// Application Data Access Layer
// ============================================

const DEFAULT_PAGE_SIZE = 100;
const IMMUTABLE_CREDIT_BATCH_STATUSES = new Set<string>(["verified", "issued"]);

export interface ApplicationDeliveryOptionData {
  id: string;
  code: string;
  deliveryDate: Date;
  orderCode: string | null;
  formulationName: string | null;
  massDryKg: number | null;
  deliveredWetMassKg: number | null;
  orderQuantityKg: number | null;
  moistureContentPercent: number | null;
  defaultSoilTemperatureC: number | null;
  facilityDefaultSoilTemperatureC: number | null;
  destinationGpsLatitude: number | null;
  destinationGpsLongitude: number | null;
  alreadyAppliedWetKg: number;
}

type CreateApplicationInput = Omit<CreateApplicationData, "evidenceMethod"> & {
  evidenceMethod?: ApplicationEvidenceMethod;
};

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function getDeliveryMoistureContentPercent(
  deliveryId: string,
  txOrDb: DbTransaction | typeof db = db,
): Promise<number | null> {
  const [delivery] = await txOrDb
    .select({
      moistureContentPercent: deliveries.moistureContentPercent,
    })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!delivery) {
    throw new SafeError("Delivery not found");
  }

  return delivery.moistureContentPercent;
}

async function getDeliveryCapacityAndApplied(
  deliveryId: string,
  excludeApplicationId?: string,
  txOrDb: DbTransaction | typeof db = db,
): Promise<{ capacityKg: number | null; alreadyAppliedTons: number }> {
  const deliveryQuery = txOrDb
    .select({ deliveredWetMassKg: deliveries.deliveredWetMassKg })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  const [delivery] = await (txOrDb === db
    ? deliveryQuery
    : deliveryQuery.for("update"));

  if (!delivery) throw new SafeError("Delivery not found");

  const conditions = excludeApplicationId
    ? and(eq(applications.deliveryId, deliveryId), ne(applications.id, excludeApplicationId))
    : eq(applications.deliveryId, deliveryId);

  const [{ total }] = await txOrDb
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
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .innerJoin(
      biocharProducts,
      sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
    )
    .innerJoin(
      creditBatchProductionRuns,
      eq(
        creditBatchProductionRuns.productionRunId,
        biocharProducts.linkedProductionRunId,
      ),
    )
    .innerJoin(
      creditBatches,
      eq(creditBatchProductionRuns.creditBatchId, creditBatches.id),
    )
    .where(eq(applications.id, applicationId))
    .for("update", { of: creditBatches });

  return rows;
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
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .innerJoin(
      biocharProducts,
      sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
    )
    .innerJoin(
      creditBatchProductionRuns,
      eq(
        creditBatchProductionRuns.productionRunId,
        biocharProducts.linkedProductionRunId,
      ),
    )
    .where(eq(creditBatchProductionRuns.creditBatchId, creditBatchId));

  const weightTons = linkedApplications.reduce(
    (total, application) => total + Number(application.biocharAppliedTons),
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

async function resolveApplicationDryMassTons(
  input: {
    deliveryId: string;
    biocharAppliedTons: number;
    biocharAppliedDryTons?: number | null;
    fallbackDryTons?: number | null;
  },
  txOrDb: DbTransaction | typeof db = db,
): Promise<number> {
  if (input.biocharAppliedDryTons != null) {
    return input.biocharAppliedDryTons;
  }

  const moistureContentPercent = await getDeliveryMoistureContentPercent(input.deliveryId, txOrDb);

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

  throw new SafeError("Dry mass is required when delivery has no moisture content");
}

/**
 * Get applications with pagination
 */
/**
 * Application list row enriched with distribution context (customer + field
 * location) resolved via the delivery → order chain. The location prefers the
 * delivery's override, falling back to the order's customer location.
 */
export interface ApplicationListItem extends Application {
  customerName: string | null;
  locationName: string | null;
}

export async function getApplications(
  userId: string,
  options?: { page?: number; pageSize?: number; facilityId?: string }
): Promise<{ items: ApplicationListItem[]; total: number; page: number; pageSize: number; totalPages: number }> {
  requireAuth(userId);

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;
  // Applications carry no archived_at — hide them via their archived delivery
  const conditions: SQL[] = [isNull(deliveries.archivedAt)];

  if (options?.facilityId) {
    conditions.push(eq(deliveries.facilityId, options.facilityId));
  }

  const whereClause = and(...conditions);

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .where(whereClause);

  const total = Number(totalCount);

  const items = await db
    .select({
      id: applications.id,
      code: applications.code,
      status: applications.status,
      applicationDate: applications.applicationDate,
      deliveryId: applications.deliveryId,
      biocharAppliedTons: applications.biocharAppliedTons,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      fieldSizeHa: applications.fieldSizeHa,
      fieldIdentifier: applications.fieldIdentifier,
      cropType: applications.cropType,
      gpsLatitude: applications.gpsLatitude,
      gpsLongitude: applications.gpsLongitude,
      applicationMethodType: applications.applicationMethodType,
      evidenceMethod: applications.evidenceMethod,
      gisBoundaryReference: applications.gisBoundaryReference,
      soilTemperatureSource: applications.soilTemperatureSource,
      soilTemperatureC: applications.soilTemperatureC,
      co2eStoredTonnes: applications.co2eStoredTonnes,
      createdAt: applications.createdAt,
      updatedAt: applications.updatedAt,
      customerName: customers.name,
      locationName: customerLocations.name,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(
      customerLocations,
      eq(
        customerLocations.id,
        sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
      ),
    )
    .where(whereClause)
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

export async function getApplicationDeliveryOptions(
  userId: string,
  facilityId?: string,
): Promise<ApplicationDeliveryOptionData[]> {
  requireAuth(userId);

  const conditions: SQL[] = [isNull(deliveries.archivedAt)];
  if (facilityId) {
    conditions.push(eq(deliveries.facilityId, facilityId));
  }

  const whereClause = and(...conditions);

  const [rawDeliveries, appliedRows] = await Promise.all([
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        deliveryDate: deliveries.deliveryDate,
        orderCode: orders.code,
        formulationName: formulations.name,
        massDryKg: deliveries.massDryKg,
        deliveredWetMassKg: deliveries.deliveredWetMassKg,
        orderQuantityKg: orders.quantityKg,
        moistureContentPercent: deliveries.moistureContentPercent,
        defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
        facilityDefaultSoilTemperatureC:
          certifierProjects.defaultSoilTemperatureC,
        destinationGpsLatitude: customerLocations.gpsLatitude,
        destinationGpsLongitude: customerLocations.gpsLongitude,
      })
      .from(deliveries)
      .leftJoin(orders, eq(deliveries.orderId, orders.id))
      .leftJoin(
        customerLocations,
        eq(
          customerLocations.id,
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
      )
      .leftJoin(
        certifierProjects,
        and(
          eq(certifierProjects.facilityId, deliveries.facilityId),
          eq(certifierProjects.provider, "isometric"),
        ),
      )
      .leftJoin(biocharProducts, eq(deliveries.biocharProductId, biocharProducts.id))
      .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
      .where(whereClause)
      .orderBy(desc(deliveries.deliveryDate)),
    db
      .select({
        deliveryId: applications.deliveryId,
        totalAppliedKg: sql<number>`coalesce(sum(${applications.biocharAppliedTons}) * ${KG_PER_TONNE}, 0)`,
      })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(whereClause)
      .groupBy(applications.deliveryId),
  ]);

  const appliedByDeliveryId = new Map(
    appliedRows.map((row) => [row.deliveryId, Number(row.totalAppliedKg)])
  );

  return rawDeliveries.map((delivery) => ({
    ...delivery,
    alreadyAppliedWetKg: appliedByDeliveryId.get(delivery.id) ?? 0,
  }));
}

export interface CreditBatchApplicationOption {
  id: string;
  code: string;
  applicationDate: Date | null;
  biocharAppliedDryTons: number | null;
  fieldIdentifier: string | null;
  facilityId: string;
}

/**
 * The application options the credit-batch auto-match selector pairs against,
 * each tagged with its facility (via the delivery join). Scoped to `facilityId`
 * scoped to `facilityId` — callers must resolve the facility first so this
 * never returns every application in the system.
 */
export async function getCreditBatchApplicationOptions(
  userId: string,
  facilityId: string,
): Promise<CreditBatchApplicationOption[]> {
  requireAuth(userId);
  return db
    .select({
      id: applications.id,
      code: applications.code,
      applicationDate: applications.applicationDate,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      fieldIdentifier: applications.fieldIdentifier,
      facilityId: deliveries.facilityId,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .where(and(eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
    .orderBy(desc(applications.applicationDate));
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
  data: CreateApplicationInput & { code: string }
): Promise<Application> {
  requireAuth(userId);

  return db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "delivery", entityId: data.deliveryId },
      "create",
    );

    const { capacityKg, alreadyAppliedTons } = await getDeliveryCapacityAndApplied(data.deliveryId, undefined, tx);
    const check = checkDeliveryCapacity({ capacityKg, alreadyAppliedTons, requestedTons: data.biocharAppliedTons });
    if (!check.ok) throw new SafeError(check.errorMessage!);

    const biocharAppliedDryTons = await resolveApplicationDryMassTons({
      deliveryId: data.deliveryId,
      biocharAppliedTons: data.biocharAppliedTons,
      biocharAppliedDryTons: data.biocharAppliedDryTons,
    }, tx);

    const [application] = await tx
      .insert(applications)
      .values({
        code: data.code,
        status: "applied",
        applicationDate: data.applicationDate,
        deliveryId: data.deliveryId,
        biocharAppliedTons: data.biocharAppliedTons,
        biocharAppliedDryTons,
        fieldSizeHa: data.fieldSizeHa ?? null,
        fieldIdentifier: optionalText(data.fieldIdentifier),
        cropType: optionalText(data.cropType),
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        applicationMethodType: data.applicationMethodType ?? null,
        evidenceMethod: data.evidenceMethod ?? "visual",
        gisBoundaryReference: optionalText(data.gisBoundaryReference),
        soilTemperatureSource: data.soilTemperatureSource ?? null,
        soilTemperatureC: data.soilTemperatureC ?? null,
      })
      .returning();

    return application;
  });
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

  return db.transaction(async (tx) => {
    const [existingApplication] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .for("update");

    if (!existingApplication) {
      throw new SafeError("Application not found");
    }

    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "application", entityId: id },
      "update",
    );

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    const effectiveDeliveryId = data.deliveryId ?? existingApplication.deliveryId;
    const effectiveAppliedTons = data.biocharAppliedTons ?? existingApplication.biocharAppliedTons;

    if (
      data.deliveryId !== undefined &&
      data.deliveryId !== existingApplication.deliveryId
    ) {
      await assertCanMutateCertifiedLineage(
        tx,
        { entityType: "delivery", entityId: data.deliveryId },
        "update",
      );
    }

    if (data.deliveryId !== undefined || data.biocharAppliedTons !== undefined) {
      const { capacityKg, alreadyAppliedTons } = await getDeliveryCapacityAndApplied(effectiveDeliveryId, id, tx);
      const check = checkDeliveryCapacity({
        capacityKg,
        alreadyAppliedTons,
        requestedTons: effectiveAppliedTons,
      });
      if (!check.ok) throw new SafeError(check.errorMessage!);
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
      }, tx);
    }

    if (data.code !== undefined) updateData.code = data.code;
    if (data.applicationDate !== undefined) updateData.applicationDate = data.applicationDate;
    if (data.deliveryId !== undefined) updateData.deliveryId = data.deliveryId;
    if (data.biocharAppliedTons !== undefined) updateData.biocharAppliedTons = data.biocharAppliedTons;
    if (data.fieldSizeHa !== undefined) updateData.fieldSizeHa = data.fieldSizeHa;
    if (data.fieldIdentifier !== undefined) updateData.fieldIdentifier = optionalText(data.fieldIdentifier);
    if (data.cropType !== undefined) updateData.cropType = optionalText(data.cropType);
    if (data.gpsLatitude !== undefined) updateData.gpsLatitude = data.gpsLatitude;
    if (data.gpsLongitude !== undefined) updateData.gpsLongitude = data.gpsLongitude;
    if (data.applicationMethodType !== undefined) updateData.applicationMethodType = data.applicationMethodType;
    if (data.evidenceMethod !== undefined) updateData.evidenceMethod = data.evidenceMethod;
    if (data.gisBoundaryReference !== undefined) updateData.gisBoundaryReference = optionalText(data.gisBoundaryReference);
    if (data.soilTemperatureSource !== undefined) updateData.soilTemperatureSource = data.soilTemperatureSource;
    if (data.soilTemperatureC !== undefined) updateData.soilTemperatureC = data.soilTemperatureC;

    const [application] = await tx
      .update(applications)
      .set(updateData)
      .where(eq(applications.id, id))
      .returning();

    return application;
  });
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
      throw new SafeError("Application not found");
    }

    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "application", entityId: id },
      "delete",
    );

    const linkedCreditBatches = await getLinkedCreditBatches(tx, id);
    const blockingBatches = linkedCreditBatches.filter((batch) =>
      IMMUTABLE_CREDIT_BATCH_STATUSES.has(batch.status),
    );

    if (blockingBatches.length > 0) {
      const blockingCodes = blockingBatches.map((batch) => batch.code).join(", ");
      throw new SafeError(
        `Cannot delete application linked to verified or issued credit batches: ${blockingCodes}`,
      );
    }

    await tx
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.applicationId, id));

    await tx
      .delete(soilTemperatureMeasurements)
      .where(eq(soilTemperatureMeasurements.applicationId, id));

    await tx.delete(applications).where(eq(applications.id, id));

    for (const creditBatchId of new Set(
      linkedCreditBatches.map((batch) => batch.creditBatchId),
    )) {
      await refreshCreditBatchSummaries(tx, creditBatchId);
    }
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
