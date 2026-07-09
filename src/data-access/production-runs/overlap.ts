/**
 * Same-reactor time-window overlap validation for production runs (issue #259).
 *
 * A reactor can only run one physical batch at a time, so two non-void runs on
 * the same reactor must not overlap in time. This guard runs inside the create
 * and update transactions, serialized per-reactor by a transaction-scoped
 * advisory lock so the check-then-write can't race. The partial unique index
 * `production_runs_reactor_start_unique_idx` is the exact-start backstop.
 */

import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { productionRuns } from "@/db/schema";
import { formatLocalDate, formatLocalTime } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import type { DbTransaction } from "@/db";

/** A reference to the run a candidate window collides with. */
export interface RunConflict {
  entity: string;
  id: string;
  code: string;
}

/**
 * Thrown when a candidate run's time window overlaps an existing run on the same
 * reactor. Carries a structured `conflict` so the server action can surface a
 * link straight to the offending run.
 */
export class ProductionRunOverlapError extends SafeError {
  readonly conflict: RunConflict;
  constructor(message: string, conflict: RunConflict) {
    super(message);
    this.name = "ProductionRunOverlapError";
    this.conflict = conflict;
  }
}

/**
 * Half-open interval intersection used by the DB overlap guard, exposed as a
 * pure function for unit testing. Times are epoch millis; a `null` end means an
 * open run extending to +∞. Two runs conflict iff
 * `candidate.start < existing.end` AND `existing.start < candidate.end`.
 */
export function runWindowsConflict(
  candidate: { start: number; end: number | null },
  existing: { start: number; end: number | null },
): boolean {
  const candEnd = candidate.end ?? Number.POSITIVE_INFINITY;
  const exEnd = existing.end ?? Number.POSITIVE_INFINITY;
  return candidate.start < exEnd && existing.start < candEnd;
}

/** Format a single instant as "YYYY-MM-DD HH:MM" using the shared date helpers. */
function formatInstant(d: Date): string {
  return `${formatLocalDate(d)} ${formatLocalTime(d)}`;
}

/** Format a closed window; collapses the date when start and end share a day. */
function formatWindow(start: Date, end: Date): string {
  const startDate = formatLocalDate(start);
  const endDate = formatLocalDate(end);
  const startTime = formatLocalTime(start);
  const endTime = formatLocalTime(end);
  return startDate === endDate
    ? `${startDate} ${startTime}–${endTime}`
    : `${formatInstant(start)} – ${formatInstant(end)}`;
}

/** Build the friendly, non-technical overlap message for a conflicting run. */
function overlapMessage(conflict: {
  code: string;
  startTime: Date;
  endTime: Date | null;
}): string {
  if (conflict.endTime) {
    return `Overlaps run ${conflict.code} (${formatWindow(conflict.startTime, conflict.endTime)}) on this reactor`;
  }
  return `This reactor has an unfinished run ${conflict.code} (started ${formatInstant(conflict.startTime)}) — set its end time first`;
}

/**
 * Acquire the per-reactor advisory lock and reject the candidate window if it
 * overlaps any existing non-void, non-archived run on the same reactor. Pass
 * `selfId` on the edit path to exclude the run being edited.
 */
export async function assertNoReactorRunOverlap(
  tx: DbTransaction,
  params: {
    reactorId: string;
    startTime: Date;
    endTime: Date | null;
    selfId?: string;
  },
): Promise<void> {
  const { reactorId, startTime, endTime, selfId } = params;

  // Serialize concurrent writers on this reactor for the rest of the tx.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${reactorId}))`);

  const conditions: SQL[] = [
    eq(productionRuns.reactorId, reactorId),
    ne(productionRuns.status, "void"),
    isNull(productionRuns.archivedAt),
    // candidate.start < COALESCE(existing.end, +inf)
    sql`${startTime}::timestamp < coalesce(${productionRuns.endTime}, 'infinity'::timestamp)`,
    // existing.start < COALESCE(candidate.end, +inf)
    sql`${productionRuns.startTime} < coalesce(${endTime ?? null}::timestamp, 'infinity'::timestamp)`,
  ];
  if (selfId) conditions.push(ne(productionRuns.id, selfId));

  const [conflict] = await tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      startTime: productionRuns.startTime,
      endTime: productionRuns.endTime,
    })
    .from(productionRuns)
    .where(and(...conditions))
    .limit(1);

  if (!conflict) return;

  throw new ProductionRunOverlapError(overlapMessage(conflict), {
    entity: "productionRun",
    id: conflict.id,
    code: conflict.code,
  });
}

/**
 * Race backstop: after the advisory lock, a raw insert/update can still trip the
 * `(reactor_id, start_time)` unique index in the vanishingly rare window before
 * the lock is held. Detect that specific violation so callers can map it to the
 * friendly overlap message instead of leaking a raw constraint error.
 */
export function isReactorStartUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("production_runs_reactor_start_unique_idx")
  );
}
