import type { CountedOnBatch } from '@/lib/certification/emission-lines';

export interface FeedstockDeliveryUsage {
  id: string;
  code: string;
  intakeWetKg: number;
  stillInBinWetKg: number;
  lostWetKg: number;
  /** Net count withdrawals; a stock gain is negative. Never owns transport. */
  countWetKg: number;
  ingredientWetKg: number;
  creditBatches: { creditBatchId: string; code: string; wetKg: number }[];
  unbatchedRunWetKg: number;
  owningBatch: CountedOnBatch | null;
}
