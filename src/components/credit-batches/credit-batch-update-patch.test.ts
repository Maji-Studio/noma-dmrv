import { describe, expect, it } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import { creditBatchUpdatePatch, isCreditBatchMembershipLocked } from "./credit-batch-update-patch";

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
