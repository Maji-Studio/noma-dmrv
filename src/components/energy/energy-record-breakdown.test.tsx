import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { zeroSourceAmounts } from "@/lib/energy/sources";
import type { EnergyRecord } from "@/lib/energy/types";
import { EnergyRecordBreakdown } from "./energy-record-breakdown";

function runRecord(withFactors: boolean): EnergyRecord {
  const activity = { ...zeroSourceAmounts(), startup: 40, genset: 20, preprocessing: 30, feedstockTransport: 12 };
  return {
    id: "run",
    scope: "run",
    code: "PR-1",
    context: null,
    day: "2026-09-01",
    endDay: null,
    creditBatchIds: [],
    footprint: {
      activity,
      kg: withFactors ? { ...zeroSourceAmounts(), startup: 107, genset: 54, preprocessing: 80, feedstockTransport: 2 } : null,
      gaps: { grid: { missing: 1, of: 1, unit: "run" } },
    },
    runCount: 1,
    deliveryCount: 0,
    dryMassKg: null,
  };
}

function text(record: EnergyRecord): string {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<EnergyRecordBreakdown record={record} />);
  });
  return JSON.stringify(renderer?.toJSON());
}

describe("EnergyRecordBreakdown", () => {
  it("shows a source with every reading missing as not recorded, never a zero", () => {
    for (const withFactors of [true, false]) {
      const rendered = text(runRecord(withFactors));
      expect(rendered).toContain(MISSING_VALUE.notRecorded);
      expect(rendered).not.toContain("0 kWh");
      expect(rendered).not.toMatch(/est\. 0 kg/);
    }
  });

  it("keeps a recorded source's figures", () => {
    expect(text(runRecord(false))).toContain("40 L");
  });
});
