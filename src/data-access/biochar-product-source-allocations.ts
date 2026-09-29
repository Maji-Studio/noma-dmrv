import type { DbTransaction } from '@/db';
import { biocharProductSourceAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
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
