import { gt } from 'drizzle-orm';
import { productionRunFeedstocks } from '@/db/schema';

/** A delivery was physically touched only by a positive wet share. */
export function touchedRunFeedstock() {
  return gt(productionRunFeedstocks.wetMassUsedKg, 0);
}
