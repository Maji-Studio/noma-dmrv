import { describe, expect, it } from 'vitest';
import { outputStockPostSchema, outputStockPreviewSchema } from './output-stock';
const input = { storageLocationId: '00000000-0000-4000-8000-000000000001', facilityId: '00000000-0000-4000-8000-000000000002', occurredAt: '2026-09-14T12:00:00.000Z', kind: 'loss' as const, wetMassKg: 120, moisturePercent: 30 };
describe('output operation boundary', () => {
  it.each([undefined, null, NaN, Infinity, -1, 100])('rejects invalid positive-draw moisture %s', moisturePercent => {
    expect(outputStockPreviewSchema.safeParse({ ...input, moisturePercent }).success).toBe(false);
  });
  it('closes a zero count without moisture but rejects a zero loss', () => {
    expect(outputStockPreviewSchema.safeParse({ ...input, kind: 'count', wetMassKg: 0, moisturePercent: undefined }).success).toBe(true);
    expect(outputStockPreviewSchema.safeParse({ ...input, wetMassKg: 0 }).success).toBe(false);
  });
  it('requires idempotency, preview and a reason for posting', () => {
    expect(outputStockPostSchema.safeParse(input).success).toBe(false);
    expect(outputStockPostSchema.safeParse({ ...input, idempotencyKey: 'request', basisFingerprint: 'basis', reason: 'Spillage' }).success).toBe(true);
    expect(outputStockPostSchema.safeParse({ ...input, idempotencyKey: ' ', basisFingerprint: 'basis', reason: ' ' }).success).toBe(false);
  });
  it('requires mass and moisture to round-trip through stored precision', () => {
    expect(outputStockPreviewSchema.safeParse({ ...input, wetMassKg: 0.0001 }).success).toBe(false);
    expect(outputStockPreviewSchema.safeParse({ ...input, moisturePercent: 30.0000001 }).success).toBe(false);
    expect(outputStockPreviewSchema.safeParse({ ...input, wetMassKg: 0.001, moisturePercent: 30.000001 }).success).toBe(true);
  });
  it('rejects invalid calendar dates', () => {
    expect(outputStockPreviewSchema.safeParse({ ...input, occurredAt: '2026-02-30T12:00:00.000Z' }).success).toBe(false);
  });
  it('words every operator-facing failure in plain language, never raw Zod text', () => {
    const messages = (value: unknown) => {
      const result = outputStockPostSchema.safeParse(value);
      return result.success ? [] : result.error.issues.map(issue => issue.message);
    };
    const base = { ...input, idempotencyKey: 'request', basisFingerprint: 'basis', reason: 'Spillage' };
    expect(messages({ ...base, wetMassKg: null })).toEqual(['Enter the wet mass.']);
    expect(messages({ ...base, wetMassKg: undefined })).toEqual(['Enter the wet mass.']);
    expect(messages({ ...base, moisturePercent: 'x' })).toEqual(['Enter the moisture as a number.']);
    expect(messages({ ...base, reason: '' })).toEqual(['Enter a reason.']);
    expect(messages({ ...base, reason: ' ' })).toEqual(['Enter a reason.']);
    const all = [
      ...messages({ ...base, wetMassKg: null, reason: '' }),
      ...messages({ ...base, sources: [{ layerId: 'nope', moisturePercent: null }] }),
    ];
    for (const message of all) expect(message).not.toMatch(/Invalid input|expected|Too small/);
  });
});
