import { and, desc, eq, gte, inArray, like, max, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { certifierSyncEvents } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

type CertifierProvider =
  (typeof certifierSyncEvents.$inferSelect)["provider"];

export type CertifierSyncEventRow =
  typeof certifierSyncEvents.$inferSelect;

export interface AppendSyncEventInput {
  provider: CertifierProvider;
  entityType: string;
  entityId: string;
  operation: string;
  status: "succeeded" | "failed";
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string | null;
  attemptedAt?: Date;
}

export async function appendSyncEvent(
  ctx: OrgContext,
  input: AppendSyncEventInput,
): Promise<void> {
  requireOrgScope(ctx);
  await db.insert(certifierSyncEvents).values({
    organizationId: ctx.organizationId,
    provider: input.provider,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    status: input.status,
    requestPayload: (input.requestPayload ?? null) as Record<string, unknown>,
    responsePayload: (input.responsePayload ?? null) as Record<string, unknown>,
    errorMessage: input.errorMessage ?? null,
    attemptedAt: input.attemptedAt,
  });
}

/** One multi-row insert for N events of the same kind (a registry sync of many statements). */
export async function appendSyncEvents(
  ctx: OrgContext,
  inputs: AppendSyncEventInput[],
): Promise<void> {
  requireOrgScope(ctx);
  if (inputs.length === 0) return;
  await db.insert(certifierSyncEvents).values(
    inputs.map((input) => ({
      organizationId: ctx.organizationId,
      provider: input.provider,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      status: input.status,
      requestPayload: (input.requestPayload ?? null) as Record<string, unknown>,
      responsePayload: (input.responsePayload ?? null) as Record<string, unknown>,
      errorMessage: input.errorMessage ?? null,
      attemptedAt: input.attemptedAt,
    })),
  );
}

export async function listRecentSyncEvents(
  ctx: OrgContext,
  args: {
    entityType: string;
    entityId: string;
    limit: number;
    /** Operations left out, e.g. high-volume bookkeeping that would crowd the history. */
    excludeOperations?: string[];
  },
): Promise<CertifierSyncEventRow[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, args.entityType),
        eq(certifierSyncEvents.entityId, args.entityId),
        eq(certifierSyncEvents.organizationId, ctx.organizationId),
        args.excludeOperations?.length
          ? notInArray(certifierSyncEvents.operation, args.excludeOperations)
          : undefined,
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(args.limit);
}

const ATTEMPT_SUMMARY_LIMIT = 20;
const DRIFT_EVENT_LIMIT = 40;

/**
 * What the Removal sheet needs to tell submit attempts apart: the newest
 * attempt summaries, then the drift stops written since the oldest of them.
 * Fetched separately so a run of failed events cannot push summaries out.
 */
export async function listRemovalAttemptEvents(
  ctx: OrgContext,
  args: { removalId: string },
): Promise<CertifierSyncEventRow[]> {
  requireOrgScope(ctx);
  const scope = and(
    eq(certifierSyncEvents.entityType, "removal"),
    eq(certifierSyncEvents.entityId, args.removalId),
    eq(certifierSyncEvents.organizationId, ctx.organizationId),
  );
  const summaries = await db
    .select()
    .from(certifierSyncEvents)
    .where(and(scope, eq(certifierSyncEvents.operation, "removal:submit:attempt-summary")))
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(ATTEMPT_SUMMARY_LIMIT);
  const oldest = summaries[summaries.length - 1];
  if (!oldest) return [];
  const drifts = await db
    .select()
    .from(certifierSyncEvents)
    .where(and(
      scope,
      like(certifierSyncEvents.operation, "production-batch:drift:%"),
      eq(certifierSyncEvents.status, "failed"),
      gte(certifierSyncEvents.attemptedAt, oldest.attemptedAt),
    ))
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(DRIFT_EVENT_LIMIT);
  return [...summaries, ...drifts];
}

/** Latest successful sync for all requested entities in one org-scoped query. */
export async function getLastSyncedAtForEntities(
  ctx: OrgContext,
  args: {
    provider: CertifierProvider;
    entityType: string;
    operation: string;
    entityIds: string[];
  },
): Promise<Map<string, Date>> {
  requireOrgScope(ctx);
  if (args.entityIds.length === 0) return new Map();

  const rows = await db
    .select({
      entityId: certifierSyncEvents.entityId,
      lastSyncedAt: max(certifierSyncEvents.attemptedAt)
        .mapWith(certifierSyncEvents.attemptedAt),
    })
    .from(certifierSyncEvents)
    .where(and(
      eq(certifierSyncEvents.organizationId, ctx.organizationId),
      eq(certifierSyncEvents.provider, args.provider),
      eq(certifierSyncEvents.entityType, args.entityType),
      eq(certifierSyncEvents.operation, args.operation),
      eq(certifierSyncEvents.status, "succeeded"),
      inArray(certifierSyncEvents.entityId, args.entityIds),
    ))
    .groupBy(certifierSyncEvents.entityId);

  return new Map(rows.flatMap((row) =>
    row.lastSyncedAt ? [[row.entityId, row.lastSyncedAt] as const] : [],
  ));
}
