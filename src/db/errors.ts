// Postgres driver-error helpers. node-postgres surfaces the SQLSTATE on
// `.code` and the violated index name on `.constraint`; both are untyped on
// the thrown error, so narrowing lives here once instead of being re-derived
// at each catch site.

// SQLSTATE for unique_violation.
const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when `err` is a Postgres unique-constraint violation on the named
 * index. Match the *specific* constraint — a table often carries several
 * unique indexes, and relabeling any 23505 as one conflict masks unrelated
 * violations (the bug `data-access/project-emissions.ts` documents).
 */
export function isPgUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === PG_UNIQUE_VIOLATION && e.constraint === constraint;
}
