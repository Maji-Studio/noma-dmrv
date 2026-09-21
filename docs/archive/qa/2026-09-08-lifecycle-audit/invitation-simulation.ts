import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: { getSession: vi.fn().mockResolvedValue(null) } } }));
import { updateSession } from "@/lib/auth/middleware";

describe("invitation admission baseline observation", () => {
  it("F28: anonymous invitation bootstrap request is redirected to login", async () => {
    const response = await updateSession(new NextRequest("http://localhost:3100/accept-invitation/audit-placeholder"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3100/login?from=%2Faccept-invitation%2Faudit-placeholder");
  });
});
