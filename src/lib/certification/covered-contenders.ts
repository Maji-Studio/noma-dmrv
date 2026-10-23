import type { EntryContender } from "./removal-emission-contributions";

export interface CoveredContenders {
  contenders: EntryContender[];
  batchIds: readonly string[];
  claimedAttempt?: { removalId: string; submissionId?: string };
}

/** Empty results still cover their query scope; attempt-specific reads cannot leak. */
export function coversBatches(read: CoveredContenders | undefined, batchIds: readonly string[], claimedAttempt?: CoveredContenders["claimedAttempt"]): read is CoveredContenders {
  return !!read && read.claimedAttempt?.removalId === claimedAttempt?.removalId &&
    read.claimedAttempt?.submissionId === claimedAttempt?.submissionId &&
    batchIds.every(id => read.batchIds.includes(id));
}
