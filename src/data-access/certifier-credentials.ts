import { and, eq, sql } from "drizzle-orm";
import { env } from "@/config/env";
import { db } from "@/db";
import { certifierCredentials } from "@/db/schema/certification";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { SafeError } from "@/lib/errors";
import {
  createIsometricClient,
  ISOMETRIC_BASE_URLS,
  type IsometricClient,
} from "@/lib/isometric/client";
import { listProjects } from "@/lib/isometric/projects";
import { requireOrgScope, type Executor } from "./utils";

type CertifierCredentialRow = typeof certifierCredentials.$inferSelect;
type CertifierProvider = CertifierCredentialRow["provider"];

const CROSS_ORG_CREDENTIALS_ERROR =
  "You can only manage credentials for your active Organization.";

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
    throw new SafeError(CROSS_ORG_CREDENTIALS_ERROR);
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

/** Server-only secrets; never expose the return value to client code. */
async function getDecryptedCertifierCredentials(
  ctx: OrgContext,
  provider: CertifierProvider,
  reader: Executor = db,
): Promise<{ accessToken: string; clientSecret: string } | null> {
  requireOrgScope(ctx);
  return loadDecryptedCertifierCredentials(ctx.organizationId, provider, reader);
}

// org-scope-ok: private lookup shared by the scoped getter and guarded Platform Admin verification.
async function loadDecryptedCertifierCredentials(
  organizationId: string,
  provider: CertifierProvider,
  reader: Executor = db,
): Promise<{ accessToken: string; clientSecret: string } | null> {
  const [row] = await reader
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

function clientFromCredentials(
  credentials: Awaited<ReturnType<typeof getDecryptedCertifierCredentials>>,
): IsometricClient {
  return createIsometricClient(
    credentials
      ? { ...credentials, baseUrl: ISOMETRIC_BASE_URLS[env.ISOMETRIC_ENVIRONMENT] }
      : null,
  );
}

export async function resolveIsometricClient(
  ctx: OrgContext,
  reader: Executor = db,
): Promise<IsometricClient> {
  requireOrgScope(ctx);
  const credentials = await getDecryptedCertifierCredentials(ctx, "isometric", reader);
  return clientFromCredentials(credentials);
}

// org-scope-ok: cross-organization credential verification requires Platform Admin authority.
export async function verifyIsometricCredentialsForOrganization(
  ctx: OrgContext,
  organizationId: string,
): Promise<number> {
  assertCanManageOrgCredentials(ctx, organizationId);
  const credentials = await loadDecryptedCertifierCredentials(organizationId, "isometric");
  const client = clientFromCredentials(credentials);
  return (await listProjects(client)).length;
}
