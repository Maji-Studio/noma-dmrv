import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { zeroSourceAmounts } from "@/lib/energy/sources";
import type { EnergyRecord } from "@/lib/energy/types";
import { EnergyRecordBreakdown } from "./energy-record-breakdown";

function runRecord(): EnergyRecord {
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
      gaps: {
        grid: { missing: 1, of: 1, unit: "run", recorded: false },
        // One feedstock drawn by a scalable and an unscalable run: ids dedupe
        // to 1 of 1 missing, but a share was recorded and must stay visible.
        feedstockTransport: { missing: 1, of: 1, unit: "feedstock", recorded: true },
      },
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
    const rendered = text(runRecord());
    expect(rendered).toContain(MISSING_VALUE.notRecorded);
    expect(rendered).not.toContain("0 kWh");
  });

  it("shows no CO2e", () => {
    expect(text(runRecord())).not.toMatch(/CO₂e|CO2e/);
  });

  it("keeps a recorded source's figures", () => {
    expect(text(runRecord())).toContain("40 L");
  });

  it("keeps a recorded share when the same feedstock also counts as missing", () => {
    const rendered = text(runRecord());
    expect(rendered).toContain("12 t·km");
    expect(rendered).toContain("Not recorded on 1 of 1 feedstock");
    expect(rendered.match(/"Not recorded"/g)).toHaveLength(1);
  });
});
