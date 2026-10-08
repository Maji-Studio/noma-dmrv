import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  member: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/data-access/api-credential-auth", () => ({
  findApiCredential: mocks.find,
  findApiCredentialMember: mocks.member,
}));
vi.mock("./better-auth", () => ({ auth: { api: { verifyApiKey: mocks.verify } } }));
vi.mock("@/lib/read-models/api-me", () => ({ readApiMe: vi.fn() }));
import { GET } from "@/app/api/v1/me/route";
import { apiDenialResponse } from "@/lib/api/problem";
import { resolveApiContext } from "./api-context";

const request = () => new Request("http://localhost/api/v1/me", { headers: { authorization: "Bearer synthetic" } });

const stored = () => ({
  key: {
    id: "credential",
    enabled: true,
    expiresAt: new Date("2100-01-01"),
    permissions: '{"feedstocks":["read"]}',
    name: "Intake",
  },
  owner: {
    memberId: "member",
    userId: "owner",
    organizationId: "org",
    revokedAt: null,
    revocationReason: null,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockImplementation(stored);
  mocks.member.mockResolvedValue({
    id: "member",
    role: "admin",
    emailVerified: true,
  });
  mocks.verify.mockResolvedValue({
    valid: true,
    key: { id: "credential" },
  });
});

it("checks live membership after plugin verification and never forwards cookies", async () => {
  const result = await resolveApiContext(request());
  expect(result).toMatchObject({
    ok: true,
    ctx: {
      userId: "owner",
      organizationId: "org",
      isPlatformAdmin: false,
      scopes: ["feedstocks:read"],
    },
  });
  expect(mocks.verify).toHaveBeenCalledWith({ body: { key: "synthetic" } });
  expect(mocks.member).toHaveBeenCalledTimes(2);
});

it("refuses removal between verification and context construction", async () => {
  mocks.member.mockResolvedValueOnce({
    id: "member",
    role: "admin",
    emailVerified: true,
  }).mockResolvedValueOnce(undefined);
  expect(await resolveApiContext(request())).toEqual({
    ok: false,
    denial: "credential_owner_removed",
  });
});

it("refuses a concurrent revocation after verification", async () => {
  mocks.find.mockReturnValueOnce(stored()).mockReturnValueOnce({
    ...stored(),
    owner: {
      ...stored().owner,
      revokedAt: new Date(),
    },
  });
  expect(await resolveApiContext(request())).toEqual({
    ok: false,
    denial: "credential_revoked",
  });
});

it("throws when plugin verification fails but the stored credential remains valid", async () => {
  mocks.verify.mockResolvedValueOnce({
    valid: false,
    key: null,
    error: { code: "INVALID_API_KEY" },
  });
  await expect(resolveApiContext(request())).rejects.toThrow("API credential verification failed unexpectedly.");
  expect(mocks.find).toHaveBeenCalledTimes(2);
});

it("answers a sanitized 500 when the plugin rejects a valid stored credential", async () => {
  mocks.verify.mockResolvedValue({ valid: false, key: null, error: { code: "INVALID_API_KEY" } });
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(await response.json()).toMatchObject({
    code: "internal_error",
    detail: "The request could not be completed.",
    errors: [],
  });
});

it("returns a 401 denial when the credential disappears during plugin verification", async () => {
  mocks.verify.mockResolvedValueOnce({
    valid: false,
    key: null,
    error: { code: "INVALID_API_KEY" },
  });
  mocks.find.mockReturnValueOnce(stored()).mockReturnValueOnce(undefined);
  const result = await resolveApiContext(request());
  expect(result).toEqual({
    ok: false,
    denial: "credential_invalid",
  });
  if (result.ok) throw new Error("Expected a credential denial");
  expect(apiDenialResponse(result.denial, "/api/v1/me", "request-id").status).toBe(401);
});

it.each([null, "previous-member"])("refuses a missing or replaced issuance membership (%s)", async (memberId) => {
  mocks.find.mockReturnValue({
    ...stored(),
    owner: {
      ...stored().owner,
      memberId,
    },
  });
  expect(await resolveApiContext(request())).toEqual({
    ok: false,
    denial: "credential_owner_removed",
  });
  expect(mocks.verify).not.toHaveBeenCalled();
});

it("does not resurrect credentials on owner re-admission", async () => {
  mocks.find.mockReturnValue({
    ...stored(),
    owner: {
      ...stored().owner,
      revocationReason: "credential_owner_removed",
    },
  });
  expect(await resolveApiContext(request())).toEqual({
    ok: false,
    denial: "credential_owner_removed",
  });
  expect(mocks.verify).not.toHaveBeenCalled();
});
