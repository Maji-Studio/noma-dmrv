import { isLocalHost } from "./local-host";
import { TARGET_OVERRIDE_PARAMS } from "./throwaway-database";

export const WORKTREE_TEST_DATABASE_NAME = /^noma_dmrv_wt_[a-z0-9_]+_test$/;
const URL_STRIPPED_WHITESPACE = /[\t\r\n]/;

/** Only script-managed local test databases may be migrated automatically. */
export function isWorktreeTestDatabaseUrl(databaseUrl: string): boolean {
  // URL parsing silently strips raw tabs and newlines, including a trailing newline.
  if (URL_STRIPPED_WHITESPACE.test(databaseUrl)) return false;

  try {
    const url = new URL(databaseUrl);
    const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return isLocalHost(url.hostname)
      && !TARGET_OVERRIDE_PARAMS.some((param) => url.searchParams.has(param))
      // Compare the full match because $ also accepts a final line terminator.
      && WORKTREE_TEST_DATABASE_NAME.exec(dbName)?.[0] === dbName;
  } catch {
    return false;
  }
}
