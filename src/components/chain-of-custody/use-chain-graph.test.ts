import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { reachableNodeIds } from "./use-chain-graph";

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("reachableNodeIds", () => {
  it("walks connected lineage through direction changes", () => {
    const result = reachableNodeIds("A", [
      edge("A", "B"),
      edge("C", "B"),
      edge("C", "D"),
    ]);

    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("keeps an isolated focused node focused", () => {
    expect(reachableNodeIds("solo", [])).toEqual(new Set(["solo"]));
  });
});
