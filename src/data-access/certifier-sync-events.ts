import { and, desc, eq } from "drizzle-orm";
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

export async function listRecentSyncEvents(
  ctx: OrgContext,
  args: { entityType: string; entityId: string; limit: number },
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
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(args.limit);
}
