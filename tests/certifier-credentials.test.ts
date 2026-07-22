/**
 * DB-backed lifecycle and authorization tests for per-organization registry
 * credentials. Requires the real Postgres configured by the test environment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

import { db } from "@/db";
import {
  deleteCertifierCredentials,
  getCertifierCredentialsStatus,
  getDecryptedCertifierCredentials,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { certifierCredentials } from "@/db/schema/certification";

const PROVIDER = "isometric" as const;

async function clearCredentials(): Promise<void> {
  await db
    .delete(certifierCredentials)
    .where(
      and(
        eq(certifierCredentials.organizationId, TEST_ORG_ID),
        eq(certifierCredentials.provider, PROVIDER)
      )
    );
}

beforeAll(() => ensureTestOrg());

beforeEach(async () => {
  await clearCredentials();
});

afterAll(clearCredentials);

describe.sequential("certifier credentials data access", () => {
  it("upserts, reports masked status, replaces, decrypts, and deletes", async () => {
    const ctx = makeTestOrgContext();
    await upsertCertifierCredentials(ctx, {
      organizationId: TEST_ORG_ID,
      provider: PROVIDER,
      accessToken: "initial-access-1234",
      clientSecret: "initial-client-secret",
    });

    const initialStatus = await getCertifierCredentialsStatus(
      ctx,
      TEST_ORG_ID,
      PROVIDER
    );
    expect(initialStatus).toMatchObject({
      configured: true,
      accessTokenLast4: "1234",
    });
    expect(initialStatus.updatedAt).toBeInstanceOf(Date);
    await expect(
      getDecryptedCertifierCredentials(TEST_ORG_ID, PROVIDER)
    ).resolves.toEqual({
      accessToken: "initial-access-1234",
      clientSecret: "initial-client-secret",
    });

    await upsertCertifierCredentials(ctx, {
      organizationId: TEST_ORG_ID,
      provider: PROVIDER,
      accessToken: "rotated-access-9876",
      clientSecret: "rotated-client-secret",
    });

    await expect(
      getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER)
    ).resolves.toMatchObject({
      configured: true,
      accessTokenLast4: "9876",
    });
    await expect(
      getDecryptedCertifierCredentials(TEST_ORG_ID, PROVIDER)
    ).resolves.toEqual({
      accessToken: "rotated-access-9876",
      clientSecret: "rotated-client-secret",
    });

    await deleteCertifierCredentials(ctx, TEST_ORG_ID, PROVIDER);
    await expect(
      getCertifierCredentialsStatus(ctx, TEST_ORG_ID, PROVIDER)
    ).resolves.toEqual({
      configured: false,
      accessTokenLast4: null,
      updatedAt: null,
    });
  });

  it("returns null from the internal getter when credentials are unconfigured", async () => {
    await expect(
      getDecryptedCertifierCredentials(TEST_ORG_ID, PROVIDER)
    ).resolves.toBeNull();
  });
});
