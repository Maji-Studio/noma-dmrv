import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { conflictCode } from '@/lib/conflict-ref';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
import { formatFeedstockLossLockReason } from '@/lib/feedstock-loss-lock';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';
import type { FeedstockLedgerEntry } from '@/types/feedstock-bin-ledger';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
import { requireOrgScope } from './utils';

/** Refuse a feedstock correction with the blocking ledger entry and bin. */
export async function throwFeedstockLossLockError(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationId: string,
  blocker: FeedstockLedgerEntry,
): Promise<never> {
  requireOrgScope(ctx);
  const [bin] = await tx.select({ code: storageLocations.code, facilityId: storageLocations.facilityId })
    .from(storageLocations).where(and(
      eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId),
    ));
  if (!bin) throw new SafeError('Storage bin not found');
  const timeZone = await getOutputStockFacilityTimezone(ctx, bin.facilityId, tx);
  const entity = blocker.kind === 'run_draw' ? STOCK_CONFLICT_ENTITY.productionRun
    : blocker.kind === 'ingredient_draw' ? STOCK_CONFLICT_ENTITY.biocharProduct : STOCK_CONFLICT_ENTITY.binMovement;
  throw new DomainError('certification_locked', formatFeedstockLossLockReason(blocker, timeZone), {
    conflict: { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: storageLocationId, code: conflictCode(bin.code) },
    blockers: [{ entity, id: blocker.sourceId ?? blocker.id,
      code: conflictCode(blocker.code ?? `${blocker.reason} (${formatFacilityDateTime(blocker.occurredAt, timeZone)})`) }],
  });
}
