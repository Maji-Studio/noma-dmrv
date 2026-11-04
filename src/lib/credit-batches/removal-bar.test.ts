import { describe, expect, it } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { DerivedStatus } from "@/lib/certification/status";
import {
  NOT_IN_REMOVAL_GROUP_ID,
  segmentForRemoval,
  notAppliedCaptionKg,
  removalBarGroups,
  showOverviewRemovals,
} from "./removal-bar";

type Removal = CreditBatchPageModel["removals"][number];
type Slice = CreditBatchPageModel["slices"][number];

const STATUS: DerivedStatus = { kind: "not-submitted", value: "draft", label: "Not submitted", isActionable: true, isTerminal: false };

function slice(applicationId: string, dryKg: number, removalId: string | null): Slice {
  return {
    applicationId,
    applicationCode: `AP-${applicationId}`,
    applicationDate: new Date("2026-09-25T00:00:00Z"),
    deliveryId: "delivery",
    deliveryCode: "DL-26-001",
    wetKg: dryKg,
    dryKg,
    removalId,
  };
}

function removal(id: string, phase: Removal["phase"], dryKg: number): Removal {
  return { id, code: `RM-${id}`, status: STATUS, phase, createdAt: new Date("2026-10-01T00:00:00Z"), submittedAt: null, ghgStatementId: null, dryKg };
}

function model(slices: Slice[], removals: Removal[], notAppliedDryKg: number | null = 0): CreditBatchPageModel {
  const sum = (rows: Slice[]) => rows.reduce((total, row) => total + row.dryKg, 0);
  return {
    creditBatchId: "batch",
    facilityId: "facility",
    slices,
    removals,
    mass: {
      producedDryKg: notAppliedDryKg == null ? null : sum(slices) + notAppliedDryKg,
      appliedDryKg: sum(slices),
      inSubmittedDryKg: 0,
      inDraftDryKg: 0,
      notInRemovalDryKg: sum(slices.filter((row) => row.removalId === null)),
      notAppliedDryKg,
    },
    milestones: { firstRemovalSubmittedAt: null, firstRemovalSubmittedCode: null, ghgStatement: null },
  };
}

describe("removalBarGroups", () => {
  it("orders submitted Removals, then drafts, then the applied biochar in none", () => {
    const groups = removalBarGroups(model(
      [slice("a", 100, "draft"), slice("b", 50, "sent"), slice("c", 30, "sent"), slice("d", 20, null)],
      [removal("draft", "draft", 100), removal("sent", "submitted", 80)],
    ));
    expect(groups.map((group) => [group.id, group.segment, group.dryKg])).toEqual([
      ["sent", "submitted", 80],
      ["draft", "draft", 100],
      [NOT_IN_REMOVAL_GROUP_ID, "notInRemoval", 20],
    ]);
    expect(groups[0].parts.map((part) => part.id)).toEqual(["b", "c"]);
  });

  it("leaves out empty groups and zero slices", () => {
    const groups = removalBarGroups(model([slice("a", 0, null), slice("b", 40, null)], [removal("empty", "draft", 0)]));
    expect(groups).toHaveLength(1);
    expect(groups[0].parts.map((part) => part.id)).toEqual(["b"]);
  });
});

describe("segmentForRemoval", () => {
  it("colours submitted, draft and unplaced biochar apart", () => {
    expect(segmentForRemoval({ phase: "submitted" })).toBe("submitted");
    expect(segmentForRemoval({ phase: "draft" })).toBe("draft");
    expect(segmentForRemoval(null)).toBe("notInRemoval");
  });
});

describe("showOverviewRemovals", () => {
  it("shows once the batch holds a Removal or is ready with applied biochar", () => {
    const applied = model([slice("a", 10, null)], []);
    expect(showOverviewRemovals(applied, 2)).toBe(false);
    expect(showOverviewRemovals(applied, null)).toBe(false);
    expect(showOverviewRemovals(applied, 0)).toBe(true);
    expect(showOverviewRemovals(model([], []), 0)).toBe(false);
    expect(showOverviewRemovals(model([slice("a", 10, "r")], [removal("r", "draft", 10)]), 3)).toBe(true);
    expect(showOverviewRemovals(undefined, 0)).toBe(false);
  });
});

describe("notAppliedCaptionKg", () => {
  it("shows produced but not applied biochar from 5 kg", () => {
    expect(notAppliedCaptionKg(model([], [], 4.9))).toBeNull();
    expect(notAppliedCaptionKg(model([], [], 5))).toBe(5);
    expect(notAppliedCaptionKg(model([], [], null))).toBeNull();
  });
});
