import { describe, expect, it } from "vitest";
import type { RemovalEmptyComponents } from "@/hooks/use-removal-empty-components";
import {
  continueRefusal,
  hasEmptyComponentsStep,
  landingStep,
  openComponentCount,
  stepRows,
} from "./empty-components-state";

const POSITIONS: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };

function line(componentId: string) {
  return { componentId, displayName: componentId, group: "Group", description: null, position: POSITIONS[componentId] ?? 99 };
}
function zero(componentId: string) {
  return {
    id: `zero-${componentId}`, componentId, note: null, authorId: "user-1",
    createdAt: new Date("2026-10-20T10:00:00Z"), displayName: componentId, position: POSITIONS[componentId] ?? 99,
  };
}
function data(batches: Array<{ code: string; lines?: string[]; zeros?: string[] }>, editable = true): RemovalEmptyComponents {
  return {
    removalVersion: 1,
    editable,
    batches: batches.map((batch) => ({
      creditBatchId: `id-${batch.code}`,
      code: batch.code,
      lines: (batch.lines ?? []).map(line),
      zeros: (batch.zeros ?? []).map(zero),
    })),
  } as RemovalEmptyComponents;
}

describe("landingStep", () => {
  it("skips the empty components step when no selected batch has an empty component", () => {
    expect(landingStep(data([{ code: "CB-1" }, { code: "CB-2" }]))).toBe("submit");
  });

  it("lands on the step while any component is unconfirmed, also on a reopened draft", () => {
    expect(landingStep(data([{ code: "CB-1", lines: ["a"] }]))).toBe("empty");
    expect(landingStep(data([{ code: "CB-1", zeros: ["a"] }, { code: "CB-2", lines: ["b"] }]))).toBe("empty");
  });

  it("goes to the submit step once every component is recorded as zero", () => {
    expect(landingStep(data([{ code: "CB-1", zeros: ["a", "b"] }]))).toBe("submit");
  });

  it("goes to the submit step when the Removal can no longer take zeros", () => {
    expect(landingStep(data([{ code: "CB-1", lines: ["a"] }], false))).toBe("submit");
  });

  it("goes to the submit step when the read is unavailable", () => {
    expect(landingStep(null)).toBe("submit");
  });
});

describe("hasEmptyComponentsStep", () => {
  it("keeps the step in the rail while components are empty or recorded, so Undo stays reachable", () => {
    expect(hasEmptyComponentsStep(data([{ code: "CB-1" }]))).toBe(false);
    expect(hasEmptyComponentsStep(data([{ code: "CB-1", lines: ["a"] }]))).toBe(true);
    expect(hasEmptyComponentsStep(data([{ code: "CB-1", zeros: ["a"] }]))).toBe(true);
    // A submitted Removal refuses new zeros and Undo: no step, no way back to it.
    expect(hasEmptyComponentsStep(data([{ code: "CB-1", zeros: ["a"] }], false))).toBe(false);
  });
});

describe("continueRefusal", () => {
  it("names what blocks Continue: the count and the batches", () => {
    const refusal = continueRefusal(
      data([{ code: "CB-1", lines: ["a", "b"] }, { code: "CB-2", lines: ["c"] }, { code: "CB-3", zeros: ["d"] }]),
    );
    expect(refusal.reason).toBe("Record the 3 components with nothing in CB-1 and CB-2 as zero, or add entries.");
    expect(
      continueRefusal(data([{ code: "CB-1", lines: ["a"] }, { code: "CB-2", lines: ["b"] }, { code: "CB-3", lines: ["c"] }])).reason,
    ).toContain("nothing in CB-1, CB-2 and CB-3 as zero");
    expect(refusal.count).toBe(3);
    expect(refusal.firstBatchId).toBe("id-CB-1");
  });

  it("uses the singular for one component", () => {
    expect(continueRefusal(data([{ code: "CB-1", lines: ["a"] }])).reason).toBe(
      "Record the 1 component with nothing in CB-1 as zero, or add entries.",
    );
  });

  it("lets Continue proceed when nothing is open", () => {
    const refusal = continueRefusal(data([{ code: "CB-1", zeros: ["a"] }]));
    expect(refusal.reason).toBeNull();
    expect(openComponentCount(data([{ code: "CB-1", zeros: ["a"] }]))).toBe(0);
  });
});

describe("stepRows", () => {
  it("lists open and recorded components in template order, whatever the order the server returned", () => {
    const batch = data([{ code: "CB-1", lines: ["c", "a"], zeros: ["d", "b"] }]).batches[0];
    expect(stepRows(batch).map((row) => `${row.componentId}:${row.recorded}`)).toEqual([
      "a:false", "b:true", "c:false", "d:true",
    ]);
  });

  it("keeps the same order before and after the components are recorded", () => {
    const open = stepRows(data([{ code: "CB-1", lines: ["a", "b", "c"] }]).batches[0]);
    // The writer returns recorded zeros in entry order, not template order.
    const confirmed = stepRows(data([{ code: "CB-1", zeros: ["c", "a", "b"] }]).batches[0]);
    expect(confirmed.map((row) => row.componentId)).toEqual(open.map((row) => row.componentId));
  });
});
