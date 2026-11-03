/**
 * Shared attention predicates — the single source of truth for what "needs
 * operator follow-through" at each traceability station. Both dashboard
 * surfaces build their queries from these so they can never disagree:
 *
 *   - station badges (uncapped counts, `dashboard-stations.ts`)
 *   - the needs-attention list (capped sample rows, `dashboard-overview.ts`)
 *
 * Credit batches are the exception: their rows depend on the Removal display
 * state, so the overview reads every pending batch and `creditBatchAttention`
 * decides, and the queue counts them from that read.
 *
 * Every predicate is facility- and org-scoped and skips archived rows. The
 * application evidence-gap check stays fail-closed (issue #461): an application
 * with unresolved evidence keeps surfacing until the gap is filled.
 */
import {
  applications,
  creditBatches,
  deliveries,
  feedstocks,
  productionRuns,
} from "@/db/schema";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { findInterruptedRemoval, type DerivedStatus } from "@/lib/certification/status";
import { applicationHasEvidenceGapSql } from "./application-evidence-sql";

/** Complete production runs missing either mass reading. */
export function runsMissingMassWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(productionRuns.organizationId, organizationId),
    eq(productionRuns.facilityId, facilityId),
    isNull(productionRuns.archivedAt),
    eq(productionRuns.status, "complete"),
    or(
      isNull(productionRuns.biocharDryMassKg),
      isNull(productionRuns.feedstockMassDryKg),
    ),
  );
}

/** Feedstock records flagged as incomplete. */
export function feedstocksMissingDataWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(feedstocks.organizationId, organizationId),
    eq(feedstocks.facilityId, facilityId),
    isNull(feedstocks.archivedAt),
    eq(feedstocks.status, "missing_data"),
  );
}

/**
 * Pending credit batches. Whether one needs attention depends on its holding
 * Removals' display state, which only JS derives (`creditBatchAttention`).
 */
export function pendingBatchesWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(creditBatches.organizationId, organizationId),
    eq(creditBatches.facilityId, facilityId),
    isNull(creditBatches.archivedAt),
    eq(creditBatches.status, "pending"),
  );
}

export const PERIOD_ENDED_SUBMITTED_TITLE = "Period ended · awaiting verification";
export const PERIOD_ENDED_NOT_SUBMITTED_TITLE = "Period ended · not submitted yet";

/** A closed period either waits on the verifier or on the operator's submission. */
export type CreditBatchPeriodAttention = "submitted" | "notSubmitted";

export const PERIOD_ATTENTION_TITLES: Record<CreditBatchPeriodAttention, string> = {
  submitted: PERIOD_ENDED_SUBMITTED_TITLE,
  notSubmitted: PERIOD_ENDED_NOT_SUBMITTED_TITLE,
};

/** Rows one check shows before it folds into a single grouped row. */
export const ATTENTION_PER_CHECK = 4;

/**
 * One check's rows for Needs attention: its records while they fit the cap,
 * else one grouped row standing for all of them, so every counted unit in
 * "N open" has a row (#1532 F5).
 */
export function capOrGroup<T>(rows: readonly T[], total: number, group: () => T): T[] {
  return total > ATTENTION_PER_CHECK ? [group()] : rows.slice(0, ATTENTION_PER_CHECK);
}

/**
 * What a pending batch puts in Needs attention, from its Removals' display
 * state (#1528). Each interrupted Removal gets its own row, and the batch then
 * shows no period row. Otherwise a closed period is "submitted" (awaiting
 * verification) only once a Removal is submitted (its phase, as on the batch
 * page: a newer draft does not undo an earlier submitted version); with no
 * Removal or only a draft it is "notSubmitted". The batch status alone cannot
 * say this: it stays pending after submission.
 */
export function creditBatchAttention(
  batch: { endDate: string | null },
  removals: readonly { status: Pick<DerivedStatus, "kind">; phase: "draft" | "submitted" }[],
  todayStr: string,
): { interrupted: boolean; period: CreditBatchPeriodAttention | null } {
  if (findInterruptedRemoval(removals)) {
    return { interrupted: true, period: null };
  }
  if (!batch.endDate || batch.endDate >= todayStr) return { interrupted: false, period: null };
  return {
    interrupted: false,
    period: removals.some((removal) => removal.phase === "submitted") ? "submitted" : "notSubmitted",
  };
}

/**
 * Applications with missing evidence. Scoped on the application's own org plus
 * the joined delivery's facility — the caller supplies the
 * `applications ⋈ deliveries` join. Fail-closed via
 * `applicationHasEvidenceGapSql` (issue #461).
 */
export function applicationEvidenceGapWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(applications.organizationId, organizationId),
    eq(deliveries.facilityId, facilityId),
    isNull(deliveries.archivedAt),
    applicationHasEvidenceGapSql(),
  );
}
