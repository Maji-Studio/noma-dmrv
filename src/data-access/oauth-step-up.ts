import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { verifications } from "@/db/schema";
import { OAUTH_STEP_UP_NAMESPACE, OAUTH_STEP_UP_TTL_MS } from "@/config/oauth";
import type { ApiScope } from "@/lib/auth/api-scopes";

type StepUpBinding = { userId: string; clientId: string; organizationId: string };

/** The full tuple is the identifier; a deterministic primary key makes replacement atomic. */
function stepUpKey(binding: StepUpBinding) {
  const identifier = OAUTH_STEP_UP_NAMESPACE + JSON.stringify([binding.userId, binding.clientId, binding.organizationId]);
  return { identifier, id: OAUTH_STEP_UP_NAMESPACE + createHash("sha256").update(identifier).digest("hex") };
}

// org-scope-ok: authenticated OAuth refusal records only the token's user/client/organization tuple
export async function recordOAuthStepUp(binding: StepUpBinding, scopes: readonly ApiScope[], now = new Date()) {
  const key = stepUpKey(binding);
  const values = { ...key, value: JSON.stringify(scopes), createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + OAUTH_STEP_UP_TTL_MS) };
  await db.insert(verifications).values(values).onConflictDoUpdate({
    target: verifications.id,
    set: { value: values.value, createdAt: now, updatedAt: now, expiresAt: values.expiresAt },
    // The identifier equality filters all three binding components, even on a primary-key conflict.
    setWhere: eq(verifications.identifier, key.identifier),
  });
}

// org-scope-ok: session-authenticated consent reads only the verified attempt's user/client/organization tuple
export async function findOAuthStepUp(binding: StepUpBinding, now = new Date()): Promise<string[]> {
  const key = stepUpKey(binding);
  const [pending] = await db.select({ value: verifications.value }).from(verifications).where(and(
    eq(verifications.id, key.id), eq(verifications.identifier, key.identifier), gt(verifications.expiresAt, now),
  ));
  if (!pending) return [];
  const scopes: unknown = JSON.parse(pending.value);
  return Array.isArray(scopes) && scopes.every(scope => typeof scope === "string") ? scopes : [];
}
