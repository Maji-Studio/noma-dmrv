import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, type DbTransaction } from '@/db';
import { biocharProductSourceAllocations, productionRuns } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { productionRunDateExpr } from './production-runs/date-expr';
import { requireOrgScope } from './utils';

export interface BiocharProductSourceAllocationPlanItem {
  productionRunId: string;
  producedAt: Date;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
}

export async function insertBiocharProductSourceAllocations(
  ctx: OrgContext,
  tx: DbTransaction,
  input: {
    biocharProductId: string;
    sourceStorageLocationId: string;
    allocations: BiocharProductSourceAllocationPlanItem[];
  },
): Promise<void> {
  requireOrgScope(ctx);
  if (input.allocations.length === 0) return;

  await tx.insert(biocharProductSourceAllocations).values(
    input.allocations.map((allocation) => ({
      organizationId: ctx.organizationId,
      biocharProductId: input.biocharProductId,
      productionRunId: allocation.productionRunId,
      sourceStorageLocationId: input.sourceStorageLocationId,
      allocatedWetMassKg: allocation.allocatedWetMassKg,
      allocatedDryMassKg: allocation.allocatedDryMassKg,
    })),
  );
}

/** A production run a product drew from; `date` is the run's facility-local start day. */
export interface BiocharProductSourceRun {
  id: string;
  code: string;
  date: string;
}

/** The runs behind each product's saved allocations, oldest first. */
export async function getBiocharProductSourceRuns(
  ctx: OrgContext,
  productIds: string[],
): Promise<Map<string, BiocharProductSourceRun[]>> {
  requireOrgScope(ctx);
  const byProduct = new Map<string, BiocharProductSourceRun[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .select({
      productId: biocharProductSourceAllocations.biocharProductId,
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(ctx.organizationId),
    })
    .from(biocharProductSourceAllocations)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, biocharProductSourceAllocations.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(biocharProductSourceAllocations.organizationId, ctx.organizationId),
      inArray(biocharProductSourceAllocations.biocharProductId, productIds),
    ))
    .orderBy(asc(productionRunDateExpr(ctx.organizationId)), asc(productionRuns.code));
  for (const { productId, ...run } of rows) {
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), run]);
  }
  return byProduct;
}
