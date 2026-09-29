import { describe, expect, it } from 'vitest';
import { stockModeAt } from './stock-mode';

const MERGED = '2026-09-15T10:00:00.000Z';

describe('stockModeAt', () => {
  it('a split bin is split at every time', () => {
    expect(stockModeAt('split', null, MERGED)).toBe('split');
    expect(stockModeAt('split', MERGED, '2026-09-16T10:00:00.000Z')).toBe('split');
  });

  it('a bin created as mix is mix at every time', () => {
    expect(stockModeAt('mix', null, '2020-01-01T00:00:00.000Z')).toBe('mix');
  });

  it('a merged bin is split before the merge and mix from it on', () => {
    expect(stockModeAt('mix', MERGED, '2026-09-15T09:59:59.999Z')).toBe('split');
    expect(stockModeAt('mix', MERGED, MERGED)).toBe('mix');
    expect(stockModeAt('mix', MERGED, '2026-09-20T10:00:00.000Z')).toBe('mix');
  });
});
