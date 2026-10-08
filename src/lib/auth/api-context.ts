import { defaultKeyHasher } from "@better-auth/api-key";
import { findApiCredential, findApiCredentialMember } from "@/data-access/api-credential-auth";
import { auth } from "./better-auth";
import type { OrgContext } from "./server";
import { canOwnApiKey, scopesFromStoredPermissions, type ApiScope } from "./api-scopes";
import { parseApiCredential, type ApiContextDenial } from "./api-credential-header";

export type { ApiContextDenial } from "./api-credential-header";

export type ApiContext = OrgContext & {
  orgRole: "owner" | "admin";
  isPlatformAdmin: false;
  credentialId: string;
  principal: {
    userId: string;
    credentialId: string;
    kind: "api-key";
  };
  scopes: ApiScope[];
  credential: {
    id: string;
    name: string | null;
    expiresAt: Date;
  };
};

export type ApiContextResolution =
  | {
    ok: true;
    ctx: ApiContext;
  }
  | {
    ok: false;
    denial: ApiContextDenial;
  };

async function resolveStoredCredential(keyHash: string): Promise<ApiContextResolution> {
  const stored = await findApiCredential(keyHash);
  if (!stored) {
    return {
      ok: false,
      denial: "credential_invalid",
    };
  }
  const { key, owner } = stored;
  const member = await findApiCredentialMember(owner.organizationId, owner.userId);
  // Preserve this specific diagnosis even when the membership hook disabled it.
  if (
    !member ||
    !owner.memberId ||
    member.id !== owner.memberId ||
    !canOwnApiKey(member.role) ||
    owner.revocationReason === "credential_owner_removed"
  ) {
    return {
      ok: false,
      denial: "credential_owner_removed",
    };
  }
  if (!member.emailVerified) {
    return {
      ok: false,
      denial: "credential_owner_unverified",
    };
  }
  if (owner.revokedAt) {
    return {
      ok: false,
      denial: "credential_revoked",
    };
  }
  if (!key.enabled) {
    return {
      ok: false,
      denial: "credential_disabled",
    };
  }
  if (!key.expiresAt || key.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      denial: "credential_expired",
    };
  }
  return {
    ok: true,
    ctx: {
      userId: owner.userId,
      organizationId: owner.organizationId,
      orgRole: member.role,
      isPlatformAdmin: false,
      credentialId: key.id,
      principal: {
        userId: owner.userId,
        credentialId: key.id,
        kind: "api-key",
      },
      scopes: scopesFromStoredPermissions(key.permissions),
      credential: {
        id: key.id,
        name: key.name,
        expiresAt: key.expiresAt,
      },
    },
  };
}

export async function resolveApiContext(request: Request): Promise<ApiContextResolution> {
  const parsed = parseApiCredential(request.headers);
  if (!parsed.ok) return parsed;
  const hash = await defaultKeyHasher(parsed.key);
  // Diagnose disabled owners before the plugin returns an opaque invalid key.
  const before = await resolveStoredCredential(hash);
  if (!before.ok) return before;
  const verified = await auth.api.verifyApiKey({ body: { key: parsed.key } });
  // Re-read even after failure: the plugin also reports infrastructure errors
  // as invalid keys. Only stored state can establish an authentication denial.
  const after = await resolveStoredCredential(hash);
  if (!after.ok) return after;
  if (!verified.valid || !verified.key) {
    throw new Error("API credential verification failed unexpectedly.");
  }
  // Never build authority from cached plugin data.
  return after;
}
