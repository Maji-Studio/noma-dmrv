import { describe, expect, it } from "vitest";
import { NOT_YET } from "@/types/emission-allocation";
import { BATCH_A, BATCH_B, REMOVAL_1, allocationFixture } from "./allocation-test-fixtures";
import {
  allOwners, amountsOf, basisFor, batchCodesOf, buildFocus, feedstockHint, fractionFor, percentFor, sharesOf, totalAmounts, wholePercents,
} from "./allocation-model";

const allocation = allocationFixture();
const byId = (id: string) => allocation.records.find((record) => record.id === id)!;
const codes = batchCodesOf(allocation);

describe("wholePercents", () => {
  it("adds to 100 by largest remainder", () => {
    const thirds = wholePercents([1 / 3, 1 / 3, 1 / 3]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBe(100);
    expect(wholePercents([0.6, 0.4])).toEqual([60, 40]);
    expect(wholePercents([0.125, 0.375, 0.5])).toEqual([13, 37, 50]);
  });
});

describe("buildFocus", () => {
  it("sorts batch owners by start date and focuses the page's batch", () => {
    const focus = buildFocus(allocation, { creditBatchId: BATCH_B })!;
    expect(focus.surface).toBe("batch");
    expect(focus.owners.map((owner) => owner.label)).toEqual(["CB-26-001", "CB-26-002", "CB-26-003"]);
    expect(focus.owner.key).toBe(BATCH_B);
    expect(focus.notYet.members).toEqual([NOT_YET]);
  });

  it("returns null when the page's batch or Removal is not in the response", () => {
    expect(buildFocus(allocation, { creditBatchId: "gone" })).toBeNull();
    expect(buildFocus(allocation, { removalId: "gone" })).toBeNull();
  });

  it("reads server Removal parts independently of batch membership", () => {
    const focus = buildFocus(allocation, { removalId: REMOVAL_1 })!;
    expect(focus.owner.members).toEqual([REMOVAL_1]);
    expect(focus.owner.sub).toBe("CB-26-001, CB-26-002");
    // The batch shares are 60/40, but this Removal owns only half the applied load.
    expect(fractionFor(byId("dl-1"), focus.owner)).toBe(0.5);
    expect(basisFor(byId("dl-1"), focus.owner)).toEqual([{ kind: "slice", label: "RM-26-001", kg: 2500 }]);
    expect(sharesOf(byId("dl-1"), allOwners(focus)).map((share) => share.percent)).toEqual([50, 50]);
  });

  it("reads explicit NOT_YET Removal parts, including batches without a Removal", () => {
    const focus = buildFocus(allocation, { removalId: REMOVAL_1 })!;
    expect(focus.notYet.members).toEqual([NOT_YET]);
    expect(fractionFor(byId("run-9"), focus.owner)).toBe(0);
    expect(fractionFor(byId("run-9"), focus.notYet)).toBe(1);
    expect(fractionFor(byId("fs-2"), focus.notYet)).toBe(1);
    // Every record still adds to 100 across the Removal columns plus Not yet allocated.
    for (const record of allocation.records) {
      expect(sharesOf(record, allOwners(focus)).reduce((sum, share) => sum + share.percent, 0)).toBe(100);
    }
  });

  it("does not double-count two Removals listing the same credit batches", () => {
    const input = structuredClone(allocation);
    input.removals.push({ ...input.removals[0], id: "followup", code: "RM-26-002" });
    const delivery = input.records.find(record => record.id === "dl-1")!;
    delivery.removalParts = [
      { key: REMOVAL_1, fraction: 0.5, basis: [{ kind: "slice", label: "RM-26-001", kg: 2500 }] },
      { key: "followup", fraction: 0.3, basis: [{ kind: "slice", label: "RM-26-002", kg: 1500 }] },
      { key: NOT_YET, fraction: 0.2, basis: [{ kind: "notYet", label: delivery.code, kg: 1000 }] },
    ];
    const focus = buildFocus(input, { removalId: "followup" })!;
    expect(fractionFor(delivery, focus.owner)).toBe(0.3);
    expect(sharesOf(delivery, allOwners(focus)).map(share => share.percent)).toEqual([50, 30, 20]);
    expect(fractionFor(input.records.find(record => record.id === "run-1")!, focus.owner)).toBe(0);
    expect(totalAmounts([delivery], focus.owner)).toEqual([{ unit: "t·km", value: 108 }]);
  });

  it("keeps a zero-fraction touching batch out of the share list", () => {
    const focus = buildFocus(allocation, { creditBatchId: BATCH_B })!;
    expect(sharesOf(byId("fs-1"), allOwners(focus)).map((share) => share.owner.label)).toEqual(["CB-26-001"]);
    expect(percentFor(byId("fs-1"), focus.owner, allOwners(focus))).toBe(0);
  });
});

describe("amounts", () => {
  it("sums per unit and keeps an unrecorded reading unknown, never zero", () => {
    expect(amountsOf(byId("run-1"))).toEqual([{ unit: "L", value: 22 }, { unit: "kWh", value: 168 }]);
    expect(amountsOf(byId("me-1"))).toEqual([{ unit: "kWh", value: null }]);
    const unknownDiesel = { ...byId("run-1"), quantities: byId("run-1").quantities.map((q) => (q.unit === "L" ? { ...q, value: null } : q)) };
    expect(amountsOf(unknownDiesel)[0]).toEqual({ unit: "L", value: null });
  });

  it("totals an owner's share and stays null when nothing was recorded", () => {
    const focus = buildFocus(allocation, { creditBatchId: BATCH_A })!;
    const deliveries = [byId("dl-1")];
    expect(totalAmounts(deliveries, focus.owner)[0].value).toBeCloseTo(216);
    expect(totalAmounts([byId("me-1")], focus.owner)).toEqual([{ unit: "kWh", value: null }]);
  });
});

describe("feedstockHint", () => {
  const focusA = buildFocus(allocation, { creditBatchId: BATCH_A })!;
  const focusB = buildFocus(allocation, { creditBatchId: BATCH_B })!;

  it("marks a delivery the page carries whole but only partly used", () => {
    const hint = feedstockHint(byId("fs-1"), focusA.owner, focusA.owners, codes)!;
    expect(hint).toMatchObject({ kind: "partly", usedKg: 2000, ownerLabel: "CB-26-001" });
  });

  it("says Counted on for a batch that drew from a delivery another batch carries", () => {
    expect(feedstockHint(byId("fs-1"), focusB.owner, focusB.owners, codes)).toMatchObject({ kind: "countedOn", usedKg: 3000, ownerLabel: "CB-26-001" });
  });

  it("stays quiet when nothing was drawn or the whole delivery was used", () => {
    expect(feedstockHint(byId("fs-2"), focusA.owner, focusA.owners, codes)).toBeNull();
    const whole = structuredClone(byId("fs-1"));
    whole.feedstock!.used = [{ creditBatchId: BATCH_A, code: "CB-26-001", kg: 10_000, runs: ["PR-26-001"] }];
    expect(feedstockHint(whole, focusA.owner, focusA.owners, codes)).toBeNull();
    expect(feedstockHint(byId("fs-1"), focusA.notYet, focusA.owners, codes)).toBeNull();
  });

  it("does not equate batch feedstock draws with a Removal's frozen slices", () => {
    const removalFocus = buildFocus(allocation, { removalId: REMOVAL_1 })!;
    expect(fractionFor(byId("fs-1"), removalFocus.owner)).toBe(1);
    expect(basisFor(byId("fs-1"), removalFocus.owner)).toEqual([{ kind: "claim", label: "CB-26-001", kg: null }]);
    expect(feedstockHint(byId("fs-1"), removalFocus.owner, removalFocus.owners, codes)).toBeNull();
  });
});
