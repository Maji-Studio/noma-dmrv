import { describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import type { RecordLockView } from "@/lib/record-lock-view";
import {
  CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE,
  creditBatchUpdatePatch,
  canAddCreditBatchRuns,
  creditBatchOnlyAddsRuns,
  isCreditBatchMembershipLocked,
  logUnexpectedSaveError,
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
  it("sends only added membership for a held draft or returned batch", () => {
    const draft = { ...FORM, productionRunIds: ["run-2", "run-1", "missed"] };
    expect(creditBatchOnlyAddsRuns(draft, SAVED)).toBe(true);
    expect(canAddCreditBatchRuns(lock("inUse", ["removal"]))).toBe(true);
    expect(canAddCreditBatchRuns(undefined)).toBe(true);
    expect(canAddCreditBatchRuns(lock("sent", ["removal"]))).toBe(false);
    expect(creditBatchUpdatePatch(draft, SAVED, lock("inUse", ["removal"])))
      .toEqual({ productionRunIds: draft.productionRunIds, siteManagementNotes: "Wet season" });
    expect(creditBatchUpdatePatch(draft, SAVED, lock("sent", ["removal"]))).toBeNull();
  });

  it("requires a strict superset and unchanged cohort fields for held additions", () => {
    for (const change of [
      { productionRunIds: ["run-1", "missed"] },
      { productionRunIds: ["run-1", "run-2", "run-2"] },
      { productionRunIds: ["run-1", "run-2", "missed"], facilityId: "elsewhere" },
      { productionRunIds: ["run-1", "run-2", "missed"], feedstockTypeId: "other" },
      { productionRunIds: ["run-1", "run-2", "missed"], startDate: new Date("2026-08-01") },
      { productionRunIds: ["run-1", "run-2", "missed"], endDate: new Date("2026-10-01") },
    ]) {
      expect(creditBatchOnlyAddsRuns({ ...FORM, ...change }, SAVED)).toBe(false);
      expect(creditBatchUpdatePatch({ ...FORM, ...change }, SAVED, lock("inUse", ["removal"]))).toBeNull();
    }
    expect(creditBatchOnlyAddsRuns(FORM, SAVED)).toBe(false);
    expect(creditBatchOnlyAddsRuns({ ...FORM, productionRunIds: undefined }, SAVED)).toBe(false);
  });
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

  it("passes held additions through the save boundary when given the lock view", async () => {
    const update = vi.fn(async () => ({ success: true }));
    await expect(saveCreditBatchEdit({
      data: { ...data, productionRunIds: ["run-1", "run-2", "missed"] },
      saved: snapshot, membershipLocked: lock("inUse", ["removal"]), update,
    })).resolves.toEqual({ status: "saved" });
    expect(update).toHaveBeenCalledWith({ creditBatchId: "batch-1", expectedVersion: 3,
      productionRunIds: ["run-1", "run-2", "missed"], siteManagementNotes: "Wet season" });
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
      .resolves.toMatchObject({ status: "error", message: "Changed by someone else." });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});

describe("saveCreditBatchEdit logging", () => {
  const saved = { ...SAVED, id: "cb-1", version: 3 };
  const save = (update: () => Promise<never>) =>
    saveCreditBatchEdit({ data: { ...FORM, sampling: "sampled" } as never, saved, membershipLocked: false, update });

  it("shows a refused edit beside the form without logging an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const refusal = new ActionError({ error: "Credit batch CB-1 was not changed. 1 manual entry falls outside the new dates." });

    expect(await save(() => Promise.reject(refusal))).toEqual({ status: "error", message: refusal.message, cause: refusal });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("still logs an unexpected failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await save(() => Promise.reject(new TypeError("fetch failed")));
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe("logUnexpectedSaveError", () => {
  it("skips a refused create and keeps logging a real failure", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logUnexpectedSaveError("Credit batch create error:", new ActionError({ error: "Dates fall outside the entries." }));
    expect(error).not.toHaveBeenCalled();

    logUnexpectedSaveError("Credit batch create error:", new TypeError("fetch failed"));
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
