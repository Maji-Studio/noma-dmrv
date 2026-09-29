import { describe, expect, it } from 'vitest';
import { stockModeAt, type StockModeChange } from './stock-mode';

const MERGED = '2026-09-15T10:00:00.000Z';
const SPLIT = '2026-09-20T10:00:00.000Z';
const change = (to: StockModeChange['to'], at: string, sequence: number): StockModeChange => ({ to, at, sequence: BigInt(sequence) });

describe('stockModeAt', () => {
  it('a bin that never changed mode keeps its mode at every time', () => {
    expect(stockModeAt('split', [], MERGED)).toBe('split');
    expect(stockModeAt('mix', [], '2020-01-01T00:00:00.000Z')).toBe('mix');
  });

  it('a merged bin is split before the merge and mix from it on', () => {
    const changes = [change('mix', MERGED, 1)];
    expect(stockModeAt('mix', changes, '2026-09-15T09:59:59.999Z')).toBe('split');
    expect(stockModeAt('mix', changes, MERGED)).toBe('mix');
    expect(stockModeAt('mix', changes, '2026-09-18T10:00:00.000Z')).toBe('mix');
  });

  it('a mix bin switched back to split stays mix for entries timed before the switch', () => {
    const changes = [change('mix', MERGED, 1), change('split', SPLIT, 2)];
    expect(stockModeAt('split', changes, '2026-09-14T10:00:00.000Z')).toBe('split');
    expect(stockModeAt('split', changes, '2026-09-18T10:00:00.000Z')).toBe('mix');
    expect(stockModeAt('split', changes, SPLIT)).toBe('split');
  });

  it('a bin created as mix and later split is mix before the switch', () => {
    const changes = [change('split', SPLIT, 5), change('mix', '2026-09-25T10:00:00.000Z', 9)];
    expect(stockModeAt('mix', changes, '2026-09-01T10:00:00.000Z')).toBe('mix');
    expect(stockModeAt('mix', changes, '2026-09-22T10:00:00.000Z')).toBe('split');
    expect(stockModeAt('mix', changes, '2026-09-26T10:00:00.000Z')).toBe('mix');
  });

  it('two changes at one instant: the later posting wins', () => {
    const changes = [change('split', SPLIT, 7), change('mix', SPLIT, 3)];
    expect(stockModeAt('split', changes, SPLIT)).toBe('split');
  });
});
