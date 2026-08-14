import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  FEEDSTOCK_WET_INPUT_HINT,
  summarizeFeedstockWetInput,
} from "./production-run-feedstock-input";

describe("summarizeFeedstockWetInput", () => {
  it("does not claim a zero total once a bin is picked but not weighed", () => {
    const summary = summarizeFeedstockWetInput([
      { storageLocationId: "bin-1", wetMassKg: undefined },
    ]);

    expect(summary.totalWetMassKg).toBeNull();
    expect(summary.valueText).toBe(MISSING_VALUE.notRecorded);
    expect(summary.valueText).not.toContain("0 kg");
    // The "from n bins" suffix is suppressed with the value, per the hero KPI
    // band's rule that a placeholder never carries a unit or a qualifier.
    expect(summary.valueText).not.toContain("bin");
    expect(summary.hintText).toBe(FEEDSTOCK_WET_INPUT_HINT);
    expect(summary.visible).toBe(true);
    expect(summary.binCount).toBe(1);
  });

  it("formats a known total with its bin count and no hint", () => {
    const summary = summarizeFeedstockWetInput([
      { storageLocationId: "bin-1", wetMassKg: 800 },
      { storageLocationId: "bin-2", wetMassKg: 400.5 },
    ]);

    expect(summary.totalWetMassKg).toBe(1200.5);
    expect(summary.valueText).toBe("1,200.5 kg from 2 bins");
    expect(summary.hintText).toBeNull();
  });

  it("uses the singular noun for one bin", () => {
    const summary = summarizeFeedstockWetInput([
      { storageLocationId: "bin-1", wetMassKg: 250 },
    ]);

    expect(summary.valueText).toBe("250 kg from 1 bin");
  });

  it("counts only the rows that carry a total, ignoring blank rows", () => {
    const summary = summarizeFeedstockWetInput([
      { storageLocationId: "bin-1", wetMassKg: 100 },
      { storageLocationId: "", wetMassKg: undefined },
    ]);

    expect(summary.valueText).toBe("100 kg from 1 bin");
  });

  it("stays hidden until the operator has picked a bin or entered a mass", () => {
    expect(summarizeFeedstockWetInput([]).visible).toBe(false);
    expect(
      summarizeFeedstockWetInput([{ storageLocationId: "", wetMassKg: undefined }])
        .visible,
    ).toBe(false);
  });

  it("reports a real measured zero rather than the placeholder", () => {
    const summary = summarizeFeedstockWetInput([
      { storageLocationId: "bin-1", wetMassKg: 0 },
    ]);

    expect(summary.totalWetMassKg).toBe(0);
    expect(summary.valueText).toBe("0 kg from 1 bin");
    expect(summary.hintText).toBeNull();
  });
});
