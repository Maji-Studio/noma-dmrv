import { describe, expect, it } from "vitest";
import { NOT_YET, type AllocationRecord } from "@/types/emission-allocation";
import { MIN_NODE_H, STREAMS, TARGET_HEIGHT_NARROW, TARGET_HEIGHT_WIDE, buildGraph, ownerPercent, place } from "./allocation-flow-graph";
import { BATCH_A, REMOVAL_1, allocationFixture } from "./allocation-test-fixtures";
import { buildFocus } from "./allocation-model";

const DIESEL = STREAMS.find((stream) => stream.key === "diesel")!;
const TRANSPORT = STREAMS.find((stream) => stream.key === "delivery")!;
const FOLLOWUP = "removal-2";
const WIDE_PX = 1000;
const NARROW_PX = 390;

function splitAcrossTwoRemovals() {
  const data = allocationFixture();
  data.removals.push({ id: FOLLOWUP, code: "RM-26-002", status: "draft", creditBatchIds: [BATCH_A] });
  const delivery = data.records.find((record) => record.id === "dl-1")!;
  delivery.removalParts = [
    { key: REMOVAL_1, fraction: 0.5, basis: [] },
    { key: FOLLOWUP, fraction: 0.3, basis: [] },
    { key: NOT_YET, fraction: 0.2, basis: [] },
  ];
  return { data, delivery };
}

describe("buildGraph on the Removal surface", () => {
  it("draws record to Removal from removalParts, so a batch split across two Removals never exceeds its record", () => {
    const { data, delivery } = splitAcrossTwoRemovals();
    const focus = buildFocus(data, { removalId: REMOVAL_1 })!;
    const graph = buildGraph(TRANSPORT, data.records, focus.owners, focus.notYet);
    const bands = graph.bands.filter((band) => band.from === delivery.id);
    expect(bands.map((band) => [band.to, band.value])).toEqual([[REMOVAL_1, 180], [FOLLOWUP, 108], [NOT_YET, 72]]);
    expect(bands.reduce((sum, band) => sum + band.value, 0)).toBeCloseTo(360);
    // Every node's bands in and out stay within its own value.
    for (const node of graph.nodes) {
      const out = graph.bands.filter((band) => band.from === node.key).reduce((sum, band) => sum + band.value, 0);
      const into = graph.bands.filter((band) => band.to === node.key).reduce((sum, band) => sum + band.value, 0);
      expect(Math.max(out, into)).toBeLessThanOrEqual(node.value + 1e-9);
    }
    const node = graph.nodes.find((candidate) => candidate.key === FOLLOWUP)!;
    expect(ownerPercent(delivery, node, graph)).toBe(30);
  });
});

describe("place", () => {
  it("keeps the chart bounded when a tiny quantity sits next to a huge one", () => {
    const data = allocationFixture();
    const run = (id: string, value: number): AllocationRecord => ({ ...data.records.find((record) => record.id === "run-1")!, id, code: id, quantities: [{ value, unit: "L", label: "Startup diesel" }] });
    data.records = [run("small", 0.1), run("huge", 1000)];
    const focus = buildFocus(data, { creditBatchId: BATCH_A })!;
    const graph = buildGraph(DIESEL, data.records, focus.owners, focus.notYet);
    for (const width of [WIDE_PX, NARROW_PX]) {
      const { height, placed } = place(graph, width);
      const target = width === WIDE_PX ? TARGET_HEIGHT_WIDE : TARGET_HEIGHT_NARROW;
      // The target, plus at most one minimum height per node that is too small to scale.
      expect(height).toBeLessThanOrEqual(target + graph.nodes.length * MIN_NODE_H);
      expect(placed.every((node) => node.h >= MIN_NODE_H)).toBe(true);
    }
  });
});
