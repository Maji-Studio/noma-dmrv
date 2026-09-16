import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { getSession, rows, resolvers } = vi.hoisted(() => ({
  getSession: vi.fn(),
  rows: new Map<string, Array<Record<string, unknown>>>(),
  // Per-table override when a test needs the answer to depend on the query.
  resolvers: new Map<string, (params: string[]) => Array<Record<string, unknown>>>(),
}));

vi.mock("@/lib/auth/providers/better-auth-server", () => ({
  getBetterAuthSession: getSession,
  mapBetterAuthUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  /** Bound values of a drizzle condition, so a mock can answer per query. */
  const paramValues = (node: unknown, found: string[] = []): string[] => {
    if (!node || typeof node !== "object") return found;
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) paramValues(chunk, found);
      return found;
    }
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string") found.push(value);
    return found;
  };
  return { db: {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: (condition: unknown) => ({
          limit: async () => {
            const name = getTableName(table);
            const resolver = resolvers.get(name);
            return resolver ? resolver(paramValues(condition)) : rows.get(name) ?? [];
          },
        }),
      }),
    }),
  } };
});

import { resolveOrgContext, type OrgContext } from "@/lib/auth/server";
import { resolveCliAdminIdentity, runWithCliOrgContext, type CliIdentity } from "./org-context";

const IDENTITY: CliIdentity = {
  userId: "bootstrap-admin",
  organizationId: "bootstrap-org",
};
const CONTEXT: OrgContext = {
  ...IDENTITY,
  orgRole: "owner",
  isPlatformAdmin: true,
};

describe("CLI organization context", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_BOOTSTRAP", "");
    rows.clear();
    resolvers.clear();
    rows.set("users", [{ id: IDENTITY.userId }]);
    rows.set("organizations", [{ id: IDENTITY.organizationId }]);
    getSession.mockReset();
    getSession.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("resolves an override across async work without reading a session", async () => {
    getSession.mockRejectedValue(new Error("No request available"));
    const result = await runWithCliOrgContext(IDENTITY, async () => {
      await Promise.resolve();
      return resolveOrgContext();
    });
    expect(result).toEqual({ ok: true, ctx: CONTEXT });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("falls through to normal session resolution outside the callback", async () => {
    await runWithCliOrgContext(IDENTITY, resolveOrgContext);
    expect(await resolveOrgContext()).toEqual({
      ok: false,
      denial: "unauthenticated",
    });
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("rejects production overrides without the explicit bootstrap flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const callback = vi.fn();
    await expect(runWithCliOrgContext(IDENTITY, callback)).rejects.toThrow(
      "ALLOW_DEV_BOOTSTRAP=1"
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("allows the staging bootstrap flag in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_BOOTSTRAP", "1");
    expect(await runWithCliOrgContext(IDENTITY, resolveOrgContext)).toEqual({
      ok: true,
      ctx: CONTEXT,
    });
  });

  it("refuses an identity that is not a Platform Admin", async () => {
    rows.set("users", []);
    const callback = vi.fn();
    await expect(runWithCliOrgContext(IDENTITY, callback)).rejects.toThrow(
      "Platform Admin"
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("refuses an organization that does not exist", async () => {
    rows.set("organizations", []);
    const callback = vi.fn();
    await expect(runWithCliOrgContext(IDENTITY, callback)).rejects.toThrow(
      "existing organization"
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("points an unbootstrapped database at the bootstrap command", async () => {
    rows.set("users", []);
    await expect(resolveCliAdminIdentity(IDENTITY.organizationId)).rejects.toThrow(
      "db:ensure-admin"
    );
  });

  it("isolates concurrent callbacks and restores context after rejection", async () => {
    resolvers.set("organizations", (params: string[]): Row[] => {
      const id = params.find((param) => param.startsWith("org-"));
      return id ? [{ id }] : [];
    });
    const first = { ...IDENTITY, organizationId: "org-first" };
    const second = { ...IDENTITY, organizationId: "org-second" };
    const results = await Promise.all([
      runWithCliOrgContext(first, async () => {
        await Promise.resolve();
        return resolveOrgContext();
      }),
      runWithCliOrgContext(second, resolveOrgContext),
    ]);
    expect(results).toEqual([
      { ok: true, ctx: { ...CONTEXT, organizationId: first.organizationId } },
      { ok: true, ctx: { ...CONTEXT, organizationId: second.organizationId } },
    ]);
    await expect(
      runWithCliOrgContext(first, async () => {
        throw new Error("Seed failed");
      })
    ).rejects.toThrow("Seed failed");
    expect(await resolveOrgContext()).toEqual({
      ok: false,
      denial: "unauthenticated",
    });
  });
});
