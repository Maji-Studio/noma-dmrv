import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorageLocationById } from "@/data-access/storage-locations";
import { cleanupPostedStock, postedStockFixture } from "./helpers/posted-output-stock-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
import { createStorageLocationFn } from "@/fn/quick-add";

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await cleanupPostedStock(fixture); });

describe("inline bin creation draw defaults", () => {
  it.each(["split", "mix"] as const)("saves the chosen newest-first preference and %s stock mode", async (stockMode) => {
    const f = await postedStockFixture({ stockKg: 0 });
    fixtures.push(f);
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await createStorageLocationFn({ name: `E2E Draw order ${f.tag}`, facilityId: f.facility.id,
      type: "biochar_bin", stockMode, drawOrder: "newest_first" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(await getStorageLocationById(f.ctx, result.data.id)).toMatchObject({ stockMode, drawOrder: "newest_first", version: 1 });
  });
});
