import { describe, expect, it } from 'vitest';
import { outputStockPostSchema, outputStockPreviewSchema } from './output-stock';
const input = { storageLocationId: '00000000-0000-4000-8000-000000000001', facilityId: '00000000-0000-4000-8000-000000000002', physicalDate: '2026-09-14', kind: 'loss' as const, wetMassKg: 120, moisturePercent: 30 };
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
    expect(outputStockPreviewSchema.safeParse({ ...input, physicalDate: '2026-02-30' }).success).toBe(false);
  });
});
