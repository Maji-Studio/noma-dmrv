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
});
