import { createHash } from 'node:crypto';
/** Constant-size receipt identity set, unaffected by metadata edits or backdated event times. */
export function stockReceiptMarker(receipts: readonly { id: string }[]) {
  return { count: receipts.length, identityHash: createHash('sha256').update(JSON.stringify(receipts.map(receipt => receipt.id).sort())).digest('hex') };
}
