import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { certifierCredentials } from "@/db/schema/certification";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

type CertifierCredentialRow = typeof certifierCredentials.$inferSelect;
type CertifierProvider = CertifierCredentialRow["provider"];

/**
 * Either secret may be omitted to rotate the other one on its own. The stored
 * value is kept for an omitted field, so the settings form can leave a masked
 * input untouched and still save. A first save must carry both — there is
 * nothing to keep.
 */
export type UpsertCertifierCredentialsInput = {
  organizationId: string;
  provider: CertifierProvider;
  accessToken?: string;
  clientSecret?: string;
};

export type CertifierCredentialsStatus = {
  configured: boolean;
  accessTokenLast4: string | null;
  updatedAt: Date | null;
};

function assertCanManageOrgCredentials(
  ctx: OrgContext,
  organizationId: string,
): void {
  requireOrgScope(ctx);
  if (ctx.isPlatformAdmin) return;
  if (ctx.organizationId !== organizationId) {
    throw new SafeError(
      "You can only manage credentials for your active organization.",
    );
  }
  requireOrgRole(ctx, "admin");
}

export async function upsertCertifierCredentials(
  ctx: OrgContext,
  input: UpsertCertifierCredentialsInput,
): Promise<void> {
  assertCanManageOrgCredentials(ctx, input.organizationId);

  // Rotating one half: UPDATE only the column that was supplied. Reading the
  // row and writing both columns back would let two admins rotating opposite
  // halves clobber each other — the later writer would restore the earlier
  // one's stale value from the snapshot it read. A single statement cannot.
  if (!input.accessToken || !input.clientSecret) {
    const set: Partial<{
      accessTokenEncrypted: string;
      clientSecretEncrypted: string;
      updatedAt: ReturnType<typeof sql>;
    }> = { updatedAt: sql`now()` };
    if (input.accessToken) {
      set.accessTokenEncrypted = encryptSecret(input.accessToken);
    }
    if (input.clientSecret) {
      set.clientSecretEncrypted = encryptSecret(input.clientSecret);
    }

    const updated = await db
      .update(certifierCredentials)
      .set(set)
      .where(
        and(
          eq(certifierCredentials.organizationId, input.organizationId),
          eq(certifierCredentials.provider, input.provider),
        ),
      )
      .returning({ id: certifierCredentials.id });

    // No row to merge into, so there is nothing to keep for the omitted half.
    if (updated.length === 0) {
      throw new SafeError(
        "Enter both the access token and the client secret the first time you connect.",
      );
    }
    return;
  }

  const accessTokenEncrypted = encryptSecret(input.accessToken);
  const clientSecretEncrypted = encryptSecret(input.clientSecret);

  await db
    .insert(certifierCredentials)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      accessTokenEncrypted,
      clientSecretEncrypted,
    })
    .onConflictDoUpdate({
      target: [
        certifierCredentials.organizationId,
        certifierCredentials.provider,
      ],
      set: {
        accessTokenEncrypted,
        clientSecretEncrypted,
        updatedAt: sql`now()`,
      },
    });
}

export async function getCertifierCredentialsStatus(
  ctx: OrgContext,
  organizationId: string,
  provider: CertifierProvider,
): Promise<CertifierCredentialsStatus> {
  assertCanManageOrgCredentials(ctx, organizationId);
  const [row] = await db
    .select({
      accessTokenEncrypted: certifierCredentials.accessTokenEncrypted,
      updatedAt: certifierCredentials.updatedAt,
    })
    .from(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, organizationId),
        eq(certifierCredentials.provider, provider)
      )
    )
    .limit(1);

  if (!row) {
    return { configured: false, accessTokenLast4: null, updatedAt: null };
  }

  return {
    configured: true,
    accessTokenLast4: decryptSecret(row.accessTokenEncrypted).slice(-4),
    updatedAt: row.updatedAt,
  };
}

export async function deleteCertifierCredentials(
  ctx: OrgContext,
  organizationId: string,
  provider: CertifierProvider,
): Promise<void> {
  assertCanManageOrgCredentials(ctx, organizationId);
  await db
    .delete(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, organizationId),
        eq(certifierCredentials.provider, provider)
      )
    );
}

/** Secret-free organization-scoped readiness check for certification flows. */
export async function hasCertifierCredentials(
  ctx: OrgContext,
  provider: CertifierProvider,
): Promise<boolean> {
  requireOrgScope(ctx);
  const [row] = await db
    .select({ organizationId: certifierCredentials.organizationId })
    .from(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, ctx.organizationId),
        eq(certifierCredentials.provider, provider),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * SERVER-ONLY INTERNAL CREDENTIAL BOUNDARY.
 *
 * This deliberately has no auth/context parameter because Batch 2's
 * organization-scoped Isometric client factory calls it after resolving the
 * organization from trusted server-side domain data. Never call it from a
 * `fn/` action or expose its return value to client code.
 */
export async function getDecryptedCertifierCredentials(
  organizationId: string,
  provider: CertifierProvider
): Promise<{ accessToken: string; clientSecret: string } | null> {
  const [row] = await db
    .select({
      accessTokenEncrypted: certifierCredentials.accessTokenEncrypted,
      clientSecretEncrypted: certifierCredentials.clientSecretEncrypted,
    })
    .from(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, organizationId),
        eq(certifierCredentials.provider, provider)
      )
    )
    .limit(1);

  if (!row) return null;
  return {
    accessToken: decryptSecret(row.accessTokenEncrypted),
    clientSecret: decryptSecret(row.clientSecretEncrypted),
  };
}
