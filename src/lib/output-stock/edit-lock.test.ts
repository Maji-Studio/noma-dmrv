import { expect, it } from 'vitest';
import { stockEntryLockReason, stockReceiptMarker } from './edit-lock';
import { STOCK_ENTRY_LOCKED_REASON } from './labels';

const before = new Date('2026-09-01T12:00:00Z');
const after = new Date('2026-09-15T12:00:00Z');
const original = { postingSequence: BigInt(1), createdAt: new Date('2026-09-14T12:00:00Z'), inputSnapshot: {} };
const receipts = [{ id: 'a', recordedAt: before }];

it('uses a bounded identity marker independent of receipt timestamps and list order', () => {
  const marker = stockReceiptMarker(receipts);
  const saved = { ...original, inputSnapshot: { receiptMarker: marker } };
  expect(stockEntryLockReason(saved, BigInt(1), [{ id: 'a', recordedAt: after }])).toBeNull();
  expect(stockEntryLockReason(saved, BigInt(1), [...receipts, { id: 'b', recordedAt: before }])).toBe(STOCK_ENTRY_LOCKED_REASON);
  expect(stockEntryLockReason(saved, BigInt(1), [{ id: 'b', recordedAt: before }])).toBe(STOCK_ENTRY_LOCKED_REASON);
  expect(stockReceiptMarker([...receipts, { id: 'b', recordedAt: before }]))
    .toEqual(stockReceiptMarker([{ id: 'b', recordedAt: after }, ...receipts]));
  expect(stockReceiptMarker(Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }))).identityHash).toHaveLength(marker.identityHash.length);
});

it('still locks on a newer posting sequence', () => {
  expect(stockEntryLockReason({ ...original, inputSnapshot: { receiptMarker: stockReceiptMarker(receipts) } }, BigInt(2), receipts))
    .toBe(STOCK_ENTRY_LOCKED_REASON);
});

it('reads saved receipt IDs and legacy product versions before falling back to timestamps', () => {
  for (const inputSnapshot of [{ receiptIds: ['a'] }, { preview: { expectedProductVersions: { a: 1 } } }]) {
    expect(stockEntryLockReason({ ...original, inputSnapshot }, BigInt(1), receipts)).toBeNull();
    expect(stockEntryLockReason({ ...original, inputSnapshot }, BigInt(1), [{ id: 'b', recordedAt: before }])).toBe(STOCK_ENTRY_LOCKED_REASON);
  }
  expect(stockEntryLockReason(original, BigInt(1), receipts)).toBeNull();
  expect(stockEntryLockReason(original, BigInt(1), [{ id: 'a', recordedAt: after }])).toBe(STOCK_ENTRY_LOCKED_REASON);
});
