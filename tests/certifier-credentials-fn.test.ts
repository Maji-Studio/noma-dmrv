import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  CREDENTIALS_ENCRYPTION_KEY: "a".repeat(64) as string | undefined,
}));

vi.mock("@/config/env", () => ({
  env: mockEnv,
}));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(),
}));

vi.mock("@/data-access/certifier-credentials", () => ({
  upsertCertifierCredentials: vi.fn(),
  getCertifierCredentialsStatus: vi.fn(),
  deleteCertifierCredentials: vi.fn(),
}));

vi.mock("@/fn/action-errors", () => ({
  logActionError: vi.fn(),
}));

import {
  getCertifierCredentialsStatus,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { setOrgCertifierCredentialsFn } from "@/fn/certifier-credentials";
import { requireOrgContext } from "@/lib/auth/server";

const ORGANIZATION_ID = "org_test";
const ACCESS_TOKEN = "access-token-sensitive-1234";
const CLIENT_SECRET = "client-secret-sensitive";
const ORG_CONTEXT = {
  userId: "user_test",
  organizationId: ORGANIZATION_ID,
  orgRole: "admin",
  isPlatformAdmin: false,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64);
  vi.mocked(requireOrgContext).mockResolvedValue(ORG_CONTEXT);
  vi.mocked(getCertifierCredentialsStatus).mockResolvedValue({
    configured: true,
    accessTokenLast4: "1234",
    updatedAt: new Date("2026-07-11T10:00:00.000Z"),
  });
});

describe("setOrgCertifierCredentialsFn", () => {
  it("requires an active organization context before writing credentials", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(
      new Error("Select an organization to continue"),
    );

    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(result).toEqual({
      success: false,
      error: "Failed to save Isometric credentials.",
    });
    expect(upsertCertifierCredentials).not.toHaveBeenCalled();
  });

  it("returns masked status and never echoes either secret", async () => {
    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(requireOrgContext).toHaveBeenCalledOnce();
    expect(upsertCertifierCredentials).toHaveBeenCalledWith(ORG_CONTEXT, {
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
      provider: "isometric",
    });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
    expect(result).toMatchObject({
      success: true,
      data: { configured: true, accessTokenLast4: "1234" },
    });
  });

  it("surfaces a clear error when the encryption key is not configured", async () => {
    mockEnv.CREDENTIALS_ENCRYPTION_KEY = undefined;

    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(result).toEqual({
      success: false,
      error: "Credential encryption key is not configured",
    });
    expect(upsertCertifierCredentials).not.toHaveBeenCalled();
  });
});
