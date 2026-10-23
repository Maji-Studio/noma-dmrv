// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  buildProductionRunFeedstockDetailField,
  buildProductionRunWindowDetailFields,
  productionRunStatusCertStatus,
  summarizeProductionRunFeedstocks,
} from "./production-run-detail-fields";

type Intake = {
  feedstockCode: string | null;
  feedstockTypeName: string | null;
};
const withMass = (intakes: Intake[]) =>
  intakes.map((intake) => ({ ...intake, wetMassUsedKg: 50 }));
const textOf = (node: ReactNode) =>
  render(<>{node}</>).container.textContent;
const feedstockText = (intakes: Intake[]) =>
  textOf(buildProductionRunFeedstockDetailField(withMass(intakes)).value);

const FACILITIES = [
  { id: "facility-a", timezone: "Africa/Dar_es_Salaam" },
] as const;

describe("production run detail certification fields", () => {
  it("names a single intake by its code", () => {
    expect(
      feedstockText([
        { feedstockCode: "FS-26-901", feedstockTypeName: "Wood chips" },
      ]),
    ).toBe("Wood chips (FS-26-901)");
  });

  it("summarises many intakes of one type as a count and code range", () => {
    // One draw from a long-lived bin is allocated across all its intakes,
    // returned in no particular order (#1403).
    const codes = ["FS-26-123", "FS-26-021", "FS-26-1000", "FS-26-076"];
    const feedstocks = codes.map((feedstockCode) => ({
      feedstockCode,
      feedstockTypeName: "Pine Off-cuts",
    }));
    expect(summarizeProductionRunFeedstocks(feedstocks)).toEqual([
      {
        typeName: "Pine Off-cuts",
        intakeCount: 4,
        codeRange: ["FS-26-021", "FS-26-1000"],
      },
    ]);
    expect(feedstockText(feedstocks)).toBe(
      "Pine Off-cuts (4 intakes between FS-26-021 and FS-26-1000)",
    );
  });

  it("keeps each code on one line", () => {
    const field = buildProductionRunFeedstockDetailField(
      withMass([
        { feedstockCode: "FS-26-001", feedstockTypeName: "Pine Off-cuts" },
        { feedstockCode: "FS-26-002", feedstockTypeName: "Pine Off-cuts" },
      ]),
    );
    const codes = render(<>{field.value}</>).container.querySelectorAll(
      ".whitespace-nowrap",
    );
    expect([...codes].map((code) => code.textContent)).toEqual([
      "FS-26-001",
      "FS-26-002",
    ]);
  });

  it("lists the intakes behind the summary, by code, with the wet mass each gave", () => {
    const field = buildProductionRunFeedstockDetailField([
      { feedstockCode: "FS-26-010", feedstockTypeName: "Pine Off-cuts", wetMassUsedKg: 1200 },
      { feedstockCode: "FS-26-002", feedstockTypeName: "Pine Off-cuts", wetMassUsedKg: 800 },
      { feedstockCode: null, feedstockTypeName: "Pine Off-cuts", wetMassUsedKg: 5 },
    ]);
    expect(field.explanationTitle).toBe("Feedstock intakes");
    const text = textOf(field.explanation);
    expect(text).toMatch(/FS-26-002800 kg.*FS-26-0101,200 kg/);
  });

  it("gives each feedstock type its own entry, sorted by name", () => {
    expect(
      feedstockText([
        { feedstockCode: "FS-26-003", feedstockTypeName: "Wood chips" },
        { feedstockCode: "FS-26-002", feedstockTypeName: "Pine Off-cuts" },
        { feedstockCode: "FS-26-001", feedstockTypeName: "Pine Off-cuts" },
      ]),
    ).toBe(
      "Pine Off-cuts (2 intakes between FS-26-001 and FS-26-002), Wood chips (FS-26-003)",
    );
  });

  it("keeps intakes whose type or code is missing", () => {
    expect(
      feedstockText([
        { feedstockCode: null, feedstockTypeName: "Rice husk" },
        { feedstockCode: null, feedstockTypeName: "Rice husk" },
        { feedstockCode: "FS-26-010", feedstockTypeName: null },
        { feedstockCode: null, feedstockTypeName: null },
      ]),
    ).toBe("FS-26-010, Rice husk (2 intakes)");
  });

  it("is empty without linked intakes", () => {
    expect(buildProductionRunFeedstockDetailField([])).toEqual({
      label: "Feedstock",
      value: null,
    });
  });

  it("requires the saved run status to be complete", () => {
    expect(productionRunStatusCertStatus("complete")).toBe("satisfied");
    expect(productionRunStatusCertStatus("running")).toBe("missing");
    expect(productionRunStatusCertStatus("failed")).toBe("missing");
  });

});

describe("buildProductionRunWindowDetailFields", () => {
  it("reads the window back in the facility zone, not the viewer's", () => {
    // Entered as 08:00–16:00 at a UTC+3 plant, so stored 05:00Z–13:00Z. A
    // browser-zone read-out would show 07:00–15:00 on CEST.
    expect(
      buildProductionRunWindowDetailFields(
        {
          facilityId: "facility-a",
          startTime: new Date("2026-07-17T05:00:00.000Z"),
          endTime: new Date("2026-07-17T13:00:00.000Z"),
        },
        FACILITIES,
      ),
    ).toEqual([
      { label: "Start date", value: "Jul 17, 2026" },
      { label: "Start time", value: "08:00" },
      { label: "End date", value: "Jul 17, 2026" },
      { label: "End time", value: "16:00" },
      {
        label: "Time zone",
        value: "Facility time: Africa/Dar es Salaam",
      },
    ]);
  });

  it("keeps a near-midnight run on the facility's calendar day", () => {
    // 01:00 on Jul 17 at a UTC+3 plant is 22:00Z on Jul 16 — the day the
    // browser-zone read-out used to report.
    const fields = buildProductionRunWindowDetailFields(
      {
        facilityId: "facility-a",
        startTime: new Date("2026-07-16T22:00:00.000Z"),
        endTime: null,
      },
      FACILITIES,
    );

    expect(fields[0]).toEqual({ label: "Start date", value: "Jul 17, 2026" });
    expect(fields[1]).toEqual({ label: "Start time", value: "01:00" });
    expect(fields[2]).toEqual({ label: "End date", value: null });
    expect(fields[3]).toEqual({ label: "End time", value: null });
  });

  it("states the fallback zone when the facility is not in context", () => {
    const fields = buildProductionRunWindowDetailFields(
      {
        facilityId: "facility-z",
        startTime: new Date("2026-07-17T05:00:00.000Z"),
        endTime: null,
      },
      FACILITIES,
    );

    expect(fields[1]).toEqual({ label: "Start time", value: "05:00" });
    expect(fields[4]).toEqual({
      label: "Time zone",
      value: "Facility time is not set. Using UTC.",
    });
  });

  it("uses one truthful zone label for a window crossing a DST transition", () => {
    const fields = buildProductionRunWindowDetailFields(
      {
        facilityId: "facility-ny",
        startTime: new Date("2026-03-08T06:30:00.000Z"),
        endTime: new Date("2026-03-08T07:30:00.000Z"),
      },
      [
        ...FACILITIES,
        { id: "facility-ny", timezone: "America/New_York" },
      ],
    );

    expect(fields[1]).toEqual({ label: "Start time", value: "01:30" });
    expect(fields[3]).toEqual({ label: "End time", value: "03:30" });
    expect(fields[4]).toEqual({
      label: "Time zone",
      value: "Facility time: America/New York",
    });
  });
});
