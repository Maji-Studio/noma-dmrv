import { describe, expect, it } from 'vitest';
import { recordProductionRunReturnSchema } from './production-run-returns';
const valid = { sourceProductionRunId: '12345678-1234-4234-8234-123456789abc', storageLocationId: '12345678-1234-4234-8234-123456789abd',
  idempotencyKey: 'draft', wetMassKg: '200', moisturePercent: '75', occurredAt: '2026-01-01T12:00:00Z', reason: 'Quenched material' };
describe('return input', () => {
  it('parses measured fields and an absolute physical instant', () => {
    expect(recordProductionRunReturnSchema.parse(valid)).toMatchObject({ wetMassKg: 200, moisturePercent: 75, occurredAt: new Date(valid.occurredAt).toISOString() });
  });
  it.each([
    { wetMassKg: '' }, { wetMassKg: Infinity }, { wetMassKg: 0 }, { wetMassKg: 0.0001 }, { wetMassKg: 100_000_001 },
    { moisturePercent: '' }, { moisturePercent: 100 }, { moisturePercent: 20.00001 }, { reason: '  ' },
    { idempotencyKey: '' }, { occurredAt: '' }, { occurredAt: '2026-01-01T12:00:00' }, { storageLocationId: 'bad' },
  ])('refuses incomplete or unpersistable fields %j', patch => {
    expect(recordProductionRunReturnSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
