vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => ({ userId: "user", organizationId: "org", orgRole: "owner", isPlatformAdmin: false }) }));
import { withAction } from "@/fn/with-action";
import { afterEach, expect, it, vi } from "vitest";
const flag = vi.hoisted(() => ({ EMISSIONS_ENTRIES_ENABLED: false }));
vi.mock("@/config/env", () => ({ env: flag }));
import { emissionsEntriesEnabled, requireEmissionsEntriesEnabled, assertTransportEntryType } from "./emissions-entry-gate";
afterEach(() => { flag.EMISSIONS_ENTRIES_ENABLED = false; });
it("refuses entries and preserves sample legs when disabled", () => {
  expect(emissionsEntriesEnabled()).toBe(false);
  expect(requireEmissionsEntriesEnabled).toThrow("not available yet");
  expect(() => assertTransportEntryType("sample")).not.toThrow();
});
it("allows entries and refuses only sample legs when enabled", () => {
  flag.EMISSIONS_ENTRIES_ENABLED = true;
  expect(requireEmissionsEntriesEnabled).not.toThrow();
  expect(() => assertTransportEntryType("sample")).toThrow("emissions entry");
  for (const type of ["feedstock", "biochar"]) expect(() => assertTransportEntryType(type)).not.toThrow();
});

it("returns a clear ActionResult refusal while disabled", async () => {
  expect(await withAction(async () => { requireEmissionsEntriesEnabled(); return null; })).toEqual({ success: false, error: "Emissions entries are not available yet." });
});
