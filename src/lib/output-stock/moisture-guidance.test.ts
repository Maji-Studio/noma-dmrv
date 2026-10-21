import { describe, expect, it } from 'vitest';
import { moistureBasisText, moistureReadingGuidance, moistureRemovalCaption } from './moisture-guidance';

const ZONE = 'Africa/Dar_es_Salaam';

describe('moistureReadingGuidance', () => {
  it('shows the estimate as one line and never proposes a value', () => {
    expect(moistureReadingGuidance({ moisturePercent: 29.43, basisText: 'From the stock count on Sep 15, 2026, 14:30.' }, null))
      .toEqual({ cue: 'Estimated moisture: 29.4%', basisText: 'From the stock count on Sep 15, 2026, 14:30.', warning: undefined });
  });

  it('warns, without blocking, when a reading is more than five points from the estimate', () => {
    const estimate = { moisturePercent: 29.4, basisText: null };
    expect(moistureReadingGuidance(estimate, 34.4).warning).toBeUndefined();
    // 34.45 against 29.44 reads as 5.0 points, so it stays quiet like the figure it shows.
    expect(moistureReadingGuidance({ moisturePercent: 29.44, basisText: null }, 34.45).warning).toBeUndefined();
    expect(moistureReadingGuidance(estimate, 22.1).warning).toBe('22.1% is 7.3 points below the 29.4% estimate. Check the reading before you save.');
  });

  it('has nothing to say without an estimate', () => {
    expect(moistureReadingGuidance(null, 40)).toEqual({ cue: undefined, basisText: undefined, warning: undefined });
  });
});

describe('moistureBasisText', () => {
  it('names the reading or the recorded batch moisture, on the facility clock', () => {
    expect(moistureBasisText({ source: 'reading', at: '2026-09-15T11:30:00.000Z' }, ZONE)).toBe('From the stock count on Sep 15, 2026, 14:30.');
    expect(moistureBasisText({ source: 'recorded', at: '2026-09-15T11:30:00.000Z' }, ZONE)).toBe('From the moisture recorded when the batch was added on Sep 15, 2026, 14:30.');
    expect(moistureBasisText(null, ZONE)).toBeNull();
  });
});

describe('removal bases', () => {
  const at = '2026-10-20T11:30:00.000Z';

  it('says which removal set the estimate, for each movement kind', () => {
    expect(moistureBasisText({ source: 'removal', at, kind: 'loss' }, ZONE)).toBe("From the lost mass on Oct 20, 2026, 14:30, which was wetter than the bin's estimate.");
    expect(moistureBasisText({ source: 'removal', at, kind: 'delivery' }, ZONE)).toContain('From the delivery on Oct 20, 2026');
    expect(moistureBasisText({ source: 'removal', at, kind: 'production_draw' }, ZONE)).toContain('From the product draw on');
    expect(moistureBasisText({ source: 'removal', at, kind: 'something_new' }, ZONE)).toContain('From a removal on');
  });

  it('never reads a removal as recorded intake', () => {
    expect(moistureBasisText({ source: 'removal', at, kind: 'loss' }, ZONE)).not.toContain('batch was added');
  });

  it('captions the bin card only for a removal, on the facility date', () => {
    expect(moistureRemovalCaption({ source: 'removal', at, kind: 'loss' }, ZONE)).toBe('Moisture estimated from the lost mass of Oct 20');
    expect(moistureRemovalCaption({ source: 'removal', at, kind: 'delivery' }, ZONE)).toBe('Moisture estimated from the delivery of Oct 20');
    // 23:30 UTC is already Oct 21 in Dar es Salaam.
    expect(moistureRemovalCaption({ source: 'removal', at: '2026-10-20T23:30:00.000Z', kind: 'loss' }, ZONE)).toBe('Moisture estimated from the lost mass of Oct 21');
    expect(moistureRemovalCaption({ source: 'recorded', at }, ZONE)).toBeNull();
    expect(moistureRemovalCaption(null, ZONE)).toBeNull();
  });
});
