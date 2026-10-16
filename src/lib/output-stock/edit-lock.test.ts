import { expect, it } from 'vitest';
import { stockReceiptMarker } from './edit-lock';
const before = new Date('2026-09-01T12:00:00Z');
const after = new Date('2026-09-15T12:00:00Z');
const receipts = [{ id: 'a', recordedAt: before }];
it('keeps receipt identity independent of order and timestamps', () => {
  const marker = stockReceiptMarker(receipts);
  expect(stockReceiptMarker([...receipts, { id: 'b', recordedAt: before }]))
    .toEqual(stockReceiptMarker([{ id: 'b', recordedAt: after }, ...receipts]));
  expect(stockReceiptMarker(Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }))).identityHash).toHaveLength(marker.identityHash.length);
});
