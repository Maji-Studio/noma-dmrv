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
  it("sends only the notes when the definition is unchanged", () => {
    expect(creditBatchUpdatePatch(FORM, SAVED, false)).toEqual({ siteManagementNotes: "Wet season" });
  });

  it("sends a changed definition while the membership is free", () => {
    const patch = creditBatchUpdatePatch({ ...FORM, endDate: new Date("2026-10-15T00:00:00Z"), productionRunIds: ["run-1"] }, SAVED, false);
    expect(patch).toEqual({ siteManagementNotes: "Wet season", endDate: new Date("2026-10-15T00:00:00Z"), productionRunIds: ["run-1"] });
  });

  it("never sends membership while a Removal holds it", () => {
    expect(creditBatchUpdatePatch({ ...FORM, startDate: new Date("2026-08-01T00:00:00Z") }, SAVED, true)).toEqual({ siteManagementNotes: "Wet season" });
  });

  it("locks the membership for a Removal slice or a Sent Removal, never for a Sample alone", () => {
    expect(isCreditBatchMembershipLocked(lock("inUse", ["removal"]))).toBe(true);
    expect(isCreditBatchMembershipLocked(lock("sent", []))).toBe(true);
    expect(isCreditBatchMembershipLocked(lock("inUse", ["sample"]))).toBe(false);
    expect(isCreditBatchMembershipLocked(undefined)).toBe(false);
  });
});
