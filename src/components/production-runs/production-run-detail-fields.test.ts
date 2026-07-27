import { describe, expect, it } from "vitest";
import {
  buildProductionRunFeedstockDetailField,
  buildProductionRunReadingsDetailField,
  buildProductionRunWindowDetailFields,
  productionRunStatusCertStatus,
  productionRunTelemetryCertification,
} from "./production-run-detail-fields";

const FACILITIES = [
  { id: "facility-a", timezone: "Africa/Dar_es_Salaam" },
] as const;

describe("production run detail certification fields", () => {
  it("shows the linked feedstock batches with their feedstock types", () => {
    expect(
      buildProductionRunFeedstockDetailField([
        {
          feedstockCode: "FS-26-901",
          feedstockTypeName: "Wood chips",
        },
        {
          feedstockCode: "FS-26-902",
          feedstockTypeName: "Wood chips",
        },
      ]),
    ).toEqual({
      label: "Feedstock",
      value: "Wood chips (FS-26-901), Wood chips (FS-26-902)",
    });
  });

  it("requires the saved run status to be complete", () => {
    expect(productionRunStatusCertStatus("complete")).toBe("satisfied");
    expect(productionRunStatusCertStatus("running")).toBe("missing");
    expect(productionRunStatusCertStatus("failed")).toBe("missing");
  });

  it("derives the readings status from saved reading rows", () => {
    expect(buildProductionRunReadingsDetailField("complete", 2)).toMatchObject({
      label: "Readings CSV",
      value: "2 saved readings",
      certifyRequired: true,
      certifyStatus: "satisfied",
    });
    expect(buildProductionRunReadingsDetailField("draft", 0)).toMatchObject({
      value: null,
      certifyRequired: true,
      certifyStatus: "missing",
    });
  });

  it.each(["failed", "cancelled"] as const)(
    "does not require telemetry for a %s audit record",
    (status) => {
      expect(productionRunTelemetryCertification(status, 0)).toEqual({
        certifyRequired: false,
        certifyStatus: "neutral",
      });
      expect(buildProductionRunReadingsDetailField(status, 0)).toMatchObject({
        certifyRequired: false,
        certifyStatus: "neutral",
      });
    },
  );

  it("keeps unsaved telemetry neutral for a certification candidate", () => {
    expect(productionRunTelemetryCertification("draft", 0, false)).toEqual({
      certifyRequired: true,
      certifyStatus: "neutral",
    });
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
        value: "Facility time — Africa/Dar es Salaam",
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
      value: "Facility time unknown — using UTC",
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
      value: "Facility time — America/New York",
    });
  });
});
