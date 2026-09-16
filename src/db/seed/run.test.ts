import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, Array<Record<string, unknown>>>(),
  conditions: new Map<string, unknown>(),
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  return { db: {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        return {
          where: (condition: unknown) => {
            state.conditions.set(name, condition);
            return { limit: async () => state.rows.get(name) ?? [] };
          },
        };
      },
    }),
  } };
});
vi.mock("@/lib/auth/server", () => ({
  runWithOrgContext: vi.fn(async (_ctx: unknown, fn: () => Promise<void>) => fn()),
}));
vi.mock("./registry", () => ({ registryEnvironment: vi.fn() }));
vi.mock("./infrastructure", () => ({ seedInfrastructure: vi.fn(async () => ({ registryStatus: "stubbed" })) }));
vi.mock("./production", () => ({ seedProduction: vi.fn() }));
vi.mock("./distribution", () => ({ seedDistribution: vi.fn() }));

import { seedInfrastructure } from "./infrastructure";
import { seedMafinga } from "./run";

/** Column names referenced by a drizzle condition, for lookup assertions. */
function columnNames(node: unknown, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) columnNames(chunk, found);
    return found;
  }
  const column = node as { name?: unknown; columnType?: unknown };
  if (typeof column.name === "string" && typeof column.columnType === "string") {
    found.push(column.name);
  }
  return found;
}

describe("Mafinga seed idempotency", () => {
  beforeEach(() => {
    state.rows.clear();
    state.conditions.clear();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("matches the seeded facility by code or by name", async () => {
    state.rows.set("facilities", [{ id: "facility-1" }]);
    state.rows.set("deliveries", [{ id: "delivery-1" }]);
    await seedMafinga();
    expect(columnNames(state.conditions.get("facilities"))).toEqual(
      expect.arrayContaining(["organization_id", "code", "name"]),
    );
  });

  it("skips a complete dataset without creating anything", async () => {
    state.rows.set("facilities", [{ id: "facility-1" }]);
    state.rows.set("deliveries", [{ id: "delivery-1" }]);
    await seedMafinga();
    expect(seedInfrastructure).not.toHaveBeenCalled();
  });

  it("refuses to reseed on top of a partial run", async () => {
    state.rows.set("facilities", [{ id: "facility-1" }]);
    await expect(seedMafinga()).rejects.toThrow("partial Mafinga seed");
    expect(seedInfrastructure).not.toHaveBeenCalled();
  });

  it("runs the seed when the bootstrap identities exist and no facility does", async () => {
    state.rows.set("users", [{ id: "admin-1" }]);
    state.rows.set("organizations", [{ id: "org-1" }]);
    await seedMafinga();
    expect(seedInfrastructure).toHaveBeenCalledTimes(1);
  });
});
