/** Recorded timestamps use JavaScript millisecond precision, like the replay. */
export interface FeedstockEventTie { recordedAt: Date; id: string }
export function earliestFeedstockEventTie(rows: readonly FeedstockEventTie[]): FeedstockEventTie | undefined {
  return [...rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id))[0];
}
