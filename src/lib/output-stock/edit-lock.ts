import { createHash } from 'node:crypto';
import { STOCK_ENTRY_LOCKED_REASON } from './labels';

type Movement = { postingSequence: bigint; createdAt: Date; inputSnapshot: Record<string, unknown> | null };
type Receipt = { id: string; recordedAt: Date };

/** Constant-size receipt identity set, unaffected by metadata edits or backdated event times. */
export function stockReceiptMarker(receipts: readonly { id: string }[]) {
  return { count: receipts.length, identityHash: createHash('sha256').update(JSON.stringify(receipts.map(receipt => receipt.id).sort())).digest('hex') };
}

/** Recorded order is authoritative, even when a new entry was physically backdated. */
export function stockEntryLockReason(original: Movement, latestSequence: bigint, receipts: readonly Receipt[]): string | null {
  if (latestSequence > original.postingSequence) return STOCK_ENTRY_LOCKED_REASON;
  const marker = original.inputSnapshot?.receiptMarker as ReturnType<typeof stockReceiptMarker> | undefined;
  if (marker && typeof marker.count === 'number' && typeof marker.identityHash === 'string') {
    const current = stockReceiptMarker(receipts);
    return marker.count !== current.count || marker.identityHash !== current.identityHash ? STOCK_ENTRY_LOCKED_REASON : null;
  }
  return STOCK_ENTRY_LOCKED_REASON;
}
