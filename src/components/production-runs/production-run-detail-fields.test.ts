import { describe, expect, it } from "vitest";
import {
  buildProductionRunFeedstockDetailField,
  buildProductionRunReadingsDetailField,
  productionRunStatusCertStatus,
  productionRunTelemetryCertification,
} from "./production-run-detail-fields";

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
