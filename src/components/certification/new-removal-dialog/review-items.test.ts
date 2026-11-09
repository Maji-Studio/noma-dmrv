import { describe, expect, it } from "vitest";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import type { RemovalBlocker } from "@/lib/certification/removal-blockers";
import type { ComponentRow } from "./component-table-model";
import { blockerItems, blockersOutsideRows, buildReviewItems, componentItems } from "./review-items";

const FACILITY = "facility-1";
const BATCHES = [{ id: "batch-a", code: "CB-26-001" }];

function check(overrides: Partial<RemovalRequirementCheck>): RemovalRequirementCheck {
  return {
    key: "production", label: "Linked production data", requirementLabel: "Linked production data",
    unmetLabel: "No production run linked", whyDetail: "Each batch must trace to a production run.",
    status: "unmet", detail: "CB-26-001", ...overrides,
  } as RemovalRequirementCheck;
}

function blockedRow(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    componentId: "lab", name: "Lab electricity", groupKey: "g", groupName: "Group", state: "blocked", source: "", figure: null,
    fileCount: 0, fileEntryIds: [],
    blocked: { items: [{ message: "Add a file for each entry.", batchCodes: ["CB-26-001"], fixes: [{ label: "Review emissions", href: "/e", batchCode: null }] }] },
    ...overrides,
  };
}

describe("review items", () => {
  it("titles an unmet check by its named problem, with the reason behind the (i)", () => {
    const [item] = buildReviewItems({
      checks: [check({}), check({ key: "mapping", status: "met" })], blockers: [], blockedRows: [], creditBatches: BATCHES,
      facilityId: FACILITY, unbindableText: null, unbindableComponentIds: [],
    });
    expect(item.title).toBe("No production run linked");
    expect(item.explanation).toBe("Each batch must trace to a production run.");
    expect(item.lines).toEqual(["CB-26-001"]);
  });

  it("titles a blocked component by its name and carries its message and repair", () => {
    const [item] = componentItems([blockedRow()]);
    expect(item).toMatchObject({ title: "Lab electricity", explanation: "Add a file for each entry.", batchCode: "CB-26-001" });
    expect(item.fixes).toEqual([{ label: "Review emissions", href: "/e" }]);
  });

  it("renders a sent-entry blocker from its message and fix target alone, never its code or the component id it carries as a name", () => {
    const blocker = {
      code: "sentEntryOutsideWindow", message: "The entry on 2026-03-01 is outside the period.", fixTarget: "emissions",
      lineRef: { componentId: "diesel_use", displayName: "diesel_use" },
    } as RemovalBlocker;
    const [item] = blockerItems([blocker], FACILITY, ["batch-a"]);
    expect(item.title).toBe("Emissions entry");
    expect(item.explanation).toBe(blocker.message);
    expect(item.fixes).toHaveLength(1);
  });

  it("uses the message as the title of a blocker with no line and no fix target, with no (i) repeating it", () => {
    const blocker = { code: "legacy", message: "Delivery DL-1 has no proof of delivery.", fixTarget: null } as RemovalBlocker;
    const [item] = blockerItems([blocker], FACILITY, []);
    expect(item).toMatchObject({ title: blocker.message, explanation: null, fixes: [] });
  });

  it("does not count a blocker twice when a blocked row already says it", () => {
    const row = blockedRow();
    const repeated = { code: "entryMissingEvidence", message: "Add a file for each entry.", fixTarget: "emissions", lineRef: { componentId: "lab", displayName: "Lab electricity" } } as RemovalBlocker;
    const other = { code: "legacy", message: "Delivery DL-1 has no proof of delivery.", fixTarget: null } as RemovalBlocker;
    const items = buildReviewItems({
      checks: [], blockers: [repeated, other], blockedRows: [row], creditBatches: BATCHES, facilityId: FACILITY,
      unbindableText: null, unbindableComponentIds: [],
    });
    expect(items.map((item) => item.title)).toEqual(["Lab electricity", "Delivery DL-1 has no proof of delivery."]);
  });

  it("keeps a blocker item's id when its message changes, so a partly fixed fault does not read as fixed", () => {
    const base = { code: "legacy", fixTarget: "emissions", lineRef: { componentId: "diesel_use", displayName: "Diesel" } } as const;
    const [before] = blockerItems([{ ...base, message: "3 entries need a file." } as RemovalBlocker], FACILITY, []);
    const [after] = blockerItems([{ ...base, message: "2 entries need a file." } as RemovalBlocker], FACILITY, []);
    expect(after.id).toBe(before.id);
  });

  describe("blockersOutsideRows", () => {
    const sentence = "Template input is not bound.";
    const sameAsRow = { code: "legacy", message: "Add a file for each entry.", lineRef: { componentId: "lab", displayName: "Lab electricity" } } as RemovalBlocker;
    const unbindable = { code: "legacy", message: sentence } as RemovalBlocker;

    it("drops a blocker its component row already says, and keeps one the row does not", () => {
      const other = { ...sameAsRow, message: "Something else." } as RemovalBlocker;
      expect(blockersOutsideRows([sameAsRow, other], [blockedRow()], { text: null, componentIds: [] })).toEqual([other]);
    });

    it("drops the unbindable sentence when every named id is a blocked row, and keeps it otherwise", () => {
      expect(blockersOutsideRows([unbindable], [blockedRow()], { text: sentence, componentIds: ["lab"] })).toEqual([]);
      expect(blockersOutsideRows([unbindable], [blockedRow()], { text: sentence, componentIds: ["lab", "other"] })).toEqual([unbindable]);
    });
  });
});
