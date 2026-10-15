import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { certificationSubmissions } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import {
  buildSubmissionStatusHistory,
  type StatusHistoryEntityType,
  type StatusHistoryEvent,
  type StatusHistoryLedgerRow,
  type SubmissionStatusHistory,
} from "@/lib/certification/status-history";
import { getMetadataValue, SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import { listEntityActivity } from "./activity-events";
import { requireOrgScope } from "./utils";

// Newest status changes kept per record; older ones fall back to the ledger.
const STATUS_HISTORY_EVENT_LIMIT = 200;
const HISTORY_SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

const LEDGER_KEY: Record<StatusHistoryEntityType, { localEntityType: string; submissionType: string }> = {
  removal: { localEntityType: REMOVAL_ENTITY_TYPE, submissionType: REMOVAL_SUBMISSION_TYPE },
  ghg_statement: { localEntityType: GHG_STATEMENT_ENTITY_TYPE, submissionType: GHG_STATEMENT_SUBMISSION_TYPE },
};

/**
 * Every status one Removal or GHG Statement went through, newest first: the
 * Submission ledger's version timestamps merged with `status_changed` activity
 * events (see `buildSubmissionStatusHistory`). A record of another
 * organization reads as empty. Actor names are read at query time and must
 * never be logged.
 */
export async function listSubmissionStatusHistory(
  ctx: OrgContext,
  entityType: StatusHistoryEntityType,
  entityId: string,
): Promise<SubmissionStatusHistory> {
  requireOrgScope(ctx);
  const key = LEDGER_KEY[entityType];
  // One snapshot for both sources: a status change commits its ledger row and
  // its event together, so reading them apart could pair a stale ledger with
  // a newer event and fabricate a reversal.
  const { ledgerRows, eventRows, actors } = await db.transaction(async (tx) => {
    const ledgerRows = await tx.select({
      id: certificationSubmissions.id,
      version: certificationSubmissions.version,
      status: certificationSubmissions.status,
      metadata: certificationSubmissions.metadata,
      createdAt: certificationSubmissions.createdAt,
      submittedAt: certificationSubmissions.submittedAt,
      supersededAt: certificationSubmissions.supersededAt,
    }).from(certificationSubmissions).where(and(
      eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.submissionType, key.submissionType),
      eq(certificationSubmissions.localEntityType, key.localEntityType),
      eq(certificationSubmissions.localEntityId, entityId),
    )).orderBy(asc(certificationSubmissions.version));
    const eventRows = await listEntityActivity(ctx, entityType, entityId, {
      action: "status_changed",
      limit: STATUS_HISTORY_EVENT_LIMIT,
      executor: tx,
    });
    const actorIds = [...new Set(eventRows.flatMap((event) => event.actorUserId ? [event.actorUserId] : []))];
    // org-scope-ok: users is a global identity table; ids come from this organization's events.
    const actors = actorIds.length === 0 ? [] : await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, actorIds));
    return { ledgerRows, eventRows, actors };
  }, HISTORY_SNAPSHOT);

  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name?.trim() || null]));

  const ledger: StatusHistoryLedgerRow[] = ledgerRows.map((row) => {
    const remote = getMetadataValue(row.metadata, SUBMISSION_METADATA_KEYS.remoteStatus);
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      remoteStatus: typeof remote === "string" ? remote : null,
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      supersededAt: row.supersededAt,
    };
  });
  const events: StatusHistoryEvent[] = eventRows.map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    sequence: Number(event.sequence),
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    fromRemote: event.fromRemote,
    toRemote: event.toRemote,
    submissionId: event.submissionRef?.submissionId ?? null,
    version: event.submissionRef?.version ?? null,
    source: event.source,
    actorName: event.actorUserId ? (actorNames.get(event.actorUserId) ?? null) : null,
    hasActor: event.actorUserId !== null,
    registryAt: event.registryAt,
  }));

  return buildSubmissionStatusHistory(entityType, ledger, events);
}
