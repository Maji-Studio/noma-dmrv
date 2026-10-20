import { afterEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
const state = vi.hoisted(() => ({ enabled: true, rows: [] as { id: string }[] }));
const select = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { select } }));
vi.mock("./transport-legs", () => ({ deleteTransportLeg: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ requireEmissionsEntriesEnabled: () => {
  if (!state.enabled) throw new Error("gate off");
} }));
import { deleteTransportLeg } from "./transport-legs";
import { deleteSampleTransportLegForRetirement, listSampleTransportRetirementCandidates } from "./sample-transport-retirement";
const ctx: OrgContext = { organizationId: "org", userId: "admin-id", orgRole: "owner", isPlatformAdmin: true };
afterEach(() => { state.enabled = true; state.rows = []; vi.clearAllMocks(); });

it("requires organization scope and Platform Admin authority before reads", async () => {
  await expect(listSampleTransportRetirementCandidates({ ...ctx, organizationId: "" })).rejects.toThrow("Unauthorized");
  await expect(listSampleTransportRetirementCandidates({ ...ctx, isPlatformAdmin: false })).rejects.toThrow("Platform Admin");
  expect(select).not.toHaveBeenCalled();
});
it("refuses deletion before activation without reading or writing", async () => {
  state.enabled = false;
  await expect(deleteSampleTransportLegForRetirement(ctx, "leg", 1)).rejects.toThrow("gate off");
  expect(select).not.toHaveBeenCalled();
  expect(deleteTransportLeg).not.toHaveBeenCalled();
});
it("is a no-op for an already retired id and uses logged guarded deletion for a remaining leg", async () => {
  select.mockImplementation(() => ({ from: () => ({ where: () => Promise.resolve(state.rows) }) }));
  expect(await deleteSampleTransportLegForRetirement(ctx, "leg", 2)).toBe(false);
  state.rows = [{ id: "leg" }];
  expect(await deleteSampleTransportLegForRetirement(ctx, "leg", 2)).toBe(true);
  expect(deleteTransportLeg).toHaveBeenCalledExactlyOnceWith(ctx, "leg", 2, "system");
});
