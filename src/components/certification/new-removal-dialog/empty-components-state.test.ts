import { describe, expect, it } from "vitest";
import type { RemovalEmptyComponents } from "@/hooks/use-removal-empty-components";
import {
  continueRefusal,
  hasEmptyComponentsStep,
  landingStep,
  openComponentCount,
} from "./empty-components-state";

function line(componentId: string) {
  return { componentId, displayName: componentId, group: "Group", description: null };
}
function zero(componentId: string) {
  return {
    id: `zero-${componentId}`, componentId, note: null, authorId: "user-1",
    createdAt: new Date("2026-10-20T10:00:00Z"), displayName: componentId,
  };
}
function data(batches: Array<{ code: string; lines?: string[]; zeros?: string[] }>): RemovalEmptyComponents {
  return {
    removalVersion: 1,
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

  it("goes to the submit step when the read is unavailable", () => {
    expect(landingStep(null)).toBe("submit");
  });
});

describe("hasEmptyComponentsStep", () => {
  it("keeps the step in the rail while components are empty or recorded, so Undo stays reachable", () => {
    expect(hasEmptyComponentsStep(data([{ code: "CB-1" }]))).toBe(false);
    expect(hasEmptyComponentsStep(data([{ code: "CB-1", lines: ["a"] }]))).toBe(true);
    expect(hasEmptyComponentsStep(data([{ code: "CB-1", zeros: ["a"] }]))).toBe(true);
  });
});

describe("continueRefusal", () => {
  it("names what blocks Continue: the count and the batches", () => {
    const refusal = continueRefusal(
      data([{ code: "CB-1", lines: ["a", "b"] }, { code: "CB-2", lines: ["c"] }, { code: "CB-3", zeros: ["d"] }]),
    );
    expect(refusal.reason).toBe("Record the 3 components with nothing in CB-1 and CB-2 as zero, or add entries.");
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
