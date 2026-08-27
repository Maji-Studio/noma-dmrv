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
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { numericAggregate } from "@/db/aggregate";
import {
  applications,
  soilTemperatureMeasurements,
  type Application,
} from "@/db/schema/application";
import { certifierProjects } from "@/db/schema/certification";
import { facilities, storageLocations } from "@/db/schema/facilities";
import {
  creditBatches,
  creditBatchApplications,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers, customerLocations } from "@/db/schema/parties";
import {
  biocharProductSourceAllocations,
  biocharProducts,
  formulations,
} from "@/db/schema/products";
import { allocateTrackedDryBiocharKg } from "@/lib/biochar-mass-accounting";
import {
  FIELD_SIZE_REQUIRED_MESSAGE,
  FIELD_SIZE_POSITIVE_MESSAGE,
  isPositiveApplicationFieldSize,
} from "@/lib/application-field-size";
import { tonnesToKg, kgToTonnes, KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { checkDeliveryCapacity } from "@/lib/calculations/delivery-inventory";
import {
  applicationEvidenceStateSchema,
  type ApplicationEvidenceMethod,
  type ApplicationStatus,
  type CreateApplicationData,
  type UpdateApplicationData,
} from "@/schemas/applications";
import type { GisBoundary } from "@/schemas/gis-boundary";
import type { DeliveryStatus } from "@/schemas/deliveries";

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { inCreditBatchLineage } from "./credit-batch-lineage-filter";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { reconcileUnassignedCreditBatchApplicationSlices } from "./credit-batch-application-slices";
import { applicationEvidenceGapCountSql } from "./application-evidence-sql";
import { retireDocumentsForEntities } from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import { parseGisBoundary } from "@/schemas/gis-boundary";

// ============================================
// Application Data Access Layer
// ============================================

const DEFAULT_PAGE_SIZE = 100;
const IMMUTABLE_CREDIT_BATCH_STATUSES = new Set<string>(["verified", "issued"]);
const INVALID_APPLICATION_EVIDENCE_MESSAGE = "Application evidence is invalid.";
function assertPositiveApplicationFieldSize(
  fieldSizeHa: number | null | undefined,
): asserts fieldSizeHa is number {
  if (!isPositiveApplicationFieldSize(fieldSizeHa)) {
    throw new SafeError(
      fieldSizeHa == null
        ? FIELD_SIZE_REQUIRED_MESSAGE
        : FIELD_SIZE_POSITIVE_MESSAGE,
    );
  }
}

async function assertApplicationSlicesAreMutable(
  ctx: OrgContext,
  tx: DbTransaction,
  applicationId: string,
  mutation: "update" | "delete",
): Promise<void> {
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
    .leftJoin(
      biocharProductSourceAllocations,
      and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          biocharProducts.id,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .innerJoin(
      creditBatchProductionRuns,
      and(
        or(
          eq(
            creditBatchProductionRuns.productionRunId,
            biocharProductSourceAllocations.productionRunId,
          ),
          and(
            isNull(biocharProducts.sourceBiocharStorageLocationId),
            eq(
              creditBatchProductionRuns.productionRunId,
              biocharProducts.linkedProductionRunId,
            ),
          ),
        )!,
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
      "Tracked dry biochar is not available. Complete the linked product's biochar mass and moisture, then save the delivery again.",
    );
  }
  return kgToTonnes(allocatedDryKg);
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
      inCreditBatchLineage(
        ctx,
        options.creditBatchId,
        sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
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
      .leftJoin(
        biocharProducts,
        and(
          eq(
            biocharProducts.id,
            sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
          ),
          eq(biocharProducts.organizationId, ctx.organizationId),
        ),
      )
      .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
      .leftJoin(
        storageLocations,
        and(
          eq(biocharProducts.storageLocationId, storageLocations.id),
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
  assertPositiveApplicationFieldSize(data.fieldSizeHa);

  return db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "delivery", entityId: data.deliveryId },
      "create",
      "application",
    );

    // Before the capacity check — upcoming deliveries carry no delivered
    // mass, so checkDeliveryCapacity skips and would silently accept them.
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
