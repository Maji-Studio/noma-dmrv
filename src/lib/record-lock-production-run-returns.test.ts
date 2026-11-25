import { describe, expect, it } from 'vitest';
import { recordLocks } from './record-lock';
import { assertRecordLockFields } from './record-lock-fields';

const RETURN_HOLDER = { kind: 'stockEntry', id: 'return', failedRunReturn: true };

describe('production-run active return lock', () => {
  it('narrows the consumption basis only for active return dependencies', () => {
    const returnLock = recordLocks.productionRun({ dependents: [RETURN_HOLDER], removals: [] });
    expect(returnLock.level).toBe('inUse');
    for (const field of ['feedstockDraws', 'feedstockMoisturePercent', 'status', 'facilityId', 'reactorId', 'startTime', 'endTime']) {
      expect(returnLock.freeFields).not.toContain(field);
    }
    expect(returnLock.freeFields).toContain('feedingRateKgHr');
    const otherStock = recordLocks.productionRun({ dependents: [{ kind: 'stockEntry', id: 'loss' }], removals: [] });
    expect(otherStock.freeFields).toContain('feedstockDraws');
    expect(otherStock.freeFields).toContain('feedstockMoisturePercent');
  });

  it('accepts unchanged basis resubmissions and emits certification_locked for changed moisture', () => {
    const lock = recordLocks.productionRun({ dependents: [RETURN_HOLDER], removals: [] });
    expect(() => assertRecordLockFields(lock, { feedstockMoisturePercent: 20 }, { feedstockMoisturePercent: 20 })).not.toThrow();
    expect(() => assertRecordLockFields(lock, { feedstockMoisturePercent: 20 }, { feedstockMoisturePercent: 30 }))
      .toThrow(expect.objectContaining({ code: 'certification_locked', issues: [expect.objectContaining({ path: ['feedstockMoisturePercent'] })] }));
  });

  it('gives Sent precedence and releases the active-return restriction after reversal', () => {
    const sent = recordLocks.productionRun({ dependents: [RETURN_HOLDER], removals: [{ id: 'removal', submissions: [{ status: 'submitted' }], statements: [] }] });
    expect(sent).toMatchObject({ level: 'sent', freeFields: [], heldBy: [{ kind: 'removal', id: 'removal' }] });
    expect(recordLocks.productionRun({ dependents: [], removals: [] }).level).toBe('open');
  });
});
