export type OutputStockMode = 'split' | 'mix';

/**
 * An output bin's stock mode at `at` (canonical ISO instants). A split bin
 * merged into a mix pile stays split before its latest merge, so an entry
 * timed before the merge is planned as split; a bin created as mix, or
 * switched back to split once empty, has one mode throughout.
 */
export function stockModeAt(current: OutputStockMode, latestMergeAt: string | null, at: string): OutputStockMode {
  if (current === 'split' || latestMergeAt === null) return current;
  return at >= latestMergeAt ? 'mix' : 'split';
}
