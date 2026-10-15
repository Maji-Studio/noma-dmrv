import { db } from "@/db";
import { numericAggregate } from "@/db/aggregate";
import { applications, type Application } from "@/db/schema/application";
import { certifierProjects } from "@/db/schema/certification";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations, customers } from "@/db/schema/parties";
import { formulations } from "@/db/schema/products";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import type { ApplicationEvidenceMethod, ApplicationStatus } from "@/schemas/applications";
import type { DeliveryStatus } from "@/schemas/deliveries";
import { and, count, desc, eq, ilike, inArray, isNull, or, SQL, sql } from "drizzle-orm";
import { getApplicationAllocationShares, type ApplicationAllocationShare } from "./delivery-allocation-provenance";
import { getMixBinHeldApplicationIds } from "./mix-bin-credit-hold";
import { applicationEvidenceGapCountSql } from "./application-evidence-sql";
import { inDeliveryCreditBatchLineage } from "./credit-batch-lineage-filter";
import { facilityTimestampDateExpr } from "./output-stock-dates";
import { requireOrgScope } from "./utils";
const DEFAULT_PAGE_SIZE = 100;

export interface ApplicationDeliveryOptionData {
  id: string;
  code: string;
  status: DeliveryStatus;
  deliveryDate: Date;
  /** The delivery's calendar day on its facility clock ("YYYY-MM-DD"). */
  deliveryDay: string | null;
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

/**
 * Get applications with pagination
 */
/**
 * Application list row enriched with distribution context (customer + field
 * location) resolved from the delivery's order customer location.
 */
export interface ApplicationListItem extends Application {
  allocationShares: ApplicationAllocationShare[];
  /** Drawn from a mix bin: recorded as usual, but held out of credit batches (ADR 0030). */
  heldOutOfCredits: boolean;
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
          orders.customerLocationId,
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
      version: applications.version,
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
          orders.customerLocationId,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause)
    .orderBy(desc(applications.applicationDate))
    .limit(pageSize)
    .offset(offset);

  const allocationShares = await getApplicationAllocationShares(ctx, items.map(item => item.id));
  const heldOut = await getMixBinHeldApplicationIds(ctx, db, items.map(item => item.id));
  return {
    items: items.map(item => ({ ...item, allocationShares: allocationShares.filter(share => share.applicationId === item.id), heldOutOfCredits: heldOut.has(item.id) })),
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
        facilityTimezone: facilities.timezone,
        deliveryDay: facilityTimestampDateExpr(deliveries.deliveryDate, facilities.timezone),
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
      .leftJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
      .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
      .leftJoin(
        customerLocations,
        and(
          eq(customerLocations.id, orders.customerLocationId),
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
