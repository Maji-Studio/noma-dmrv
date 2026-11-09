import { and, desc, eq, gte, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { certifierSyncEvents } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import {
  ATTEMPT_SUMMARY_OPERATION, DRIFT_OPERATION_PREFIX, deriveSubmissionAttempts,
  type AttemptEventInput,
} from "@/lib/certification/submission-attempts";
import { requireOrgScope } from "./utils";

/** Latest outcomes for all requested Removals, in at most two org-scoped queries. */
export async function getRemovalIdsWithChangedLatestAttempt(
  ctx: OrgContext,
  removalIds: readonly string[],
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (removalIds.length === 0) return new Set();
  const summaries = await db
    .selectDistinctOn([certifierSyncEvents.entityId])
    .from(certifierSyncEvents)
    .where(and(
      eq(certifierSyncEvents.organizationId, ctx.organizationId),
      eq(certifierSyncEvents.entityType, "removal"),
      inArray(certifierSyncEvents.entityId, [...new Set(removalIds)]),
      eq(certifierSyncEvents.operation, ATTEMPT_SUMMARY_OPERATION),
    ))
    .orderBy(certifierSyncEvents.entityId, desc(certifierSyncEvents.attemptedAt));
  if (summaries.length === 0) return new Set();
  // As in listRemovalAttemptEvents, bound drift reads by the oldest summary
  // being evaluated. Here only the latest summary per Removal is needed.
  const oldest = summaries.reduce((oldest, summary) =>
    summary.attemptedAt < oldest.attemptedAt ? summary : oldest);
  const drifts = await db
    .select()
    .from(certifierSyncEvents)
    .where(and(
      eq(certifierSyncEvents.organizationId, ctx.organizationId),
      eq(certifierSyncEvents.entityType, "removal"),
      inArray(certifierSyncEvents.entityId, summaries.map((summary) => summary.entityId)),
      like(certifierSyncEvents.operation, `${DRIFT_OPERATION_PREFIX}%`),
      eq(certifierSyncEvents.status, "failed"),
      gte(certifierSyncEvents.attemptedAt, oldest.attemptedAt),
    ))
    .orderBy(desc(certifierSyncEvents.attemptedAt));
  // No global drift limit: one Removal must not crowd another's events out.
  const driftsByRemoval = new Map<string, AttemptEventInput[]>();
  for (const drift of drifts) {
    const events = driftsByRemoval.get(drift.entityId) ?? [];
    events.push(drift);
    driftsByRemoval.set(drift.entityId, events);
  }
  return new Set(summaries.filter((summary) =>
    deriveSubmissionAttempts([summary, ...(driftsByRemoval.get(summary.entityId) ?? [])])[0]?.outcome.kind === "changed",
  ).map((summary) => summary.entityId));
}
