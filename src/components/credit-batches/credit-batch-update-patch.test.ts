import { describe, expect, it, vi } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import {
  CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE,
  creditBatchUpdatePatch,
  isCreditBatchMembershipLocked,
  saveCreditBatchEdit,
} from "./credit-batch-update-patch";

const SAVED = { facilityId: "f-1", feedstockTypeId: "ft-1", startDate: "2026-09-01", endDate: "2026-09-30", productionRunIds: ["run-1", "run-2"] };
const FORM = {
  facilityId: "f-1", feedstockTypeId: "ft-1", startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-30T00:00:00Z"),
  productionRunIds: ["run-2", "run-1"], siteManagementNotes: "Wet season",
};
const lock = (level: RecordLockView["level"], kinds: string[]): RecordLockView => ({
  level, heldBy: [], usedBy: kinds.map((kind, index) => ({ kind, id: `${kind}-${index}`, label: null, facilityId: null })),
  freeFields: [], howToFree: null, returnedBy: [],
});

describe("credit batch update patch", () => {
  it("sends the whole definition of a free batch, so saving re-resolves membership", () => {
    expect(creditBatchUpdatePatch(FORM, SAVED, false)).toEqual(FORM);
  });

  it("leaves an unchanged membership out while a Removal holds it, so a notes-only save passes", () => {
    expect(creditBatchUpdatePatch(FORM, SAVED, true)).toEqual({ siteManagementNotes: "Wet season" });
  });

  it("refuses to drop a membership change made before the lock arrived", () => {
    expect(creditBatchUpdatePatch({ ...FORM, startDate: new Date("2026-08-01T00:00:00Z") }, SAVED, true)).toBeNull();
    expect(creditBatchUpdatePatch({ ...FORM, productionRunIds: ["run-1"] }, SAVED, true)).toBeNull();
  });

  it("locks the membership for a Removal slice or a Sent Removal, never for a Sample alone", () => {
    expect(isCreditBatchMembershipLocked(lock("inUse", ["removal"]))).toBe(true);
    expect(isCreditBatchMembershipLocked(lock("sent", []))).toBe(true);
    expect(isCreditBatchMembershipLocked(lock("inUse", ["sample"]))).toBe(false);
    expect(isCreditBatchMembershipLocked(undefined)).toBe(false);
  });
});

describe("saveCreditBatchEdit", () => {
  const snapshot = { ...SAVED, id: "batch-1", version: 3 };
  const data = { ...FORM, sampling: "sampled" as const };

  it("sends the snapshot's version without sampling, so a concurrent save conflicts", async () => {
    const update = vi.fn(async () => ({ success: true }));
    await expect(saveCreditBatchEdit({ data, saved: snapshot, membershipLocked: false, update })).resolves.toEqual({ status: "saved" });
    expect(update).toHaveBeenCalledWith({ creditBatchId: "batch-1", expectedVersion: 3, ...FORM });
  });

  it("keeps the warning of a save whose follow-up failed", async () => {
    const update = async () => ({ success: true, warning: "Details did not load." });
    await expect(saveCreditBatchEdit({ data, saved: snapshot, membershipLocked: false, update }))
      .resolves.toEqual({ status: "saved", warning: "Details did not load." });
  });

  it("refuses a held membership change before calling the server", async () => {
    const update = vi.fn();
    const moved = { ...data, startDate: new Date("2026-08-01T00:00:00Z") };
    await expect(saveCreditBatchEdit({ data: moved, saved: snapshot, membershipLocked: true, update }))
      .resolves.toEqual({ status: "error", message: CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE });
    expect(update).not.toHaveBeenCalled();
  });

  it("turns a refused or thrown save into the form's error", async () => {
    await expect(saveCreditBatchEdit({ data, saved: snapshot, membershipLocked: false, update: async () => ({ success: false, error: "Stale." }) }))
      .resolves.toEqual({ status: "error", message: "Stale." });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(saveCreditBatchEdit({ data, saved: snapshot, membershipLocked: false, update: async () => { throw new Error("Changed by someone else."); } }))
      .resolves.toEqual({ status: "error", message: "Changed by someone else." });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
