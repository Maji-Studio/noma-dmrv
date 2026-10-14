import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { certifierCredentials } from "@/db/schema/certification";
import { IsometricApiError } from "@/lib/isometric/client";
import {
  resolveIsometricClient,
  verifyIsometricCredentialsForOrganization,
} from "./certifier-credentials";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  decrypt: vi.fn((value: string) => value.replace("encrypted-", "")),
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" },
}));
vi.mock("@/config/env", () => ({ env: mocks.env }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/auth/server", () => ({ requireOrgRole: vi.fn() }));
vi.mock("@/lib/crypto/secrets", () => ({
  decryptSecret: mocks.decrypt,
  encryptSecret: vi.fn(),
}));

const CTX: OrgContext = {
  userId: "user-isometric-client",
  organizationId: "org-isometric-client",
  orgRole: "member",
  isPlatformAdmin: false,
};
const ROW = {
  accessTokenEncrypted: "encrypted-org-token",
  clientSecretEncrypted: "encrypted-org-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.ISOMETRIC_ENVIRONMENT = "sandbox";
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([ROW]);
});
afterEach(() => vi.unstubAllGlobals());

describe("organization-scoped Isometric client", () => {
  it.each([
    { ...CTX, userId: " " },
    { ...CTX, organizationId: " " },
  ])("rejects incomplete org scope before reading secrets", async (ctx) => {
    await expect(resolveIsometricClient(ctx)).rejects.toThrow("Unauthorized");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it.each(["sandbox", "production"])("uses scoped credentials and the %s URL", async (environment) => {
    mocks.env.ISOMETRIC_ENVIRONMENT = environment;
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const client = await resolveIsometricClient(CTX);
    await client.get("/projects");

    expect(mocks.where).toHaveBeenCalledWith(and(
      eq(certifierCredentials.organizationId, CTX.organizationId),
      eq(certifierCredentials.provider, "isometric"),
    ));
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.${environment === "sandbox" ? "sandbox." : ""}isometric.com/mrv/v0/projects`,
      expect.objectContaining({ headers: {
        Accept: "application/json",
        "X-Client-Secret": "org-secret",
        Authorization: "Bearer org-token",
      } }),
    );
  });

  it("preserves the not-configured error without making a request", async () => {
    mocks.limit.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await resolveIsometricClient(CTX);
    const error = await client.get("/projects").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(IsometricApiError);
    expect(error).toMatchObject({
      code: "not_configured",
      message: "The registry connection is not configured for this Organization. Ask an Owner or Admin to add the connection credentials.",
      status: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Platform Admin credential verification", () => {
  it("preserves the not-configured error without making a request", async () => {
    mocks.limit.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyIsometricCredentialsForOrganization(
      { ...CTX, orgRole: null, isPlatformAdmin: true }, "org-selected",
    )).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates registry errors from the credential check", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyIsometricCredentialsForOrganization(
      { ...CTX, orgRole: null, isPlatformAdmin: true }, "org-selected",
    )).rejects.toMatchObject({ code: "http", status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an organization Admin before loading a selected org's secrets", async () => {
    await expect(verifyIsometricCredentialsForOrganization(
      { ...CTX, orgRole: "admin" }, "org-selected",
    )).rejects.toThrow("You can only manage credentials for your active Organization.");
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("still requires complete org scope for a Platform Admin", async () => {
    await expect(verifyIsometricCredentialsForOrganization(
      { ...CTX, organizationId: "", isPlatformAdmin: true }, "org-selected",
    )).rejects.toThrow("Unauthorized");
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("allows a Platform Admin to verify the selected organization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      nodes: [{ id: "prj-selected" }],
      page_info: { has_next_page: false },
    })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyIsometricCredentialsForOrganization(
      { ...CTX, orgRole: null, isPlatformAdmin: true }, "org-selected",
    )).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects?"),
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({
        Authorization: "Bearer org-token",
        "X-Client-Secret": "org-secret",
      }) }),
    );
    expect(mocks.where).toHaveBeenCalledWith(and(
      eq(certifierCredentials.organizationId, "org-selected"),
      eq(certifierCredentials.provider, "isometric"),
    ));
  });
});
