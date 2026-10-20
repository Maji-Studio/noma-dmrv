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

const WORKTREE_DB_NAME = /^noma_dmrv_wt_[a-z0-9_]+_(dev|test)$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isWorktreeDatabase(url: string | undefined, suffix: "dev" | "test"): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.slice(1);
    return LOCAL_HOSTS.has(parsed.hostname) && WORKTREE_DB_NAME.test(name) && name.endsWith(`_${suffix}`);
  } catch {
    return false;
  }
}

/** Follow-up lines after a renumber. Never includes a URL or password; suggests a reset only for a worktree's own local DBs. */
export function followUpLines(
  worktreePath: string,
  devUrl: string | undefined,
  testUrl: string | undefined,
): string[] {
  const dev = isWorktreeDatabase(devUrl, "dev");
  const test = isWorktreeDatabase(testUrl, "test");
  if (!dev && !test) {
    return ["This is not a worktree with its own local databases, so no database reset is suggested."];
  }
  const lines = [
    "The worktree DBs still hold the old-numbered migration. Reset them (not run for you):",
  ];
  if (dev) lines.push(`  cd "${worktreePath}" && pnpm db:reset`);
  if (test) {
    lines.push(`  cd "${worktreePath}" && (set -a; . ./.env.test; DATABASE_URL="$TEST_DATABASE_URL" pnpm db:reset)`);
  }
  return lines;
}
