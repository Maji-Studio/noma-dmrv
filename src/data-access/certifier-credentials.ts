import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { certifierCredentials } from "@/db/schema/certification";
import { requirePlatformAdmin } from "@/lib/auth/server";
import type { OrgContext } from "@/lib/auth/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { requireOrgScope } from "./utils";

type CertifierCredentialRow = typeof certifierCredentials.$inferSelect;
type CertifierProvider = CertifierCredentialRow["provider"];

export type UpsertCertifierCredentialsInput = {
  organizationId: string;
  provider: CertifierProvider;
  accessToken: string;
  clientSecret: string;
};

export type CertifierCredentialsStatus = {
  configured: boolean;
  accessTokenLast4: string | null;
  updatedAt: Date | null;
};

export async function upsertCertifierCredentials(
  input: UpsertCertifierCredentialsInput
): Promise<void> {
  await requirePlatformAdmin();
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
  organizationId: string,
  provider: CertifierProvider
): Promise<CertifierCredentialsStatus> {
  await requirePlatformAdmin();
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
  organizationId: string,
  provider: CertifierProvider
): Promise<void> {
  await requirePlatformAdmin();
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
