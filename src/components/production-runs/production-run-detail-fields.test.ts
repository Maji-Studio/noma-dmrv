import { describe, expect, it } from "vitest";
import {
  buildProductionRunReadingsDetailField,
  productionRunStatusCertStatus,
} from "./production-run-detail-fields";

describe("production run detail certification fields", () => {
  it("requires the saved run status to be complete", () => {
    expect(productionRunStatusCertStatus("complete")).toBe("satisfied");
    expect(productionRunStatusCertStatus("running")).toBe("missing");
    expect(productionRunStatusCertStatus("failed")).toBe("missing");
  });

  it("derives the readings status from saved reading rows", () => {
    expect(buildProductionRunReadingsDetailField(2)).toMatchObject({
      label: "Readings CSV",
      value: "2 saved readings",
      certifyRequired: true,
      certifyStatus: "satisfied",
    });
    expect(buildProductionRunReadingsDetailField(0)).toMatchObject({
      value: null,
      certifyRequired: true,
      certifyStatus: "missing",
    });
  });
});
