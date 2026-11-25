import type { ReturnMovement } from './movement';

/** Explicit measurement fields only: never copy actor details, reason text or inputSnapshot. */
export function returnActivitySnapshot(row: ReturnMovement | null, prefix: 'returned' | 'reversed' | 'replacement') {
  return {
    [`${prefix}MovementId`]: row?.id ?? null,
    [`${prefix}StorageLocationId`]: row?.storageLocationId ?? null,
    [`${prefix}WetMassKg`]: row?.massDeltaKg ?? null,
    [`${prefix}DryMassKg`]: row?.feedstockDryDeltaKg ?? null,
    [`${prefix}MoistureRatio`]: row?.moistureRatioUsed ?? null,
    [`${prefix}OccurredAt`]: row?.occurredAt ?? null,
    [`${prefix}CorrectsMovementId`]: row?.correctsMovementId ?? null,
  };
}
