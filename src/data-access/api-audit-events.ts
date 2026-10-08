import type { DbTransaction } from "@/db";
import { apiAuditEvents } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { OperationEffect } from "@/lib/operation-effect";
import { requireOrgScope } from "./utils";

export async function writeApiAuditEvent(
  ctx: OrgContext,
  tx: DbTransaction,
  event: {
    requestId: string;
    credentialId: string;
    oauthClientId?: string | null;
    operationId: string;
    effect: OperationEffect;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const { effect } = event;
  await tx.insert(apiAuditEvents).values({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    credentialId: event.credentialId,
    oauthClientId: event.oauthClientId ?? null,
    operationId: event.operationId,
    requestId: event.requestId,
    entityType: effect.entityType,
    entityIds: effect.entityIds,
    changedFields: effect.changedFields,
    versionBefore: effect.versionBefore,
    versionAfter: effect.versionAfter,
    outcomeCode: effect.outcome,
  });
}
