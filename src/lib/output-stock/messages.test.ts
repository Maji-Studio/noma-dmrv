import { describe, expect, it } from 'vitest';
import { operatorStockMessage } from './messages';

describe('operator stock messages', () => {
  it('replaces the ledger vocabulary with the field the operator must change', () => {
    expect(operatorStockMessage('Insufficient exact dry solids')).toBe(
      'Not enough dry biochar in the selected bin for this wet mass. Reduce the wet mass or choose another bin.',
    );
  });

  it('passes an unmapped invariant failure through verbatim', () => {
    expect(operatorStockMessage('Exact solids balance does not match conserved dry stock'))
      .toBe('Exact solids balance does not match conserved dry stock');
  });
});
