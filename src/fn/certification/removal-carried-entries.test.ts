import { beforeEach, expect, it, vi } from "vitest";
import { getRemovalCarriedEntriesFn } from "./removal-carried-entries";
import { loadRemovalCarriedEntries } from "@/data-access/removal-carried-entries";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { OrgContext } from "@/lib/auth/server";
vi.mock("@/data-access/removal-carried-entries", () => ({ loadRemovalCarriedEntries: vi.fn() }));
vi.mock("../with-action", () => ({ withAction: async (fn: (ctx: OrgContext) => Promise<unknown>) => {
  try { return { success: true, data: await fn(makeTestOrgContext()) }; }
  catch { return { success: false }; }
} }));
beforeEach(() => vi.resetAllMocks());
it("validates the Removal ID before accessing data", async () => {
  expect(await getRemovalCarriedEntriesFn({ removalId: "invalid" })).toMatchObject({ success: false });
  expect(loadRemovalCarriedEntries).not.toHaveBeenCalled();
});
it("uses the authenticated context and returns the narrow result", async () => {
  const removalId = crypto.randomUUID();
  vi.mocked(loadRemovalCarriedEntries).mockResolvedValue([]);
  expect(await getRemovalCarriedEntriesFn({ removalId })).toEqual({ success: true, data: [] });
  expect(loadRemovalCarriedEntries).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), removalId);
});
