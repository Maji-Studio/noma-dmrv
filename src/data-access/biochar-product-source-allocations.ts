import type { DbTransaction } from '@/db';
import { biocharProductSourceAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { decimal, divide, grams, kilograms, multiply, planOutputStock, rational, round } from '@/lib/output-stock';
import { getBiocharOutputStockLayers } from './output-stock';
import { requireOrgScope } from './utils';

export interface AvailableBiocharSourceLot {
  productionRunId: string;
  producedAt: Date;
  availableWetMassKg: number;
  availableDryMassKg: number | null;
  feasibilityWetMassKg?: number;
}

export interface BiocharProductSourceAllocationPlanItem {
  productionRunId: string;
  producedAt: Date;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
}

export interface BiocharProductSourceAllocationPlan {
  allocations: BiocharProductSourceAllocationPlanItem[];
  productionDate: Date | null;
  availableWetMassKg: number;
}


export class UnresolvedBiocharDryMassError extends SafeError {
  constructor(public readonly productionRunId: string) { super('Biochar dry mass is unresolved'); }
}
export class InsufficientTraceableBiocharError extends SafeError {
  constructor(public readonly availableWetMassKg: number, public readonly requestedWetMassKg: number) { super('Not enough traceable biochar is available'); }
}
export class InsufficientSourceDryMassError extends SafeError {
  constructor(public readonly availableDryMassKg: number, public readonly requestedDryMassKg: number) { super('Not enough traceable dry biochar is available'); }
}
/** Adapter retained for callers of the source planner; the shared exact FIFO owns allocation. */
export function planBiocharProductSourceAllocations(lots: AvailableBiocharSourceLot[], requestedWetMassKg: number,
  documentedLossWetMassKg = 0, requestedDryMassKg: number | null = null): BiocharProductSourceAllocationPlan {
  if (documentedLossWetMassKg !== 0) throw new SafeError('Losses require posted dry-solids provenance.');
  if (requestedDryMassKg === null) throw new SafeError('Measured source dry mass is required.');
  if (requestedDryMassKg <= 0 || requestedDryMassKg > requestedWetMassKg) throw new SafeError('Source dry mass must be positive and no greater than wet mass.');
  const layers = lots.map((lot, index) => {
    if (lot.availableDryMassKg == null) throw new UnresolvedBiocharDryMassError(lot.productionRunId);
    return { id: lot.productionRunId, physicalDate: lot.producedAt.toISOString().slice(0, 10), postingSequence: BigInt(index),
      establishedDryBiocharKg: lot.availableDryMassKg, ingredientDrySolidsKg: 0, remainingDryBiocharKg: lot.availableDryMassKg,
      runs: [{ productionRunId: lot.productionRunId, establishedDryKg: lot.availableDryMassKg, remainingDryKg: lot.availableDryMassKg }] };
  });
  const plan = planOutputStock(layers, '9999-12-31', { kind: 'solids', solidsKg: requestedDryMassKg });
  let cumulative = BigInt(0), previous = BigInt(0);
  const allocations = plan.allocations.map(a => {
    cumulative += grams(a.dryKg);
    const next = round(multiply(rational(cumulative), divide(decimal(requestedWetMassKg), decimal(requestedDryMassKg))));
    const allocatedWetMassKg = Number(kilograms(next - previous)); previous = next;
    return { productionRunId: a.layerId, producedAt: lots.find(l => l.productionRunId === a.layerId)!.producedAt, allocatedWetMassKg, allocatedDryMassKg: Number(a.dryKg) };
  });
  return { allocations, productionDate: allocations[0]?.producedAt ?? null, availableWetMassKg: Number(kilograms(layers.reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0)))) * requestedWetMassKg / requestedDryMassKg };
}
export async function buildBiocharProductSourceAllocationPlan(ctx: OrgContext, tx: DbTransaction, input: {
  sourceStorageLocationId: string; facilityId: string; physicalDate: string; requestedWetMassKg: number; requestedDryMassKg: number;
}): Promise<BiocharProductSourceAllocationPlan> {
  requireOrgScope(ctx);
  const state = await getBiocharOutputStockLayers(ctx, { storageLocationId: input.sourceStorageLocationId, facilityId: input.facilityId, physicalDate: input.physicalDate }, tx);
  return planBiocharProductSourceAllocations(state.layers.filter(l => l.physicalDate <= input.physicalDate && grams(l.remainingDryBiocharKg) > BigInt(0)).map(l => ({ productionRunId: l.id, producedAt: new Date(l.physicalDate), availableDryMassKg: Number(l.remainingDryBiocharKg), availableWetMassKg: 0 })), input.requestedWetMassKg, 0, input.requestedDryMassKg);
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
