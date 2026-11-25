import { db } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { getRecordLocks } from '../certification-lineage-guards';
import { readRecordDependents } from '../record-lock-dependents';
import { requireOrgScope } from '../utils';
import { getProductionRunReturnAllowance, getProductionRunReturnHistory, readReturnSource } from './queries';

type Reader = Pick<typeof db, 'select' | 'selectDistinct'>;
export type ProductionRunReturnEligibility = {
  eligible: boolean;
  blocker: string | null;
  code: 'certification_locked' | 'ineligible' | null;
  consumedDryKg: number | null;
  returnedDryKg: number | null;
  remainingDryKg: number | null;
  returnedFeedstockTypeId: string | null;
};

/** Advisory only. The writer repeats every check while holding its locks. */
export async function getProductionRunReturnEligibility(ctx: OrgContext, sourceProductionRunId: string, reader: Reader = db): Promise<ProductionRunReturnEligibility> {
  requireOrgScope(ctx);
  // Verify ownership even when an eligibility refusal would otherwise hide it.
  await readReturnSource(ctx, reader, sourceProductionRunId);
  const target = { entityType: 'productionRun' as const, entityId: sourceProductionRunId };
  const [lock] = await getRecordLocks(ctx, reader, [target], { sentOnly: true });
  const unavailable = { consumedDryKg: null, returnedDryKg: null, remainingDryKg: null, returnedFeedstockTypeId: null };
  if (lock.level === 'sent') return { ...unavailable, eligible: false, code: 'certification_locked', blocker: lock.howToFree };
  const history = await getProductionRunReturnHistory(ctx, sourceProductionRunId, reader);
  const returnIds = new Set(history.map(row => row.id));
  const dependents = await readRecordDependents(ctx, reader, target);
  if (dependents.some(row => row.kind !== 'stockEntry' || !returnIds.has(row.id))) {
    return { ...unavailable, eligible: false, code: 'certification_locked', blocker: 'The run is in use. Correct its dependent records before returning material.' };
  }
  try {
    const allowance = await getProductionRunReturnAllowance(ctx, sourceProductionRunId, reader);
    const { consumedDryKg, remainingDryKg, returnedFeedstockTypeId } = allowance;
    return { consumedDryKg, remainingDryKg, returnedDryKg: consumedDryKg - remainingDryKg, returnedFeedstockTypeId,
      eligible: remainingDryKg > 0, code: remainingDryKg > 0 ? null : 'ineligible',
      blocker: remainingDryKg > 0 ? null : 'All consumed dry material has been returned. Correct an existing return to change its measurements.' };
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    return { ...unavailable, eligible: false, code: 'ineligible', blocker: error.message };
  }
}
