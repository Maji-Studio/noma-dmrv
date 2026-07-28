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

// Saving is also the connection test, so the action calls Isometric with the
// keys it just stored. The registry itself is out of scope here.
vi.mock("@/lib/isometric", () => ({
  getIsometricClientForOrg: vi.fn(),
  listProjects: vi.fn(),
  IsometricApiError: class IsometricApiError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
      public readonly body?: unknown,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "IsometricApiError";
    }
  },
}));

import {
  getCertifierCredentialsStatus,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { setOrgCertifierCredentialsFn } from "@/fn/certifier-credentials";
import { requireOrgContext } from "@/lib/auth/server";
import { getIsometricClientForOrg, listProjects } from "@/lib/isometric";

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
  vi.mocked(getIsometricClientForOrg).mockResolvedValue(
    {} as Awaited<ReturnType<typeof getIsometricClientForOrg>>,
  );
  vi.mocked(listProjects).mockResolvedValue([
    { id: "prj_1" },
  ] as Awaited<ReturnType<typeof listProjects>>);
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
      data: {
        status: { configured: true, accessTokenLast4: "1234" },
        verification: { ok: true, projectCount: 1 },
      },
    });
  });

  it("stores the keys even when the connection check fails, and says so", async () => {
    // The write comes first on purpose: a registry outage must not cost the
    // operator the keys they just pasted.
    vi.mocked(listProjects).mockRejectedValue(new Error("boom"));

    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(upsertCertifierCredentials).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      data: { verification: { ok: false } },
    });
    expect(result.success && result.data.verification.message).toContain(
      "Keys saved",
    );
  });

  it("rotates one key on its own without disturbing the other", async () => {
    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
    });

    // The settings form omits a field left at its mask; data-access keeps the
    // stored value for anything omitted.
    expect(upsertCertifierCredentials).toHaveBeenCalledWith(ORG_CONTEXT, {
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      provider: "isometric",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a save that carries neither key", async () => {
    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
    });

    expect(result).toEqual({
      success: false,
      error: "Enter an access token or a client secret to save.",
    });
    expect(upsertCertifierCredentials).not.toHaveBeenCalled();
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
