import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { biocharProductSourceAllocations, biocharProducts, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import type { BiocharProductStatus } from "@/schemas/biochar-products";
import { requireOrgScope } from "./utils";
import { findApiFormulation } from "./api-formulations";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, requireApiLookupFacility, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiBiocharProductFilters {
  q?: string; facilityId?: string; status?: BiocharProductStatus; storageLocationId?: string; formulationId?: string;
  code?: string; placedFrom?: string; placedBefore?: string;
}
interface SavedIngredient {
  formulationIngredientId: string; feedstockTypeId: string; storageLocationId: string | null;
  wetMassKg: number | null; moisturePercent: number | null;
}

function productQuery(ctx: OrgContext) {
  requireOrgScope(ctx);
  return db.select({
    id: biocharProducts.id,
    code: biocharProducts.code,
    version: biocharProducts.version,
    facilityId: biocharProducts.facilityId,
    formulationId: biocharProducts.formulationId,
    status: biocharProducts.status,
    placedAt: biocharProducts.placedAt,
    productionDate: biocharProducts.productionDate,
    expiresAt: biocharProducts.expiresAt,
    sourceBiocharStorageLocationId: biocharProducts.sourceBiocharStorageLocationId,
    storageLocationId: biocharProducts.storageLocationId,
    blendMassKg: biocharProducts.massKg,
    biocharMoisturePercent: biocharProducts.moistureContentPercent,
    waterAddedKg: biocharProducts.waterAddedKg,
    densityKgM3: biocharProducts.densityKgM3,
    archivedAt: biocharProducts.archivedAt,
    createdAt: biocharProducts.createdAt,
    updatedAt: biocharProducts.updatedAt,
    // The row, its saved ingredients and its source allocations share one statement snapshot.
    // Ingredients come from the composition saved with the product, in the order saved (recipe
    // order); source allocations are ordered by run, unique per product. Both orders are total,
    // so repeated reads give identical bytes under one ETag. Raw subquery columns stay qualified
    // so the correlation cannot bind locally.
    ingredients: sql<SavedIngredient[]>`(
      select coalesce(json_agg(json_build_object(
        'formulationIngredientId', line.element->>'formulationIngredientId',
        'feedstockTypeId', line.element->>'feedstockTypeId',
        'storageLocationId', line.element->>'storageLocationId',
        'wetMassKg', line.element->'massKg',
        'moisturePercent', line.element->'moistureContentPercent'
      ) order by line.ordinal), '[]'::json)
      from jsonb_array_elements(case
        when jsonb_typeof("biochar_products"."composition"->'ingredients') = 'array' then "biochar_products"."composition"->'ingredients'
        else '[]'::jsonb end) with ordinality as line(element, ordinal)
    )`,
    sourceAllocations: sql<{ productionRunId: string; wetMassKg: number; dryMassKg: number }[]>`(
      select coalesce(json_agg(json_build_object(
        'productionRunId', allocation.production_run_id,
        'wetMassKg', allocation.allocated_wet_mass_kg,
        'dryMassKg', allocation.allocated_dry_mass_kg
      ) order by allocation.production_run_id), '[]'::json)
      from ${biocharProductSourceAllocations} as allocation
      where allocation.organization_id = ${ctx.organizationId}
        and allocation.biochar_product_id = "biochar_products"."id"
        and allocation.organization_id = "biochar_products"."organization_id"
    )`,
    cursorCreatedAt: lookupCursorCreatedAt(biocharProducts.createdAt),
  }).from(biocharProducts);
}

export async function findApiBiocharProduct(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await productQuery(ctx).where(and(
    eq(biocharProducts.organizationId, ctx.organizationId),
    "id" in identifier ? eq(biocharProducts.id, identifier.id) : eq(biocharProducts.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Biochar product was not found.", {
    issues: [{ path: ["biocharProductId"], code: "not_found", message: "Biochar product was not found." }],
  });
  return row;
}

/** A bin filter that names no bin of this organization answers 404 on its own field. */
async function requireProductBinFilter(ctx: OrgContext, storageLocationId?: string) {
  if (storageLocationId === undefined) return;
  const [bin] = await db.select({ id: storageLocations.id }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId))).limit(1);
  if (!bin) throw new DomainError("not_found", "Storage location was not found.", {
    issues: [{ path: ["storageLocationId"], code: "not_found", message: "Storage location was not found." }],
  });
}

export async function listApiBiocharProducts(ctx: OrgContext, filters: ApiBiocharProductFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  await requireProductBinFilter(ctx, filters.storageLocationId);
  if (filters.formulationId) await findApiFormulation(ctx, { id: filters.formulationId });
  return productQuery(ctx).where(and(
    eq(biocharProducts.organizationId, ctx.organizationId), isNull(biocharProducts.archivedAt),
    filters.facilityId ? eq(biocharProducts.facilityId, filters.facilityId) : undefined,
    filters.status ? eq(biocharProducts.status, filters.status) : undefined,
    filters.storageLocationId ? eq(biocharProducts.storageLocationId, filters.storageLocationId) : undefined,
    filters.formulationId ? eq(biocharProducts.formulationId, filters.formulationId) : undefined,
    filters.code !== undefined ? eq(biocharProducts.code, filters.code) : undefined,
    filters.placedFrom ? gte(biocharProducts.placedAt, new Date(filters.placedFrom)) : undefined,
    filters.placedBefore ? lt(biocharProducts.placedAt, new Date(filters.placedBefore)) : undefined,
    lookupSearch({ name: biocharProducts.code }, filters.q),
    lookupPosition(biocharProducts, cursor),
  )).orderBy(desc(biocharProducts.createdAt), desc(biocharProducts.id)).limit(limit + 1);
}
