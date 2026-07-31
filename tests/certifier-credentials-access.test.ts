import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  deleteCertifierCredentials,
  getCertifierCredentialsStatus,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { certifierCredentials } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { ensureTestOrg, TEST_ORG_ID } from "./helpers/test-org";

const PROVIDER = "isometric" as const;
const OTHER_ORG_ID = "org_test_certifier_credentials_other";
const CROSS_ORG_ERROR =
  "You can only manage credentials for your active Organization.";
const originalEncryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

function context(
  orgRole: OrgContext["orgRole"],
  organizationId = TEST_ORG_ID,
  isPlatformAdmin = false,
): OrgContext {
  return {
    userId: `test-certifier-credentials-${orgRole ?? "platform"}`,
    organizationId,
    orgRole,
    isPlatformAdmin,
  };
}

async function clearCredentials(): Promise<void> {
  await db
    .delete(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, TEST_ORG_ID),
        eq(certifierCredentials.provider, PROVIDER),
      ),
    );
}

async function upsert(ctx: OrgContext, suffix: string): Promise<void> {
  await upsertCertifierCredentials(ctx, {
    organizationId: TEST_ORG_ID,
    provider: PROVIDER,
    accessToken: `test-access-${suffix}`,
    clientSecret: `test-client-${suffix}`,
  });
}

beforeAll(async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64);
  await ensureTestOrg();
  await db
    .insert(organizations)
    .values({
      id: OTHER_ORG_ID,
      name: "Certifier Credentials Access Test",
      slug: "certifier-credentials-access-test",
    })
    .onConflictDoNothing({ target: organizations.id });
});

beforeEach(clearCredentials);

afterAll(async () => {
  await clearCredentials();
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG_ID));
  if (originalEncryptionKey === undefined) {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  } else {
    process.env.CREDENTIALS_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

describe.sequential("certifier credentials authorization", () => {
  it("allows a platform admin to manage a foreign organization", async () => {
    const ctx = context(null, OTHER_ORG_ID, true);
    await upsert(ctx, "platform-1234");
    await expect(
      getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER),
    ).resolves.toMatchObject({ configured: true, accessTokenLast4: "1234" });
    await deleteCertifierCredentials(ctx, TEST_ORG_ID, PROVIDER);
    await expect(
      getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER),
    ).resolves.toMatchObject({ configured: false, accessTokenLast4: null });
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows an organization ${role} to manage the active organization`, async () => {
      const ctx = context(role);
      await upsert(ctx, `${role}-5678`);
      await expect(
        getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER),
      ).resolves.toMatchObject({ configured: true, accessTokenLast4: "5678" });
      await deleteCertifierCredentials(ctx, TEST_ORG_ID, PROVIDER);
      await expect(
        getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER),
      ).resolves.toMatchObject({ configured: false, accessTokenLast4: null });
    });
  }

  it("rejects an active-organization member on every operation", async () => {
    const ctx = context("member");
    await expect(upsert(ctx, "member-0000")).rejects.toBeInstanceOf(SafeError);
    await expect(
      getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER),
    ).rejects.toBeInstanceOf(SafeError);
    await expect(
      deleteCertifierCredentials(ctx, TEST_ORG_ID, PROVIDER),
    ).rejects.toBeInstanceOf(SafeError);
  });

  it("rejects an admin whose active organization differs from the target", async () => {
    const ctx = context("admin", OTHER_ORG_ID);
    await expect(upsert(ctx, "cross-org-0000")).rejects.toThrow(CROSS_ORG_ERROR);
    await expect(
      getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER),
    ).rejects.toThrow(CROSS_ORG_ERROR);
    await expect(
      deleteCertifierCredentials(ctx, TEST_ORG_ID, PROVIDER),
    ).rejects.toThrow(CROSS_ORG_ERROR);
  });
});
