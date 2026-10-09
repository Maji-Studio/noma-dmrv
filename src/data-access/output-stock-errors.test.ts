import { describe, expect, it } from 'vitest';
import { SafeError } from '@/lib/errors';
import { blockedOutputStockError, OutputStockShortageError, outputReferenceNotFound } from './output-stock-errors';

const message = 'Not enough dry biochar in the selected bin for this wet mass at this moisture. Reduce the wet mass or choose another bin.';

describe('blockedOutputStockError', () => {
  it('types a capacity failure as a shortage with the same message', () => {
    const error = blockedOutputStockError({ kind: 'insufficient_stock', storageLocationId: 'bin', availableSolidsKg: 10, requestedSolidsKg: 12 }, message);
    expect(error).toBeInstanceOf(OutputStockShortageError);
    expect(error.message).toBe(message);
    expect((error as OutputStockShortageError).details).toEqual({ storageLocationId: 'bin', availableSolidsKg: 10, requestedSolidsKg: 12 });
  });

  it('keeps a short sub-bin on the detail', () => {
    const error = blockedOutputStockError({ kind: 'insufficient_stock', storageLocationId: 'bin', layerId: 'run', availableSolidsKg: 10, requestedSolidsKg: 12 }, message);
    expect((error as OutputStockShortageError).details).toMatchObject({ layerId: 'run' });
  });

  it.each([
    ['an invalid request', { kind: 'invalid_request' as const }],
    ['no classification', null],
    ['an untyped caller', undefined],
  ])('keeps %s a plain refusal', (_label, blocking) => {
    const error = blockedOutputStockError(blocking, 'This load is used up before it reaches B-0419. Untick B-0419.');
    expect(error).not.toBeInstanceOf(OutputStockShortageError);
    expect(error).toBeInstanceOf(SafeError);
    expect(error.message).toBe('This load is used up before it reaches B-0419. Untick B-0419.');
  });
});

it('points a missing output reference at the field that named it', () => {
  expect(outputReferenceNotFound('Output bin was not found.', ['storageLocationId'])).toMatchObject({
    code: 'not_found', message: 'Output bin was not found.', issues: [{ path: ['storageLocationId'], code: 'not_found', message: 'Output bin was not found.' }],
  });
});
