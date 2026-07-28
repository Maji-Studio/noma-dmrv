/**
 * DB-backed lifecycle tests for per-organization registry credentials. Requires
 * the real Postgres configured by the test environment.
 *
 * These use their own organization rather than the shared `ORG_ID`.
 * `certifier-credentials-access.test.ts` writes the same
 * `(organization, provider)` row under a different encryption key, and vitest
 * runs the two files concurrently against one database — sharing the row means
 * whichever file reads second decrypts with the wrong key and fails with
 * "Encrypted secret authentication failed".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureTestOrg } from "./helpers/test-org";

import { db } from "@/db";
import { organizations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  deleteCertifierCredentials,
  getCertifierCredentialsStatus,
  getDecryptedCertifierCredentials,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { certifierCredentials } from "@/db/schema/certification";

const PROVIDER = "isometric" as const;
const ORG_ID = "org_test_certifier_credentials_lifecycle";

function makeCtx(orgRole: OrgContext["orgRole"] = "owner"): OrgContext {
  return {
    userId: "user_test_certifier_credentials_lifecycle",
    organizationId: ORG_ID,
    orgRole,
    isPlatformAdmin: false,
  };
}

async function clearCredentials(): Promise<void> {
  await db
    .delete(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, ORG_ID),
        eq(certifierCredentials.provider, PROVIDER)
      )
    );
}

beforeAll(async () => {
  // ensureTestOrg() creates the shared fixtures org; this file needs its own.
  await ensureTestOrg();
  await db
    .insert(organizations)
    .values({
      id: ORG_ID,
      name: "Certifier Credentials Lifecycle",
      slug: "certifier-credentials-lifecycle",
    })
    .onConflictDoNothing();
});

beforeEach(async () => {
  await clearCredentials();
});

afterAll(clearCredentials);

describe.sequential("certifier credentials data access", () => {
  it("upserts, reports masked status, replaces, decrypts, and deletes", async () => {
    const ctx = makeCtx();
    await upsertCertifierCredentials(ctx, {
      organizationId: ORG_ID,
      provider: PROVIDER,
      accessToken: "initial-access-1234",
      clientSecret: "initial-client-secret",
    });

    const initialStatus = await getCertifierCredentialsStatus(
      ctx,
      ORG_ID,
      PROVIDER
    );
    expect(initialStatus).toMatchObject({
      configured: true,
      accessTokenLast4: "1234",
    });
    expect(initialStatus.updatedAt).toBeInstanceOf(Date);
    await expect(
      getDecryptedCertifierCredentials(ORG_ID, PROVIDER)
    ).resolves.toEqual({
      accessToken: "initial-access-1234",
      clientSecret: "initial-client-secret",
    });

    await upsertCertifierCredentials(ctx, {
      organizationId: ORG_ID,
      provider: PROVIDER,
      accessToken: "rotated-access-9876",
      clientSecret: "rotated-client-secret",
    });

    await expect(
      getCertifierCredentialsStatus(ctx, ORG_ID, PROVIDER)
    ).resolves.toMatchObject({
      configured: true,
      accessTokenLast4: "9876",
    });
    await expect(
      getDecryptedCertifierCredentials(ORG_ID, PROVIDER)
    ).resolves.toEqual({
      accessToken: "rotated-access-9876",
      clientSecret: "rotated-client-secret",
    });

    await deleteCertifierCredentials(ctx, ORG_ID, PROVIDER);
    await expect(
      getCertifierCredentialsStatus(ctx, ORG_ID, PROVIDER)
    ).resolves.toEqual({
      configured: false,
      accessTokenLast4: null,
      updatedAt: null,
    });
  });

  it("keeps the stored value for a key the caller omits", async () => {
    // The settings form leaves an untouched masked field out of the payload, so
    // rotating the access token must not blank the client secret.
    const ctx = makeCtx();
    await upsertCertifierCredentials(ctx, {
      organizationId: ORG_ID,
      provider: PROVIDER,
      accessToken: "initial-access-1234",
      clientSecret: "initial-client-secret",
    });

    await upsertCertifierCredentials(ctx, {
      organizationId: ORG_ID,
      provider: PROVIDER,
      accessToken: "rotated-access-9876",
    });

    await expect(
      getDecryptedCertifierCredentials(ORG_ID, PROVIDER)
    ).resolves.toEqual({
      accessToken: "rotated-access-9876",
      clientSecret: "initial-client-secret",
    });

    await upsertCertifierCredentials(ctx, {
      organizationId: ORG_ID,
      provider: PROVIDER,
      clientSecret: "rotated-client-secret",
    });

    await expect(
      getDecryptedCertifierCredentials(ORG_ID, PROVIDER)
    ).resolves.toEqual({
      accessToken: "rotated-access-9876",
      clientSecret: "rotated-client-secret",
    });
  });

  it("refuses a first save that carries only one key", async () => {
    // Nothing is stored to fall back on, so a partial first write would leave
    // the row half-empty.
    const ctx = makeCtx();
    await expect(
      upsertCertifierCredentials(ctx, {
        organizationId: ORG_ID,
        provider: PROVIDER,
        accessToken: "only-the-access-token",
      })
    ).rejects.toThrow(/both the access token and the client secret/i);
  });

  it("returns null from the internal getter when credentials are unconfigured", async () => {
    await expect(
      getDecryptedCertifierCredentials(ORG_ID, PROVIDER)
    ).resolves.toBeNull();
  });
});
