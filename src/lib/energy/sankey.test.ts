import { describe, expect, it } from "vitest";
import {
  NAMED_BATCH_LIMIT,
  OTHER_BATCHES_KEY,
  UNASSIGNED_BATCH_KEY,
  groupSankeyBatches,
  layoutSankey,
  sankeyScale,
} from "./sankey";
import type { EnergyCreditBatchInput, EnergyFlow } from "./types";

function batch(index: number): EnergyCreditBatchInput {
  const month = String(index + 1).padStart(2, "0");
  return { id: `b${index}`, code: `CB-${index}`, startDate: `2026-${month}-01`, endDate: `2026-${month}-28`, status: "pending" };
}

function flow(creditBatchId: string | null, kg: number, source: EnergyFlow["source"] = "genset"): EnergyFlow {
  return { source, creditBatchId, day: "2026-09-01", activity: kg, kg };
}

describe("groupSankeyBatches", () => {
  const batches = Array.from({ length: 8 }, (_, i) => batch(i));
  const flows = [...batches.map((b, i) => flow(b.id, (i + 1) * 10)), flow(null, 5)];

  it("names the five largest credit batches and groups the rest", () => {
    const { nodes } = groupSankeyBatches(flows, batches, null);
    const named = nodes.filter((n) => n.code != null);
    expect(named).toHaveLength(NAMED_BATCH_LIMIT);
    expect(named.map((n) => n.key).sort()).toEqual(["b3", "b4", "b5", "b6", "b7"]);
    expect(nodes.find((n) => n.key === OTHER_BATCHES_KEY)?.groupedCount).toBe(3);
    expect(nodes.at(-1)?.key).toBe(UNASSIGNED_BATCH_KEY);
  });

  it("keeps the selected credit batch named within the five", () => {
    const { nodes, flows: mapped } = groupSankeyBatches(flows, batches, "b0");
    const named = nodes.filter((n) => n.code != null).map((n) => n.key);
    expect(named).toHaveLength(NAMED_BATCH_LIMIT);
    expect(named).toContain("b0");
    expect(named).not.toContain("b3");
    expect(nodes.find((n) => n.key === OTHER_BATCHES_KEY)?.groupedCount).toBe(3);
    expect(mapped.find((f) => f.kg === 10)?.batchKey).toBe("b0");
  });

  it("names every batch when there are five or fewer", () => {
    const { nodes } = groupSankeyBatches(flows.slice(0, 5), batches, null);
    expect(nodes.every((n) => n.code != null)).toBe(true);
  });

  it("groups the sixth batch", () => {
    const { nodes } = groupSankeyBatches(flows.slice(0, 6), batches, null);
    expect(nodes.filter((n) => n.code != null)).toHaveLength(NAMED_BATCH_LIMIT);
    expect(nodes.find((n) => n.key === OTHER_BATCHES_KEY)?.groupedCount).toBe(1);
  });
});

describe("layoutSankey", () => {
  it("draws bands that carry every kilogram through both legs", () => {
    const flows = [flow("b0", 30), flow("b0", 20, "feedstockTransport"), flow(null, 10, "grid")];
    const { nodes, flows: mapped } = groupSankeyBatches(flows, [batch(0)], null);
    const keys = nodes.map((n) => n.key);
    const layout = layoutSankey(mapped, keys, sankeyScale(mapped, keys));
    const leg = (name: "toStage" | "toBatch") =>
      layout.links.filter((l) => l.leg === name).reduce((total, l) => total + l.kg, 0);
    expect(leg("toStage")).toBeCloseTo(60);
    expect(leg("toBatch")).toBeCloseTo(60);
    expect(layout.nodes.filter((n) => n.column === "stage").map((n) => n.stage)).toEqual(["production", "transport"]);
  });

  it("keeps bands proportional so they never outgrow the node they meet", () => {
    const flows = [
      flow("b0", 10_000),
      ...Array.from({ length: 6 }, (_, i) => flow(`b${i}`, 0.01, "grid")),
    ];
    const batches = Array.from({ length: 6 }, (_, i) => batch(i));
    const { nodes, flows: mapped } = groupSankeyBatches(flows, batches, null);
    const keys = nodes.map((n) => n.key);
    const scale = sankeyScale(mapped, keys);
    const layout = layoutSankey(mapped, keys, scale);
    for (const link of layout.links) expect(link.h).toBeCloseTo(link.kg * scale);
    const grid = layout.nodes.find((n) => n.source === "grid");
    const gridBands = layout.links
      .filter((l) => l.source === "grid" && l.leg === "toStage")
      .reduce((total, l) => total + l.h, 0);
    expect(grid && gridBands <= grid.h).toBe(true);
  });
});
