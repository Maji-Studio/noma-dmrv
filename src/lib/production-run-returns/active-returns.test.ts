import { describe, expect, it } from 'vitest';
import { activeReturns } from './active-returns';

describe('active return history', () => {
  it('keeps replacements, excludes originals reversed in any order and ignores other movements', () => {
    const original = { id: 'original', movementType: 'failed_run_return', correctsMovementId: null };
    const replacement = { id: 'replacement', movementType: 'failed_run_return', correctsMovementId: 'original' };
    const reversal = { id: 'reversal', movementType: 'failed_run_return_reversal', correctsMovementId: 'original' };
    const loss = { id: 'loss', movementType: 'loss', correctsMovementId: null };
    expect(activeReturns([original, replacement, loss])).toEqual([original, replacement]);
    expect(activeReturns([reversal, original, replacement, loss])).toEqual([replacement]);
    expect(activeReturns([original, replacement, reversal, { ...reversal, id: 'second', correctsMovementId: replacement.id }])).toEqual([]);
  });
});
