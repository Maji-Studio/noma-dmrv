import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("./providers/better-auth-server", () => ({
  getBetterAuthSession: getSession,
  mapBetterAuthUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/db", () => ({ db: {} }));

import { resolveOrgContext, runWithOrgContext, type OrgContext } from "./server";

const CONTEXT: OrgContext = {
  userId: "bootstrap-admin",
  organizationId: "bootstrap-org",
  orgRole: "owner",
  isPlatformAdmin: true,
};

describe("CLI organization context", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_BOOTSTRAP", "");
    getSession.mockReset();
    getSession.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("resolves an override across async work without reading a session", async () => {
    getSession.mockRejectedValue(new Error("No request available"));
    const result = await runWithOrgContext(CONTEXT, async () => {
      await Promise.resolve();
      return resolveOrgContext();
    });
    expect(result).toEqual({ ok: true, ctx: CONTEXT });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("falls through to normal session resolution outside the callback", async () => {
    await runWithOrgContext(CONTEXT, resolveOrgContext);
    expect(await resolveOrgContext()).toEqual({
      ok: false,
      denial: "unauthenticated",
    });
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("rejects production overrides without the explicit bootstrap flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    const callback = vi.fn();
    expect(() => runWithOrgContext(CONTEXT, callback)).toThrow(
      "ALLOW_DEV_BOOTSTRAP=1"
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("allows the staging bootstrap flag in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_BOOTSTRAP", "1");
    expect(await runWithOrgContext(CONTEXT, resolveOrgContext)).toEqual({
      ok: true,
      ctx: CONTEXT,
    });
  });

  it("isolates concurrent callbacks and restores context after rejection", async () => {
    const other = { ...CONTEXT, organizationId: "other-org" };
    const results = await Promise.all([
      runWithOrgContext(CONTEXT, async () => {
        await Promise.resolve();
        return resolveOrgContext();
      }),
      runWithOrgContext(other, resolveOrgContext),
    ]);
    expect(results).toEqual([
      { ok: true, ctx: CONTEXT },
      { ok: true, ctx: other },
    ]);
    await expect(
      runWithOrgContext(CONTEXT, async () => {
        throw new Error("Seed failed");
      })
    ).rejects.toThrow("Seed failed");
    expect(await resolveOrgContext()).toEqual({
      ok: false,
      denial: "unauthenticated",
    });
  });
});
