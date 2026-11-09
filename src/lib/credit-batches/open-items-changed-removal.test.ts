import { describe, expect, it } from "vitest";
import { buildCreditBatchOpenItems, type CreditBatchOpenItemsInput } from "./open-items";

const REMOVAL = {
  id: "removal-1", code: "RM-26-003", changedSinceReview: true as const,
  status: { kind: "interrupted" as const, label: "Submission interrupted", value: "failed" as const, isActionable: true, isTerminal: false },
};
const BASE = { facilityId: "facility", creditBatchId: "batch", canManage: true, canDeleteRegistryRemovals: true };

function items(canDeleteRegistryRemovals: boolean, finalized?: true) {
  return buildCreditBatchOpenItems({ ...BASE, canDeleteRegistryRemovals, removals: [{ ...REMOVAL, finalized }] });
}

describe("changed Removal open item", () => {
  it.each([
    { canDeleteRegistryRemovals: true, finalized: undefined, instruction: "Open the Removal and select Delete Removal. Then create the Removal again." },
    { canDeleteRegistryRemovals: false, finalized: undefined, instruction: "Ask an Admin to delete it. Then create the Removal again." },
    { canDeleteRegistryRemovals: true, finalized: true as const, instruction: "This Removal is finalized, so it cannot be deleted. Contact an Admin." },
    { canDeleteRegistryRemovals: false, finalized: true as const, instruction: "This Removal is finalized, so it cannot be deleted. Contact an Admin." },
  ])("shows the deletion guidance for finalized=$finalized, canDeleteRegistryRemovals=$canDeleteRegistryRemovals", ({ canDeleteRegistryRemovals, finalized, instruction }) => {
    expect(items(canDeleteRegistryRemovals, finalized)).toEqual({ blocking: [], check: [{
      id: "interrupted:removal-1",
      title: "RM-26-003: Changed since review",
      detail: "Part of it may already be in Isometric.",
      instruction,
      target: { href: "/removals?facility=facility&removal=removal-1" },
    }] });
  });

  it.each([true, false])("shows deletion in progress to canDeleteRegistryRemovals=%s unless finalized", (canDeleteRegistryRemovals) => {
    const removal = { ...REMOVAL, deletionInProgress: true as const };
    expect(buildCreditBatchOpenItems({ ...BASE, canDeleteRegistryRemovals, removals: [removal] }).check[0]).toMatchObject({
      instruction: "This Removal is being deleted. Reload the page to see the result.",
    });
    expect(buildCreditBatchOpenItems({ ...BASE, canDeleteRegistryRemovals, removals: [{ ...removal, finalized: true }] }).check[0]).toMatchObject({
      instruction: "This Removal is finalized, so it cannot be deleted. Contact an Admin.",
    });
  });

  it("keeps other interrupted Removals on Review & submit", () => {
    const removal = { ...REMOVAL, changedSinceReview: undefined };
    expect(buildCreditBatchOpenItems({ ...BASE, removals: [removal] }).check).toEqual([{
      id: "interrupted:removal-1", title: "RM-26-003: Submission interrupted",
      instruction: "Open the Removal and finish Review & submit.",
      target: { href: "/removals?facility=facility&resume=removal-1" },
    }]);
  });

  it("uses deletion access independently of management access", () => {
    expect(buildCreditBatchOpenItems({ ...BASE, canDeleteRegistryRemovals: false, removals: [REMOVAL] }).check[0]?.instruction)
      .toBe("Ask an Admin to delete it. Then create the Removal again.");
    expect(buildCreditBatchOpenItems({ ...BASE, canManage: false, removals: [REMOVAL] }).check[0]?.instruction)
      .toBe("Open the Removal and select Delete Removal. Then create the Removal again.");
  });

  it("uses finalized history when a superseding changed draft still has draft phase", () => {
    const removal = { ...REMOVAL, phase: "draft" as const, finalized: true as const };
    expect(buildCreditBatchOpenItems({ ...BASE, removals: [removal] }).check[0]?.instruction)
      .toBe("This Removal is finalized, so it cannot be deleted. Contact an Admin.");
  });

  it("does not add a changed item when the Removal is no longer interrupted", () => {
    const removals: CreditBatchOpenItemsInput["removals"] = [{ ...REMOVAL, status: { ...REMOVAL.status, kind: "submitted" } }];
    expect(buildCreditBatchOpenItems({ ...BASE, removals }).check).toEqual([]);
  });
});
