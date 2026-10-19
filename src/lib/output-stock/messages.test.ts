import { describe, expect, it } from 'vitest';
import { calculatedWithoutNotice, operatorStockMessage } from './messages';

describe('operator stock messages', () => {
  it('replaces the ledger vocabulary with the field the operator must change', () => {
    expect(operatorStockMessage('Insufficient exact dry solids')).toBe(
      "Not enough dry biochar in the selected bin for this wet mass at this moisture. Reduce the wet mass or choose another bin.",
    );
  });

  it('passes an unmapped invariant failure through verbatim', () => {
    expect(operatorStockMessage('Exact solids balance does not match conserved dry stock'))
      .toBe('Exact solids balance does not match conserved dry stock');
  });

  it('names the saved mix removals a backdated entry leaves alone, singular and plural', () => {
    expect(calculatedWithoutNotice([])).toBeNull();
    expect(calculatedWithoutNotice([{ label: 'Delivery D-0012 (Sep 15, 2026, 14:30)' }])).toBe(
      'This entry is timed before a saved removal, Delivery D-0012 (Sep 15, 2026, 14:30). That removal keeps the batch shares it was saved with. Check the time, then save.',
    );
    expect(calculatedWithoutNotice([{ label: 'Delivery D-0012 (Sep 15, 2026, 14:30)' }, { label: 'Stock loss (Sep 16, 2026, 09:00)' }, { label: 'Product P-7 (Sep 17, 2026, 08:00)' }])).toBe(
      'This entry is timed before 3 saved removals: Delivery D-0012 (Sep 15, 2026, 14:30), Stock loss (Sep 16, 2026, 09:00) and Product P-7 (Sep 17, 2026, 08:00). Those removals keep the batch shares they were saved with. Check the time, then save.',
    );
  });
});
