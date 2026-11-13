import { describe, expect, it } from "vitest";
import { NOT_YET } from "@/types/emission-allocation";
import { buildFocus, batchCodesOf, percentFor } from "./allocation-model";
import { hintPhrases, streamSummary } from "./allocation-share-summary";
import { STREAMS, visibleStreams } from "./allocation-streams";
import { BATCH_A, BATCH_B, BATCH_C, MANY_DELIVERIES, REMOVAL_1, allocationFixture, manyDeliveriesFixture } from "./allocation-test-fixtures";

const stream = (key: string) => STREAMS.find((candidate) => candidate.key === key)!;
const FOLLOWUP = "removal-2";

function onBatch(batchId: string, data = allocationFixture()) {
  return { data, focus: buildFocus(data, { creditBatchId: batchId })! };
}

describe("streamSummary, per-stream owner shares", () => {
  it("splits feedstock transport between the batch that carries it and Not yet allocated", () => {
    const { data, focus } = onBatch(BATCH_A);
    const summary = streamSummary(stream("feedstock"), data.records, focus);
    expect(summary.total).toBe(1240);
    expect(summary.slices.map((slice) => [slice.owner.key, slice.value, slice.percent])).toEqual([
      [BATCH_A, 1000, 81],
      [NOT_YET, 240, 19],
    ]);
  });

  it("gives this page's figure and percent, and keeps a split delivery whole", () => {
    const { data, focus } = onBatch(BATCH_A);
    const summary = streamSummary(stream("delivery"), data.records, focus);
    expect([summary.mine, summary.minePercent]).toEqual([216, 60]);
    expect(summary.slices.map((slice) => [slice.owner.key, slice.percent])).toEqual([[BATCH_A, 60], [BATCH_B, 40]]);
    expect(summary.slices.reduce((sum, slice) => sum + slice.percent, 0)).toBe(100);
  });

  it("rounds a single record's split like the Table, despite float noise", () => {
    const data = allocationFixture();
    const delivery = data.records.find((record) => record.group === "deliveryTransport")!;
    const tiny = { ...delivery, quantities: [{ value: 0.3, unit: "t·km" as const, label: "Transport" }], parts: [{ ...delivery.parts[0], key: BATCH_A, fraction: 0.125 }, { ...delivery.parts[0], key: BATCH_B, fraction: 0.875 }] };
    const { focus } = onBatch(BATCH_A, { ...data, records: [tiny] });
    const summary = streamSummary(stream("delivery"), [tiny], focus);
    const owners = [...focus.owners, focus.notYet];
    expect(summary.slices.map((slice) => slice.percent)).toEqual(owners.flatMap((owner) => { const p = percentFor(tiny, owner, owners); return p > 0 ? [p] : []; }));
  });

  it("reports zero for a page that carries none of the quantity", () => {
    const { data, focus } = onBatch(BATCH_C);
    const summary = streamSummary(stream("feedstock"), data.records, focus);
    expect([summary.mine, summary.minePercent]).toEqual([0, 0]);
  });

  it("counts records with no recorded figure and leaves them out of the bar", () => {
    const { data, focus } = onBatch(BATCH_A);
    const electricity = streamSummary(stream("electricity"), data.records, focus);
    expect(electricity.undrawn).toBe(1);
    expect(electricity.items.map((item) => item.record.id)).toEqual(["run-1", "run-9"]);
  });

  it("reads Removal parts on a Removal, so a batch split across two Removals never exceeds its record", () => {
    const data = allocationFixture();
    data.removals.push({ id: FOLLOWUP, code: "RM-26-002", status: "draft", creditBatchIds: [BATCH_A] });
    data.records.find((record) => record.id === "dl-1")!.removalParts = [
      { key: REMOVAL_1, fraction: 0.5, basis: [] },
      { key: FOLLOWUP, fraction: 0.3, basis: [] },
      { key: NOT_YET, fraction: 0.2, basis: [] },
    ];
    const focus = buildFocus(data, { removalId: REMOVAL_1 })!;
    const summary = streamSummary(stream("delivery"), data.records, focus);
    expect(summary.slices.map((slice) => [slice.owner.key, slice.value, slice.percent])).toEqual([
      [REMOVAL_1, 180, 50],
      [FOLLOWUP, 108, 30],
      [NOT_YET, 72, 20],
    ]);
    expect(summary.slices.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(summary.total);
  });
});

describe("hintPhrases", () => {
  it("counts partly used deliveries on the batch that carries them", () => {
    const { data, focus } = onBatch(BATCH_A);
    expect(hintPhrases(data.records, focus, batchCodesOf(data))).toEqual(["1 partly used"]);
  });

  it("counts deliveries a batch drew from but another carries", () => {
    const { data, focus } = onBatch(BATCH_B);
    expect(hintPhrases(data.records, focus, batchCodesOf(data))).toEqual(["1 counted on CB-26-001"]);
  });

  it("says nothing when no delivery is hinted", () => {
    const { data, focus } = onBatch(BATCH_C);
    expect(hintPhrases(data.records, focus, batchCodesOf(data))).toEqual([]);
  });
});

describe("a batch with many deliveries", () => {
  it("is still one summary: every delivery in the items, one slice per owner", () => {
    const { data, focus } = onBatch(BATCH_A, manyDeliveriesFixture());
    const summary = streamSummary(stream("feedstock"), data.records, focus);
    expect(summary.items).toHaveLength(MANY_DELIVERIES);
    expect(summary.slices).toHaveLength(2);
  });
});

describe("visibleStreams", () => {
  it("shows manual transport only when an entry records t·km", () => {
    expect(visibleStreams(allocationFixture().records).map((candidate) => candidate.key)).toEqual(["feedstock", "delivery", "diesel", "electricity"]);
    const data = allocationFixture();
    data.records.push({ ...data.records.find((record) => record.id === "me-1")!, id: "me-2", quantities: [{ value: 90, unit: "t·km", label: "Transport" }] });
    expect(visibleStreams(data.records).map((candidate) => candidate.key)).toContain("manual");
  });
});
