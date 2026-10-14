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
  verifyIsometricCredentialsForOrganization: vi.fn(),
  upsertCertifierCredentials: vi.fn(),
  getCertifierCredentialsStatus: vi.fn(),
  deleteCertifierCredentials: vi.fn(),
}));

vi.mock("@/fn/action-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fn/action-errors")>()),
  logActionError: vi.fn(),
}));

// Data-access owns the connection check; the action formats its errors.
vi.mock("@/lib/isometric", () => ({
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
  verifyIsometricCredentialsForOrganization,
  upsertCertifierCredentials,
} from "@/data-access/certifier-credentials";
import { setOrgCertifierCredentialsFn } from "@/fn/certifier-credentials";
import { requireOrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  CERTIFIER_CREDENTIAL_MASK,
  certifierCredentialsRotationSchema,
} from "@/schemas/organizations";

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
  vi.mocked(verifyIsometricCredentialsForOrganization).mockResolvedValue(1);
});

describe("setOrgCertifierCredentialsFn", () => {
  it("requires an active organization context before writing credentials", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(
      new Error("Select an Organization to continue"),
    );

    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(result).toEqual({
      success: false,
      error: "Isometric credentials were not saved. Try again.",
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
    expect(verifyIsometricCredentialsForOrganization).toHaveBeenCalledWith(
      ORG_CONTEXT,
      ORGANIZATION_ID,
    );
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

  it("verifies a selected organization's credentials for a Platform Admin", async () => {
    const ctx = { ...ORG_CONTEXT, orgRole: null, isPlatformAdmin: true } as const;
    vi.mocked(requireOrgContext).mockResolvedValue(ctx);
    const selectedOrgId = "org_selected";

    const result = await setOrgCertifierCredentialsFn({
      organizationId: selectedOrgId,
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(result.success).toBe(true);
    expect(verifyIsometricCredentialsForOrganization)
      .toHaveBeenCalledWith(ctx, selectedOrgId);
    expect(result).toMatchObject({
      success: true,
      data: { verification: { ok: true, projectCount: 1 } },
    });
  });

  it("does not verify credentials when a non-admin's cross-org save is rejected", async () => {
    const message = "You can only manage credentials for your active Organization.";
    vi.mocked(upsertCertifierCredentials).mockRejectedValueOnce(new SafeError(message));

    const result = await setOrgCertifierCredentialsFn({
      organizationId: "org_selected",
      accessToken: ACCESS_TOKEN,
      clientSecret: CLIENT_SECRET,
    });

    expect(result).toEqual({ success: false, error: message });
    expect(upsertCertifierCredentials).toHaveBeenCalledOnce();
    expect(verifyIsometricCredentialsForOrganization).not.toHaveBeenCalled();
    expect(getCertifierCredentialsStatus).not.toHaveBeenCalled();
  });

  it("stores the keys even when the connection check fails, and says so", async () => {
    // The write comes first on purpose: a registry outage must not cost the
    // operator the keys they just pasted.
    vi.mocked(verifyIsometricCredentialsForOrganization).mockRejectedValueOnce(new Error("boom"));

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

  it.each([
    CERTIFIER_CREDENTIAL_MASK,
    `${CERTIFIER_CREDENTIAL_MASK}real-token`,
    `real${CERTIFIER_CREDENTIAL_MASK}token`,
    `real-token${CERTIFIER_CREDENTIAL_MASK}`,
  ])("refuses to store a mask-contaminated key: %s", async (accessToken) => {
    // The form drops an untouched masked field, but the action is a public
    // server boundary — a hand-rolled request must not be able to store the
    // placeholder or any contaminated derivative as a real credential.
    const result = await setOrgCertifierCredentialsFn({
      organizationId: ORGANIZATION_ID,
      accessToken,
      clientSecret: CLIENT_SECRET,
    });

    expect(result).toEqual({
      success: false,
      error: "That is the placeholder for a stored key, not a key.",
    });
    expect(upsertCertifierCredentials).not.toHaveBeenCalled();
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
      error:
        "Credential encryption is not configured. Ask a Platform Admin to configure it.",
    });
    expect(upsertCertifierCredentials).not.toHaveBeenCalled();
  });
});

describe("certifier credential rotation schema", () => {
  it("accepts the exact untouched mask", () => {
    expect(
      certifierCredentialsRotationSchema.safeParse({
        accessToken: CERTIFIER_CREDENTIAL_MASK,
        clientSecret: CERTIFIER_CREDENTIAL_MASK,
      }).success,
    ).toBe(true);
  });

  it("rejects a key containing mask characters", () => {
    const result = certifierCredentialsRotationSchema.safeParse({
      accessToken: `${CERTIFIER_CREDENTIAL_MASK}real-token`,
      clientSecret: CERTIFIER_CREDENTIAL_MASK,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Remove the masked placeholder before entering a key.",
    );
  });
});
