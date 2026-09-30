import { describe, expect, it } from 'vitest';
import { moistureBasisText, moistureReadingGuidance } from './moisture-guidance';

const ZONE = 'Africa/Dar_es_Salaam';

describe('moistureReadingGuidance', () => {
  it('shows the estimate as one line and never proposes a value', () => {
    expect(moistureReadingGuidance({ moisturePercent: 29.43, basisText: 'From the reading on Sep 15, 2026, 14:30.' }, null))
      .toEqual({ helperText: 'Estimated moisture: 29.4%', basisText: 'From the reading on Sep 15, 2026, 14:30.', warning: undefined });
  });

  it('warns, without blocking, when a reading is more than five points from the estimate', () => {
    const estimate = { moisturePercent: 29.4, basisText: null };
    expect(moistureReadingGuidance(estimate, 34.4).warning).toBeUndefined();
    // 34.45 against 29.44 reads as 5.0 points, so it stays quiet like the figure it shows.
    expect(moistureReadingGuidance({ moisturePercent: 29.44, basisText: null }, 34.45).warning).toBeUndefined();
    expect(moistureReadingGuidance(estimate, 22.1).warning).toBe('22.1% is 7.3 points below the 29.4% estimate. Check the reading before you save.');
  });

  it('has nothing to say without an estimate', () => {
    expect(moistureReadingGuidance(null, 40)).toEqual({ helperText: undefined, basisText: undefined, warning: undefined });
  });
});

describe('moistureBasisText', () => {
  it('names the reading or the recorded batch moisture, on the facility clock', () => {
    expect(moistureBasisText({ source: 'reading', at: '2026-09-15T11:30:00.000Z' }, ZONE)).toBe('From the reading on Sep 15, 2026, 14:30.');
    expect(moistureBasisText({ source: 'recorded', at: '2026-09-15T11:30:00.000Z' }, ZONE)).toBe('From the moisture recorded when the batch was added on Sep 15, 2026, 14:30.');
    expect(moistureBasisText(null, ZONE)).toBeNull();
  });
});
