/** Plan regeneration against staging's snapshots without changing files. */
import { MIGRATION_PREFIX_WIDTH, TAG_PREFIX, type MigrationEntry } from "./check-migrations";

const EMPTY_JOURNAL_INDEX = -1;
const INDEX_INCREMENT = 1;

export function planRenumber(staging: readonly MigrationEntry[], branch: readonly MigrationEntry[]) {
  const stagingTags = new Set(staging.map((entry) => entry.tag));
  const branchOnly = branch.filter((entry) => !stagingTags.has(entry.tag)).map((entry) => entry.tag);
  const name = branchOnly.at(-1)?.replace(TAG_PREFIX, "");
  const nextIndex = (staging.at(-1)?.idx ?? EMPTY_JOURNAL_INDEX) + INDEX_INCREMENT;
  const nextTag = name === undefined
    ? undefined
    : `${String(nextIndex).padStart(MIGRATION_PREFIX_WIDTH, "0")}_${name}`;
  return { branchOnly, name, nextTag };
}
