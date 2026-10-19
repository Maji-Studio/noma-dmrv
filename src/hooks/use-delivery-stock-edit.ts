"use client";

import type { Delivery } from '@/db/schema';
import { useOutputStockHistory } from './use-output-stock';

/** The current replacement, never the original or reversal, supplies edit readings and eligibility. */
export function useDeliveryStockEdit(delivery?: Delivery) {
  const history = useOutputStockHistory(delivery?.storageLocationId ?? '', !!delivery);
  const reversed = new Set(history.data?.filter(entry => entry.kind === 'reversal').map(entry => entry.correctsMovementId));
  const movement = history.data?.filter(entry => entry.deliveryId === delivery?.id && entry.kind !== 'reversal' && !reversed.has(entry.id)).at(-1);
  return { history, movement, editable: movement?.editLockedReason === null };
}
