import { db } from "@/db";
import { biocharProducts } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { summarizeBiocharProductMass } from "@/lib/biochar-product-mass";
import { and, eq, isNull } from "drizzle-orm";
import { sourceAllocationAggregate } from "./biochar-products";
import { requireOrgScope } from "./utils";

export interface BiocharProductStats {
  totalProducts: number;
  totalWetMassKg: number | null;
  totalDryBiocharMassKg: number | null;
}

export interface BiocharProductStatsFilters {
  facilityId?: string;
}

export async function getBiocharProductStats(
  ctx: OrgContext,
  filters?: BiocharProductStatsFilters,
): Promise<BiocharProductStats> {
  requireOrgScope(ctx);
  const allocationAggregate = sourceAllocationAggregate(ctx);
  const conditions = [isNull(biocharProducts.archivedAt)];
  if (filters?.facilityId) {
    conditions.push(eq(biocharProducts.facilityId, filters.facilityId));
  }

  const products = await db.select({
    massKg: biocharProducts.massKg,
    waterAddedKg: biocharProducts.waterAddedKg,
    moistureContentPercent: biocharProducts.moistureContentPercent,
    composition: biocharProducts.composition,
    sourceAllocatedDryMassKg: allocationAggregate.allocatedDryMassKg,
  })
    .from(biocharProducts)
    .leftJoin(allocationAggregate, eq(allocationAggregate.biocharProductId, biocharProducts.id))
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), ...conditions));

  return {
    totalProducts: products.length,
    ...summarizeBiocharProductMass(products),
  };
}
