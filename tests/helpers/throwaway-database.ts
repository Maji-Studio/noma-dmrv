/**
 * Vitest's database guard. Several root suites truncate organizations, so a
 * run against a developer database wipes it. tests/setup.ts calls
 * assertThrowawayTestDatabase on the effective URL before any spec loads.
 *
 * A database is throwaway when it is on this machine and its name carries a
 * `test` or `e2e` segment: CI's `noma_dmrv_test`, the fallback
 * `app_template_test`, or a worktree's `noma_dmrv_<name>_test`. Never
 * `noma_dmrv_dev`.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const THROWAWAY_NAME = /(^|_)(test|e2e)(_|$)/;

/**
 * Vitest reads TEST_DATABASE_URL first. Playwright reads only DATABASE_URL
 * from the same `.env.test`, because its fixtures must seed the database the
 * running dev server uses. One env file serves both runners this way.
 */
export function resolveTestDatabaseUrl(
  env: { TEST_DATABASE_URL?: string; DATABASE_URL?: string; [key: string]: string | undefined },
): string | undefined {
  return env.TEST_DATABASE_URL || env.DATABASE_URL || undefined;
}

export function assertThrowawayTestDatabase(databaseUrl: string): void {
  let host = "";
  let dbName = "";
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    // Fall through: an unparseable URL is not a throwaway database.
  }

  if (LOCAL_HOSTS.has(host) && THROWAWAY_NAME.test(dbName)) return;

  throw new Error(
    `Vitest refuses database "${dbName || "(unparseable URL)"}" on host "${host || "?"}": ` +
      "it is not a throwaway test database. Root suites truncate data. " +
      "Point TEST_DATABASE_URL in .env.test at a local database whose name " +
      'contains a "test" or "e2e" segment (e.g. noma_dmrv_test). See docs/testing.md.',
  );
}
