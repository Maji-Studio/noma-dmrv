import { db, type DbTransaction } from "@/db";
import { numericAggregate } from "@/db/aggregate";
import {
  applications,
  soilTemperatureMeasurements,
  type Application,
} from "@/db/schema/application";
import { applicationOutputAllocations } from "@/db/schema/application-output-allocations";
import { certifierProjects } from "@/db/schema/certification";
import {
  creditBatchApplications,
  creditBatches,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations, customers } from "@/db/schema/parties";
import {
  formulations,
} from "@/db/schema/products";
import { isPositiveApplicationFieldSize } from "@/lib/application-field-size";
import type { OrgContext } from "@/lib/auth/server";
import { allocateTrackedDryBiocharKg } from "@/lib/biochar-mass-accounting";
import { checkDeliveryCapacity } from "@/lib/calculations/delivery-inventory";
import { KG_PER_TONNE, kgToTonnes, tonnesToKg } from "@/lib/calculations/unit-conversions";
import {
  applicationEvidenceStateSchema,
  type ApplicationEvidenceMethod,
  type ApplicationStatus,
  type CreateApplicationData,
  type UpdateApplicationData,
} from "@/schemas/applications";
import type { DeliveryStatus } from "@/schemas/deliveries";
import type { GisBoundary } from "@/schemas/gis-boundary";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  SQL,
  sql,
  sum,
} from "drizzle-orm";
import { GRAMS_PER_KG, massGrams, splitGrams } from "./delivery-allocation-math";
import { getApplicationAllocationShares, saveApplicationOutputAllocations, type ApplicationAllocationShare } from "./delivery-allocation-provenance";

import { SafeError } from "@/lib/errors";
import { parseGisBoundary } from "@/schemas/gis-boundary";
import { applicationEvidenceGapCountSql } from "./application-evidence-sql";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { reconcileUnassignedCreditBatchApplicationSlices } from "./credit-batch-application-slices";
import { inDeliveryCreditBatchLineage } from "./credit-batch-lineage-filter";
import { retireDocumentsForEntities } from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import { requireOrgScope } from "./utils";

// ============================================
// Application Data Access Layer
// ============================================

const DEFAULT_PAGE_SIZE = 100;
const IMMUTABLE_CREDIT_BATCH_STATUSES = new Set<string>(["verified", "issued"]);
const INVALID_APPLICATION_EVIDENCE_MESSAGE = "Application evidence is invalid.";
function assertPositiveApplicationFieldSize(
  fieldSizeHa: number | null | undefined,
  applicationCode: string,
): asserts fieldSizeHa is number {
  if (!isPositiveApplicationFieldSize(fieldSizeHa)) {
    throw new SafeError(
      `Application ${applicationCode} needs a field size greater than 0 ha. Enter a field size and save again.`,
    );
  }
}

async function assertApplicationSlicesAreMutable(
  ctx: OrgContext,
  tx: DbTransaction,
  applicationId: string,
  mutation: "update" | "delete",
): Promise<void> {
  requireOrgScope(ctx);
  const [ownedSlice] = await tx
    .select({ removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications)
    .where(
      and(
        eq(creditBatchApplications.applicationId, applicationId),
        isNotNull(creditBatchApplications.removalId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!ownedSlice) return;

  throw new SafeError(
    `Cannot ${mutation} this Application because its applied mass belongs to a Removal.`,
  );
}

export interface ApplicationDeliveryOptionData {
  id: string;
  code: string;
  status: DeliveryStatus;
  deliveryDate: Date;
  orderCode: string | null;
  formulationName: string | null;
  productBinName: string | null;
  massDryKg: number | null;
  deliveredWetMassKg: number | null;
  orderQuantityKg: number | null;
  moistureContentPercent: number | null;
  defaultSoilTemperatureC: number | null;
  facilityDefaultSoilTemperatureC: number | null;
  destinationGpsLatitude: number | null;
  destinationGpsLongitude: number | null;
  alreadyAppliedWetKg: number;
  alreadyAppliedDryKg: number;
}

type CreateApplicationInput = Omit<
  CreateApplicationData,
  "evidenceMethod" | "gisBoundary"
> & {
  evidenceMethod?: ApplicationEvidenceMethod;
  gisBoundary?: GisBoundary | null;
};

type UpdateApplicationInput = Omit<UpdateApplicationData, "applicationId">;

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function getDeliveryCapacityAndApplied(
  ctx: OrgContext,
  deliveryId: string,
  excludeApplicationId?: string,
  txOrDb: DbTransaction | typeof db = db,
): Promise<{
  capacityKg: number | null;
  deliveryDryBiocharKg: number | null;
  alreadyAppliedTons: number;
  alreadyAppliedDryTons: number;
}> {
  requireOrgScope(ctx);
  const deliveryQuery = txOrDb
    .select({
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      massDryKg: deliveries.massDryKg,
    })
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

  const [{ total, totalDry }] = await txOrDb
    .select({
      total: sum(applications.biocharAppliedTons),
      totalDry: sum(applications.biocharAppliedDryTons),
    })
    .from(applications)
    .where(conditions);

  return {
    capacityKg: delivery.deliveredWetMassKg,
    deliveryDryBiocharKg: delivery.massDryKg,
    alreadyAppliedTons: Number(total ?? 0),
    alreadyAppliedDryTons: Number(totalDry ?? 0),
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
  requireOrgScope(ctx);
  const deliveryQuery = txOrDb
    .select({
      code: deliveries.code,
      status: deliveries.status,
      deliveryDate: deliveries.deliveryDate,
    })
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  // Serialize applications with delivery corrections.
  const [delivery] = await (txOrDb === db
    ? deliveryQuery
    : deliveryQuery.for("update"));

  if (!delivery) {
    throw new SafeError("Delivery not found");
  }

  if (delivery.status !== "delivered") {
    throw new SafeError(
      `Delivery ${delivery.code} is not marked as delivered. Mark it as delivered before recording an application.`,
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
  requireOrgScope(ctx);
  const rows = await tx
    .select({
      creditBatchId: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
    })
    .from(applications)
    .innerJoin(applicationOutputAllocations, and(eq(applicationOutputAllocations.applicationId, applications.id), eq(applicationOutputAllocations.organizationId, ctx.organizationId)))
    .innerJoin(creditBatchProductionRuns, and(eq(creditBatchProductionRuns.productionRunId, applicationOutputAllocations.productionRunId), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)))
    .innerJoin(
      creditBatches,
      and(eq(creditBatchProductionRuns.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)),
    )
    .where(and(eq(applications.id, applicationId), eq(applications.organizationId, ctx.organizationId)))
    .for("update", { of: creditBatches });

  return rows;
}

function resolveApplicationDryMassTons(
  input: {
    biocharAppliedTons: number;
    deliveryWetKg: number | null;
    deliveryDryBiocharKg: number | null;
    alreadyAppliedTons: number;
    alreadyAppliedDryTons: number;
  },
): number {
  const allocatedDryKg = allocateTrackedDryBiocharKg({
    totalWetKg: input.deliveryWetKg,
    totalDryBiocharKg: input.deliveryDryBiocharKg,
    requestedWetKg: tonnesToKg(input.biocharAppliedTons),
    allocatedWetKg: tonnesToKg(input.alreadyAppliedTons),
    allocatedDryBiocharKg: tonnesToKg(input.alreadyAppliedDryTons),
  });
  if (allocatedDryKg == null) {
    throw new SafeError(
      "Tracked dry biochar is not available. Save the delivery source allocations before recording an application.",
    );
  }
  const totalWet = massGrams(input.deliveryWetKg!);
  const totalDry = massGrams(input.deliveryDryBiocharKg!);
  const appliedWet = massGrams(tonnesToKg(input.alreadyAppliedTons));
  const requestedWet = massGrams(tonnesToKg(input.biocharAppliedTons));
  const appliedDry = massGrams(tonnesToKg(input.alreadyAppliedDryTons));
  if (appliedWet + requestedWet > totalWet) throw new SafeError("Application exceeds the saved delivery wet mass.");
  const cumulativeDry = splitGrams(appliedWet + requestedWet, [totalDry, totalWet - totalDry])[0];
  return kgToTonnes(Math.max(0, cumulativeDry - appliedDry) / GRAMS_PER_KG);
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
  allocationShares: ApplicationAllocationShare[];
  deliveryCode: string;
  customerName: string | null;
  locationName: string | null;
  /** Join-derived count of missing visual roles or boundary evidence inputs. */
  evidenceGapCount: number;
  /**
   * Facility durability tier (ADR 0021), join-derived via the delivery's
   * facility. Drives tier-aware certify readiness — soil temperature is a
   * 200-year-only input, so its gap is scoped to 200-year facilities
   * (certify-field-registry.ts → application.soilTemperatureC condition).
   */
  durabilityOption: "200_year" | "1000_year";
}

export interface ApplicationListOptions {
  page?: number;
  pageSize?: number;
  facilityId?: string;
  creditBatchId?: string;
  ids?: string[];
  search?: string;
  status?: ApplicationStatus;
  evidenceMethod?: ApplicationEvidenceMethod;
}

export async function getApplications(
  ctx: OrgContext,
  options?: ApplicationListOptions,
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
  if (options?.creditBatchId) {
    conditions.push(
      inDeliveryCreditBatchLineage(
        ctx,
        options.creditBatchId,
        deliveries.id,
      ),
    );
  }
  if (options?.ids?.length) {
    conditions.push(inArray(applications.id, options.ids));
  }
  if (options?.search?.trim()) {
    const searchPattern = `%${options.search.trim()}%`;
    conditions.push(
      or(
        ilike(applications.code, searchPattern),
        ilike(deliveries.code, searchPattern),
        ilike(applications.fieldIdentifier, searchPattern),
        ilike(applications.cropType, searchPattern),
        ilike(customers.name, searchPattern),
        ilike(customerLocations.name, searchPattern),
      )!,
    );
  }
  if (options?.status) {
    conditions.push(eq(applications.status, options.status));
  }
  if (options?.evidenceMethod) {
    // Legacy rows with no stored method render as Visual throughout the UI,
    // so the server facet must preserve that same fallback.
    conditions.push(
      options.evidenceMethod === "visual"
        ? or(
            eq(applications.evidenceMethod, options.evidenceMethod),
            isNull(applications.evidenceMethod),
          )!
        : eq(applications.evidenceMethod, options.evidenceMethod),
    );
  }

  const whereClause = and(...conditions);

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(applications)
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(
        eq(
          customerLocations.id,
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
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
      deliveryCode: deliveries.code,
      biocharAppliedTons: applications.biocharAppliedTons,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      fieldSizeHa: applications.fieldSizeHa,
      fieldIdentifier: applications.fieldIdentifier,
      cropType: applications.cropType,
      gpsLatitude: applications.gpsLatitude,
      gpsLongitude: applications.gpsLongitude,
      applicationMethodType: applications.applicationMethodType,
      evidenceMethod: applications.evidenceMethod,
      gisBoundary: applications.gisBoundary,
      soilTemperatureSource: applications.soilTemperatureSource,
      soilTemperatureC: applications.soilTemperatureC,
      co2eStoredTonnes: applications.co2eStoredTonnes,
      createdAt: applications.createdAt,
      updatedAt: applications.updatedAt,
      customerName: customers.name,
      locationName: customerLocations.name,
      durabilityOption: facilities.durabilityOption,
      evidenceGapCount: applicationEvidenceGapCountSql(),
    })
    .from(applications)
    .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
    .innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(
        eq(
          customerLocations.id,
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause)
    .orderBy(desc(applications.applicationDate))
    .limit(pageSize)
    .offset(offset);

  const allocationShares = await getApplicationAllocationShares(ctx, items.map(item => item.id));
  return {
    items: items.map(item => ({ ...item, allocationShares: allocationShares.filter(share => share.applicationId === item.id) })),
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
        productBinName: storageLocations.name,
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
      .leftJoin(formulations, and(eq(formulations.id, sql`orders.formulation_id`), eq(formulations.organizationId, ctx.organizationId)))
      .leftJoin(
        storageLocations,
        and(
          eq(deliveries.storageLocationId, storageLocations.id),
          eq(storageLocations.organizationId, ctx.organizationId),
        ),
      )
      .where(whereClause)
      .orderBy(desc(deliveries.deliveryDate)),
    db
      .select({
        deliveryId: applications.deliveryId,
        totalAppliedKg: numericAggregate(
          sql<number>`coalesce(sum(${applications.biocharAppliedTons}) * ${KG_PER_TONNE}, 0)`,
        ),
        totalAppliedDryKg: numericAggregate(
          sql<number>`coalesce(sum(${applications.biocharAppliedDryTons}) * ${KG_PER_TONNE}, 0)`,
        ),
      })
      .from(applications)
      .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
      .where(and(whereClause, eq(applications.organizationId, ctx.organizationId)))
      .groupBy(applications.deliveryId),
  ]);

  const appliedByDeliveryId = new Map(
    appliedRows.map((row) => [row.deliveryId, row])
  );

  return rawDeliveries.map((delivery) => {
    const applied = appliedByDeliveryId.get(delivery.id);
    return {
      ...delivery,
      alreadyAppliedWetKg: applied?.totalAppliedKg ?? 0,
      alreadyAppliedDryKg: applied?.totalAppliedDryKg ?? 0,
    };
  });
}

/**
 * Get application by ID
 */
export async function getApplicationById(ctx: OrgContext, id: string): Promise<(Application & { allocationShares: ApplicationAllocationShare[] }) | null> {
  requireOrgScope(ctx);
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)));
  return application ? { ...application, allocationShares: await getApplicationAllocationShares(ctx, [application.id]) } : null;
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
 * Create a new application
 */
export async function createApplication(
  ctx: OrgContext,
  data: CreateApplicationInput & { code: string }
): Promise<Application> {
  requireOrgScope(ctx);
  assertPositiveApplicationFieldSize(data.fieldSizeHa, data.code);

  return db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "delivery", entityId: data.deliveryId },
      "create",
      "application",
    );

    // Validate physical custody date before allocating the saved truck.
    await assertDeliveryAcceptsApplication(ctx, data.deliveryId, data.applicationDate, tx);

    const {
      capacityKg,
      deliveryDryBiocharKg,
      alreadyAppliedTons,
      alreadyAppliedDryTons,
    } = await getDeliveryCapacityAndApplied(ctx, data.deliveryId, undefined, tx);
    const check = checkDeliveryCapacity({ capacityKg, alreadyAppliedTons, requestedTons: data.biocharAppliedTons });
    if (!check.ok) throw new SafeError(check.errorMessage!);

    const biocharAppliedDryTons = resolveApplicationDryMassTons({
      biocharAppliedTons: data.biocharAppliedTons,
      deliveryWetKg: capacityKg,
      deliveryDryBiocharKg,
      alreadyAppliedTons,
      alreadyAppliedDryTons,
    });

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
        fieldSizeHa: data.fieldSizeHa,
        fieldIdentifier: optionalText(data.fieldIdentifier),
        cropType: optionalText(data.cropType),
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        applicationMethodType: data.applicationMethodType ?? null,
        evidenceMethod: data.evidenceMethod ?? "location",
        gisBoundary:
          data.gisBoundary === null || data.gisBoundary === undefined
            ? null
            : parseGisBoundary(data.gisBoundary),
        soilTemperatureSource: data.soilTemperatureSource ?? null,
        soilTemperatureC: data.soilTemperatureC ?? null,
      })
      .returning();

    await saveApplicationOutputAllocations(ctx, tx, application);

    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
      applicationIds: [application.id],
    });

    return application;
  });
}

/**
 * Update an application
 */
export async function updateApplication(
  ctx: OrgContext,
  id: string,
  data: UpdateApplicationInput,
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
    await tx.select({ id: deliveries.id }).from(deliveries)
      .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, [...new Set([existingApplication.deliveryId, data.deliveryId ?? existingApplication.deliveryId])].sort())))
      .orderBy(deliveries.id).for("update");

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "application", entityId: id },
      "update",
    );

    assertPositiveApplicationFieldSize(
      data.fieldSizeHa === undefined
        ? existingApplication.fieldSizeHa
        : data.fieldSizeHa,
      existingApplication.code,
    );

    const evidenceState = applicationEvidenceStateSchema.safeParse({
      evidenceMethod:
        data.evidenceMethod ?? existingApplication.evidenceMethod,
      gpsLatitude:
        data.gpsLatitude === undefined
          ? existingApplication.gpsLatitude
          : data.gpsLatitude,
      gpsLongitude:
        data.gpsLongitude === undefined
          ? existingApplication.gpsLongitude
          : data.gpsLongitude,
    });
    if (!evidenceState.success) {
      throw new SafeError(
        evidenceState.error.issues[0]?.message ??
          INVALID_APPLICATION_EVIDENCE_MESSAGE,
      );
    }

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
        "application",
        "selected",
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

    let deliveryMassState: Awaited<ReturnType<typeof getDeliveryCapacityAndApplied>> | null = null;
    if (data.deliveryId !== undefined || data.biocharAppliedTons !== undefined) {
      deliveryMassState = await getDeliveryCapacityAndApplied(ctx, effectiveDeliveryId, id, tx);
      const { capacityKg, alreadyAppliedTons } = deliveryMassState;
      const check = checkDeliveryCapacity({
        capacityKg,
        alreadyAppliedTons,
        requestedTons: effectiveAppliedTons,
      });
      if (!check.ok) throw new SafeError(check.errorMessage!);
    }

    const shouldRecalculateDryMass =
      data.deliveryId !== undefined ||
      data.biocharAppliedTons !== undefined;

    if (shouldRecalculateDryMass) {
      await assertApplicationSlicesAreMutable(ctx, tx, id, "update");
    }

    if (shouldRecalculateDryMass && deliveryMassState) {
      updateData.biocharAppliedDryTons = resolveApplicationDryMassTons({
        biocharAppliedTons: effectiveAppliedTons,
        deliveryWetKg: deliveryMassState.capacityKg,
        deliveryDryBiocharKg: deliveryMassState.deliveryDryBiocharKg,
        alreadyAppliedTons: deliveryMassState.alreadyAppliedTons,
        alreadyAppliedDryTons: deliveryMassState.alreadyAppliedDryTons,
      });
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
    if (data.gisBoundary !== undefined) {
      updateData.gisBoundary =
        data.gisBoundary === null ? null : parseGisBoundary(data.gisBoundary);
    }
    if (data.soilTemperatureSource !== undefined) updateData.soilTemperatureSource = data.soilTemperatureSource;
    if (data.soilTemperatureC !== undefined) updateData.soilTemperatureC = data.soilTemperatureC;

    const [application] = await tx
      .update(applications)
      .set(updateData)
      .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)))
      .returning();

    if (shouldRecalculateDryMass) await saveApplicationOutputAllocations(ctx, tx, application);

    await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
      applicationIds: [application.id],
    });

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
      .select({ id: applications.id, deliveryId: applications.deliveryId })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)))
      .for("update");

    if (!existing) {
      throw new SafeError("Application not found");
    }
    await tx.select({ id: deliveries.id }).from(deliveries)
      .where(and(eq(deliveries.id, existing.deliveryId), eq(deliveries.organizationId, ctx.organizationId))).for("update");

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "application", entityId: id },
      "delete",
    );
    await assertApplicationSlicesAreMutable(ctx, tx, id, "delete");

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

    await tx.delete(applicationOutputAllocations).where(and(eq(applicationOutputAllocations.applicationId, id), eq(applicationOutputAllocations.organizationId, ctx.organizationId)));

    await tx.delete(applications).where(and(eq(applications.id, id), eq(applications.organizationId, ctx.organizationId)));
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "application", entityId: id },
    ]);
    // Batch aggregates (applied weight, CO2e stored) are derived on read
    // (issue #285) — no write-back sync is needed after removing a member.
  });
  await processPendingStorageObjectDeletions(ctx);
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
