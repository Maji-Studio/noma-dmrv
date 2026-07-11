import { desc, eq, count, sum, ne, and, isNull, SQL, sql } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import {
  applications,
  soilTemperatureMeasurements,
  type Application,
} from "@/db/schema/application";
import { certifierProjects } from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
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
import type { DeliveryStatus } from "@/schemas/deliveries";

import { requireOrgScope } from "./utils";
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
  status: DeliveryStatus;
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
  ctx: OrgContext,
  deliveryId: string,
  txOrDb: DbTransaction | typeof db = db,
): Promise<number | null> {
  const [delivery] = await txOrDb
    .select({
      moistureContentPercent: deliveries.moistureContentPercent,
    })
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  if (!delivery) {
    throw new SafeError("Delivery not found");
  }

  return delivery.moistureContentPercent;
}

async function getDeliveryCapacityAndApplied(
  ctx: OrgContext,
  deliveryId: string,
  excludeApplicationId?: string,
  txOrDb: DbTransaction | typeof db = db,
): Promise<{ capacityKg: number | null; alreadyAppliedTons: number }> {
  const deliveryQuery = txOrDb
    .select({ deliveredWetMassKg: deliveries.deliveredWetMassKg })
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  const [delivery] = await (txOrDb === db
    ? deliveryQuery
    : deliveryQuery.for("update"));

  if (!delivery) throw new SafeError("Delivery not found");

  const conditions = and(
    eq(applications.organizationId, ctx.organizationId),
    eq(applications.deliveryId, deliveryId),
    excludeApplicationId ? ne(applications.id, excludeApplicationId) : undefined,
  );

  const [{ total }] = await txOrDb
    .select({ total: sum(applications.biocharAppliedTons) })
    .from(applications)
    .where(conditions);

  return {
    capacityKg: delivery.deliveredWetMassKg,
    alreadyAppliedTons: Number(total ?? 0),
  };
}

/**
 * Custody-ordering guard (issue #284): applications may only be recorded
 * against deliveries already marked delivered, and never dated before the
 * delivery. `deliveryDate` is the delivered date by convention — there is no
 * separate delivered-at column.
 */
async function assertDeliveryAcceptsApplication(
  ctx: OrgContext,
  deliveryId: string,
  applicationDate: Date,
  txOrDb: DbTransaction | typeof db = db,
): Promise<void> {
  const deliveryQuery = txOrDb
    .select({
      code: deliveries.code,
      status: deliveries.status,
      deliveryDate: deliveries.deliveryDate,
    })
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  // Lock the row inside a transaction (mirrors getDeliveryCapacityAndApplied)
  // so a concurrent delivered→upcoming flip can't slip past the guard.
  const [delivery] = await (txOrDb === db
    ? deliveryQuery
    : deliveryQuery.for("update"));

  if (!delivery) {
    throw new SafeError("Delivery not found");
  }

  if (delivery.status !== "delivered") {
    throw new SafeError(
      `Delivery ${delivery.code} has not been delivered yet — mark it as delivered before recording an application against it`,
    );
  }

  // Compare at day granularity — application dates arrive as UTC midnight
  // (z.coerce.date on a date-only string) while delivery dates may carry a
  // time component, so truncate in UTC to keep both on the same basis
  // regardless of server timezone.
  const deliveryDayStart = new Date(delivery.deliveryDate);
  deliveryDayStart.setUTCHours(0, 0, 0, 0);
  if (applicationDate < deliveryDayStart) {
    throw new SafeError(
      `Application date cannot be before the delivery date of ${delivery.code}`,
    );
  }
}

async function getLinkedCreditBatches(
  ctx: OrgContext,
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
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .innerJoin(
      biocharProducts,
      and(
        sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      creditBatchProductionRuns,
      and(
        eq(creditBatchProductionRuns.productionRunId, biocharProducts.linkedProductionRunId),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      creditBatches,
      and(eq(creditBatchProductionRuns.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)),
    )
    .where(and(eq(applications.id, applicationId), eq(applications.organizationId, ctx.organizationId)))
    .for("update", { of: creditBatches });

  return rows;
}

async function resolveApplicationDryMassTons(
  ctx: OrgContext,
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

  const moistureContentPercent = await getDeliveryMoistureContentPercent(ctx, input.deliveryId, txOrDb);

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
  /**
   * Facility durability tier (ADR 0021), join-derived via the delivery's
   * facility. Drives tier-aware certify readiness — soil temperature is a
   * 200-year-only input, so its gap is scoped to 200-year facilities
   * (certify-field-registry.ts → application.soilTemperatureC condition).
   */
  durabilityOption: "200_year" | "1000_year";
}

export async function getApplications(
  ctx: OrgContext,
  options?: { page?: number; pageSize?: number; facilityId?: string }
): Promise<{ items: ApplicationListItem[]; total: number; page: number; pageSize: number; totalPages: number }> {
  requireOrgScope(ctx);

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;
  // Applications carry no archived_at — hide them via their archived delivery
  const conditions: SQL[] = [
    eq(applications.organizationId, ctx.organizationId),
    isNull(deliveries.archivedAt),
  ];

  if (options?.facilityId) {
    conditions.push(eq(deliveries.facilityId, options.facilityId));
  }

  const whereClause = and(...conditions);

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(applications)
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .where(whereClause);

  const total = Number(totalCount);

  const items = await db
    .select({
      id: applications.id,
      organizationId: applications.organizationId,
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
      durabilityOption: facilities.durabilityOption,
    })
    .from(applications)
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  facilityId?: string,
): Promise<ApplicationDeliveryOptionData[]> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(deliveries.organizationId, ctx.organizationId), isNull(deliveries.archivedAt)];
  if (facilityId) {
    conditions.push(eq(deliveries.facilityId, facilityId));
  }

  const whereClause = and(...conditions);

  const [rawDeliveries, appliedRows] = await Promise.all([
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        status: deliveries.status,
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
      .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
      .leftJoin(
        customerLocations,
        and(
          eq(customerLocations.id, sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`),
          eq(customerLocations.organizationId, ctx.organizationId),
        ),
      )
      .leftJoin(
        certifierProjects,
        and(
          eq(certifierProjects.facilityId, deliveries.facilityId),
          eq(certifierProjects.provider, "isometric"),
          eq(certifierProjects.organizationId, ctx.organizationId),
        ),
      )
      .leftJoin(biocharProducts, and(eq(deliveries.biocharProductId, biocharProducts.id), eq(biocharProducts.organizationId, ctx.organizationId)))
      .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
      .where(whereClause)
      .orderBy(desc(deliveries.deliveryDate)),
    db
      .select({
        deliveryId: applications.deliveryId,
        totalAppliedKg: sql<number>`coalesce(sum(${applications.biocharAppliedTons}) * ${KG_PER_TONNE}, 0)`,
      })
      .from(applications)
      .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
      .where(and(whereClause, eq(applications.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  facilityId: string,
): Promise<CreditBatchApplicationOption[]> {
  requireOrgScope(ctx);
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
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .where(and(eq(applications.organizationId, ctx.organizationId), eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
    .orderBy(desc(applications.applicationDate));
}

/**
 * Get application by ID
 */
export async function getApplicationById(ctx: OrgContext, id: string): Promise<Application | null> {
  requireOrgScope(ctx);
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)));
  return application ?? null;
}

/**
 * Get application by code
 */
export async function getApplicationByCode(ctx: OrgContext, code: string): Promise<Application | null> {
  requireOrgScope(ctx);
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.code, code), eq(applications.organizationId, ctx.organizationId)));
  return application ?? null;
}

/**
 * Get applications by delivery ID
 */
export async function getApplicationsByDeliveryId(
  ctx: OrgContext,
  deliveryId: string
): Promise<Application[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(applications)
    .where(and(eq(applications.deliveryId, deliveryId), eq(applications.organizationId, ctx.organizationId)))
    .orderBy(desc(applications.applicationDate));
}

/**
 * Create a new application
 */
export async function createApplication(
  ctx: OrgContext,
  data: CreateApplicationInput & { code: string }
): Promise<Application> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "delivery", entityId: data.deliveryId },
      "create",
    );

    // Before the capacity check — upcoming deliveries carry no delivered
    // mass, so checkDeliveryCapacity skips and would silently accept them.
    await assertDeliveryAcceptsApplication(ctx, data.deliveryId, data.applicationDate, tx);

    const { capacityKg, alreadyAppliedTons } = await getDeliveryCapacityAndApplied(ctx, data.deliveryId, undefined, tx);
    const check = checkDeliveryCapacity({ capacityKg, alreadyAppliedTons, requestedTons: data.biocharAppliedTons });
    if (!check.ok) throw new SafeError(check.errorMessage!);

    const biocharAppliedDryTons = await resolveApplicationDryMassTons(ctx, {
      deliveryId: data.deliveryId,
      biocharAppliedTons: data.biocharAppliedTons,
      biocharAppliedDryTons: data.biocharAppliedDryTons,
    }, tx);

    const [application] = await tx
      .insert(applications)
      .values({
        organizationId: ctx.organizationId,
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
  ctx: OrgContext,
  id: string,
  data: Omit<UpdateApplicationData, "applicationId">
): Promise<Application> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const [existingApplication] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)))
      .for("update");

    if (!existingApplication) {
      throw new SafeError("Application not found");
    }

    await assertCanMutateCertifiedLineage(
      ctx,
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
        ctx,
        tx,
        { entityType: "delivery", entityId: data.deliveryId },
        "update",
      );
    }

    if (data.deliveryId !== undefined || data.applicationDate !== undefined) {
      await assertDeliveryAcceptsApplication(
        ctx,
        effectiveDeliveryId,
        data.applicationDate ?? existingApplication.applicationDate,
        tx,
      );
    }

    if (data.deliveryId !== undefined || data.biocharAppliedTons !== undefined) {
      const { capacityKg, alreadyAppliedTons } = await getDeliveryCapacityAndApplied(ctx, effectiveDeliveryId, id, tx);
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
      updateData.biocharAppliedDryTons = await resolveApplicationDryMassTons(ctx, {
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
      .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)))
      .returning();

    return application;
  });
}

/**
 * Delete an application
 */
export async function deleteApplication(ctx: OrgContext, id: string): Promise<void> {
  requireOrgScope(ctx);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)));

    if (!existing) {
      throw new SafeError("Application not found");
    }

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "application", entityId: id },
      "delete",
    );

    const linkedCreditBatches = await getLinkedCreditBatches(ctx, tx, id);
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
      .where(and(eq(creditBatchApplications.applicationId, id), eq(creditBatchApplications.organizationId, ctx.organizationId)));

    await tx
      .delete(soilTemperatureMeasurements)
      .where(and(eq(soilTemperatureMeasurements.applicationId, id), eq(soilTemperatureMeasurements.organizationId, ctx.organizationId)));

    await tx.delete(applications).where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)));
    // Batch aggregates (applied weight, CO2e stored) are derived on read
    // (issue #285) — no write-back sync is needed after removing a member.
  });
}

/**
 * Check if application code exists
 */
export async function applicationCodeExists(
  ctx: OrgContext,
  code: string,
  excludeId?: string
): Promise<boolean> {
  requireOrgScope(ctx);
  const existing = await getApplicationByCode(ctx, code);
  if (!existing) return false;
  if (excludeId && existing.id === excludeId) return false;
  return true;
}
