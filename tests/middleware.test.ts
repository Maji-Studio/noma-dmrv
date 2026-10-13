import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getSessionMock = vi.fn();

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

describe("Auth middleware", () => {
  it("returns 401 for unauthenticated protected API routes", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { updateSession } = await import("@/lib/auth/middleware");
    const request = new NextRequest("http://localhost:3100/api/documents");

    const response = await updateSession(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("allows the verifier capability route to authorize its own token", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { updateSession } = await import("@/lib/auth/middleware");
    const request = new NextRequest(
      "http://localhost:3100/api/ghg-statement-reports/11111111-1111-4111-8111-111111111111?token=opaque",
    );

    const response = await updateSession(request);

    expect(response.status).toBe(200);
  });

  it("lets the MCP route authenticate its own requests, without a session lookup", async () => {
    getSessionMock.mockClear();

    const { updateSession } = await import("@/lib/auth/middleware");
    const response = await updateSession(
      new NextRequest("http://localhost:3100/api/mcp", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it.each(["/api/mcpx", "/api/mcp/tools"])(
    "keeps %s behind the session",
    async (path) => {
      getSessionMock.mockResolvedValueOnce(null);

      const { updateSession } = await import("@/lib/auth/middleware");
      const response = await updateSession(new NextRequest(`http://localhost:3100${path}`));

      expect(response.status).toBe(401);
    },
  );
});

describe("REST proxy carve-out", () => {
  it.each(["/api/v1", "/api/v1/", "/api/v1/me", "/api/v1/openapi.json", "/api/v1/llms.txt"])("passes %s without session lookup", async (path) => {
    getSessionMock.mockClear();
    const { updateSession } = await import("@/lib/auth/middleware");
    expect((await updateSession(new NextRequest(`http://localhost:3100${path}`))).status).toBe(200);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
  it("ignores an unverified cookie before lookup", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ user: { emailVerified: false } });
    const { updateSession } = await import("@/lib/auth/middleware");
    const response = await updateSession(new NextRequest("http://localhost:3100/api/v1/me", { headers: { cookie: "better-auth.session_token=unverified" } }));
    expect(response.status).toBe(200);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
  it.each(["/api/v1x", "/api/v10/me"])("does not carve out %s", async (path) => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(null);
    const { updateSession } = await import("@/lib/auth/middleware");
    expect((await updateSession(new NextRequest(`http://localhost:3100${path}`))).status).toBe(401);
    expect(getSessionMock).toHaveBeenCalledOnce();
  });
});

describe("cron proxy boundary", () => {
  it("passes the exact purge route before looking up a session", async () => {
    getSessionMock.mockReset();
    const { updateSession } = await import("@/lib/auth/middleware");
    const response = await updateSession(new NextRequest("http://localhost/api/cron/purge-api-records"));
    expect(response.status).toBe(200);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
  it.each(["/api/cron", "/api/cron/purge-api-recordsx", "/api/cron/purge-api-records/", "/api/cron/purge-api-records/child"])("protects %s", async (path) => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(null);
    const { updateSession } = await import("@/lib/auth/middleware");
    expect((await updateSession(new NextRequest(`http://localhost${path}`))).status).toBe(401);
    expect(getSessionMock).toHaveBeenCalledOnce();
  });
});
