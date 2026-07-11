/**
 * DB-backed lifecycle and authorization tests for per-organization registry
 * credentials. Requires the real Postgres configured by the test environment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureTestOrg, TEST_ORG_ID } from "./helpers/test-org";

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    requirePlatformAdmin: vi.fn(),
  };
});

import { db } from "@/db";
import {
  deleteCertifierCredentials,
  getCertifierCredentialsStatus,
  getDecryptedCertifierCredentials,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { certifierCredentials } from "@/db/schema/certification";
import * as authServer from "@/lib/auth/server";

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
  vi.mocked(authServer.requirePlatformAdmin).mockReset();
  vi.mocked(authServer.requirePlatformAdmin).mockResolvedValue({} as never);
  await clearCredentials();
});

afterAll(clearCredentials);

describe.sequential("certifier credentials data access", () => {
  it("upserts, reports masked status, replaces, decrypts, and deletes", async () => {
    await upsertCertifierCredentials({
      organizationId: TEST_ORG_ID,
      provider: PROVIDER,
      accessToken: "initial-access-1234",
      clientSecret: "initial-client-secret",
    });

    const initialStatus = await getCertifierCredentialsStatus(
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

    await upsertCertifierCredentials({
      organizationId: TEST_ORG_ID,
      provider: PROVIDER,
      accessToken: "rotated-access-9876",
      clientSecret: "rotated-client-secret",
    });

    await expect(
      getCertifierCredentialsStatus(TEST_ORG_ID, PROVIDER)
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

    await deleteCertifierCredentials(TEST_ORG_ID, PROVIDER);
    await expect(
      getCertifierCredentialsStatus(TEST_ORG_ID, PROVIDER)
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
    expect(authServer.requirePlatformAdmin).not.toHaveBeenCalled();
  });

  it("enforces the Platform Admin gate on every administrative operation", async () => {
    const denied = new Error("Platform Admin access is required");
    vi.mocked(authServer.requirePlatformAdmin).mockRejectedValue(denied);

    await expect(
      upsertCertifierCredentials({
        organizationId: TEST_ORG_ID,
        provider: PROVIDER,
        accessToken: "blocked-token",
        clientSecret: "blocked-secret",
      })
    ).rejects.toBe(denied);
    await expect(
      getCertifierCredentialsStatus(TEST_ORG_ID, PROVIDER)
    ).rejects.toBe(denied);
    await expect(
      deleteCertifierCredentials(TEST_ORG_ID, PROVIDER)
    ).rejects.toBe(denied);
    expect(authServer.requirePlatformAdmin).toHaveBeenCalledTimes(3);
  });
});
