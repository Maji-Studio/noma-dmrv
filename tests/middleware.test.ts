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
    const request = new NextRequest("http://localhost:3100/api/projects");

    const response = await updateSession(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
