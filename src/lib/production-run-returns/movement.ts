import type { BinMovement } from '@/db/schema';

export type ReturnMovement = Omit<BinMovement, 'postingSequence'> & { postingSequence: string };

/** Preserve the exact ledger order without exposing a BigInt to JSON consumers. */
export function toReturnMovement(movement: BinMovement): ReturnMovement {
  return { ...movement, postingSequence: movement.postingSequence.toString() };
}
