import { describe, expect, it } from "vitest";
import { NOT_YET } from "@/types/emission-allocation";
import { BATCH_A, BATCH_B, BATCH_C, REMOVAL_1, allocationFixture } from "./allocation-test-fixtures";
import {
  allOwners, amountsOf, batchCodesOf, buildFocus, feedstockHint, fractionFor, percentFor, sharesOf, totalAmounts, wholePercents,
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

  it("sums each batch's parts into the Removal that holds it", () => {
    const focus = buildFocus(allocation, { removalId: REMOVAL_1 })!;
    expect(focus.owner.members).toEqual([BATCH_A, BATCH_B]);
    expect(focus.owner.sub).toBe("CB-26-001, CB-26-002");
    // The delivery splits 60/40 across two batches of one Removal: the Removal carries all of it.
    expect(fractionFor(byId("dl-1"), focus.owner)).toBeCloseTo(1);
    expect(sharesOf(byId("dl-1"), allOwners(focus)).map((share) => share.percent)).toEqual([100]);
  });

  it("puts NOT_YET parts and parts of batches in no Removal under Not yet allocated", () => {
    const focus = buildFocus(allocation, { removalId: REMOVAL_1 })!;
    expect(focus.notYet.members).toEqual([NOT_YET, BATCH_C]);
    expect(fractionFor(byId("run-9"), focus.owner)).toBe(0);
    expect(fractionFor(byId("run-9"), focus.notYet)).toBe(1);
    expect(fractionFor(byId("fs-2"), focus.notYet)).toBe(1);
    // Every record still adds to 100 across the Removal columns plus Not yet allocated.
    for (const record of allocation.records) {
      expect(sharesOf(record, allOwners(focus)).reduce((sum, share) => sum + share.percent, 0)).toBe(100);
    }
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

  it("names the Removal as carrier on the Removal surface", () => {
    const removalFocus = buildFocus(allocation, { removalId: REMOVAL_1 })!;
    const hint = feedstockHint(byId("fs-1"), removalFocus.owner, removalFocus.owners, codes)!;
    // Both batches sit in RM-26-001: used 2,000 + 3,000 of 10,000.
    expect(hint).toMatchObject({ kind: "partly", usedKg: 5000, ownerLabel: "RM-26-001" });
  });
});
