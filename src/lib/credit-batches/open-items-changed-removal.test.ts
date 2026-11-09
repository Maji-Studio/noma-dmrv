import { describe, expect, it } from "vitest";
import { buildCreditBatchOpenItems, type CreditBatchOpenItemsInput } from "./open-items";

const REMOVAL = {
  id: "removal-1", code: "RM-26-003", phase: "draft" as const, changedSinceReview: true as const,
  status: { kind: "interrupted" as const, label: "Submission interrupted", value: "failed" as const, isActionable: true, isTerminal: false },
};
const BASE = { facilityId: "facility", creditBatchId: "batch", canManage: true };

function items(canManage: boolean, phase: "draft" | "submitted") {
  return buildCreditBatchOpenItems({ ...BASE, canManage, removals: [{ ...REMOVAL, phase }] });
}

describe("changed Removal open item", () => {
  it.each([
    { canManage: true, phase: "draft" as const, instruction: "Open the Removal and select Delete Removal. Then create the Removal again." },
    { canManage: false, phase: "draft" as const, instruction: "Ask an Admin to delete it. Then create the Removal again." },
    { canManage: true, phase: "submitted" as const, instruction: "This Removal is finalized, so it cannot be deleted. Contact an admin or Isometric." },
    { canManage: false, phase: "submitted" as const, instruction: "This Removal is finalized, so it cannot be deleted. Contact an admin or Isometric." },
  ])("shows the deletion guidance for $phase, canManage=$canManage", ({ canManage, phase, instruction }) => {
    expect(items(canManage, phase)).toEqual({ blocking: [], check: [{
      id: "interrupted:removal-1",
      title: "RM-26-003: Changed since review",
      detail: "Part of it may already be in Isometric.",
      instruction,
      target: { href: "/removals?facility=facility&removal=removal-1" },
    }] });
  });

  it("keeps other interrupted Removals on Review & submit", () => {
    const removal = { ...REMOVAL, changedSinceReview: undefined };
    expect(buildCreditBatchOpenItems({ ...BASE, removals: [removal] }).check).toEqual([{
      id: "interrupted:removal-1", title: "RM-26-003: Submission interrupted",
      instruction: "Open the Removal and finish Review & submit.",
      target: { href: "/removals?facility=facility&resume=removal-1" },
    }]);
  });

  it("does not add a changed item when the Removal is no longer interrupted", () => {
    const removals: CreditBatchOpenItemsInput["removals"] = [{ ...REMOVAL, status: { ...REMOVAL.status, kind: "submitted" } }];
    expect(buildCreditBatchOpenItems({ ...BASE, removals }).check).toEqual([]);
  });
});
