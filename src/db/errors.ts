// Postgres driver-error helpers. node-postgres surfaces the SQLSTATE on
// `.code` and the violated index name on `.constraint`; both are untyped on
// the thrown error, so narrowing lives here once instead of being re-derived
// at each catch site.

// SQLSTATE for unique_violation.
const PG_UNIQUE_VIOLATION = "23505";
// SQLSTATE for check_violation, including explicit RAISE ... ERRCODE calls in
// migration-owned invariant triggers.
const PG_CHECK_VIOLATION = "23514";

// Guard against a pathological/cyclic `.cause` chain.
const MAX_CAUSE_DEPTH = 5;

/**
 * True when `err` is a Postgres unique-constraint violation on the named
 * index. Match the *specific* constraint — a table often carries several
 * unique indexes, and relabeling any 23505 as one conflict masks unrelated
 * violations.
 *
 * Walks the `.cause` chain: Drizzle's query builder (`db.insert/update/...`)
 * wraps the driver error in a `DrizzleQueryError` and exposes the original
 * node-postgres error (carrying `.code`/`.constraint`) on `.cause`, whereas the
 * raw `db.execute(sql...)` path throws the driver error directly. Checking both
 * lets one guard cover every call site.
 */
export function isPgUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === "object") {
      const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
      if (e.code === PG_UNIQUE_VIOLATION && e.constraint === constraint) {
        return true;
      }
      current = e.cause;
    } else {
      break;
    }
  }
  return false;
}

/**
 * True when `err` is a Postgres check violation on the named constraint.
 * Match the exact constraint so unrelated checks cannot be relabeled.
 */
export function isPgCheckViolation(
  err: unknown,
  constraint: string,
): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === "object") {
      const e = current as {
        code?: unknown;
        constraint?: unknown;
        cause?: unknown;
      };
      if (
        e.code === PG_CHECK_VIOLATION &&
        e.constraint === constraint
      ) {
        return true;
      }
      current = e.cause;
    } else {
      break;
    }
  }
  return false;
}

/**
 * True when a trigger-raised check violation contains an invariant-specific
 * message. Use only for explicit `RAISE ... ERRCODE '23514'` errors that do not
 * carry a database constraint name.
 */
export function isPgCheckViolationMessage(
  err: unknown,
  messageFragment: string,
): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === "object") {
      const e = current as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      if (
        e.code === PG_CHECK_VIOLATION &&
        typeof e.message === "string" &&
        e.message.includes(messageFragment)
      ) {
        return true;
      }
      current = e.cause;
    } else {
      break;
    }
  }
  return false;
}
