import { describe, expect, it } from "vitest";
import type { BatchHealthCheck } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  fallbackBatchHealthFixTarget,
  resolveBatchHealthFixTarget,
} from "@/lib/certification/batch-health-links";

describe("fallbackBatchHealthFixTarget", () => {
  it("routes carbon check failures to labSamples (where lab inputs are entered)", () => {
    expect(fallbackBatchHealthFixTarget("carbon")).toBe("labSamples");
  });

  it("routes production check failures to productionRuns", () => {
    expect(fallbackBatchHealthFixTarget("production")).toBe("productionRuns");
  });

  it("routes transport check failures to deliveryDistances", () => {
    expect(fallbackBatchHealthFixTarget("transport")).toBe("deliveryDistances");
  });

  it("routes entityReadiness check failures to sourceData", () => {
    expect(fallbackBatchHealthFixTarget("entityReadiness")).toBe("sourceData");
  });
});

describe("resolveBatchHealthFixTarget", () => {
  it("uses the shared fallback when the check has no explicit target", () => {
    expect(resolveBatchHealthFixTarget({ key: "carbon" })).toBe("labSamples");
  });

  it("preserves an explicit target", () => {
    expect(
      resolveBatchHealthFixTarget({
        key: "production",
        fixTarget: "applications",
      }),
    ).toBe("applications");
  });
});

describe("batchHealthFixLinkFor", () => {
  const facilityId = "fac-001";

  // The link routing depends only on the check's key + explicit fixTarget, so
  // tests construct just those (matching the function's narrowed input).
  const check = (
    key: BatchHealthCheck["key"],
    fixTarget?: BatchHealthCheck["fixTarget"],
    affectedRecords?: BatchHealthCheck["affectedRecords"],
  ): Pick<BatchHealthCheck, "key" | "fixTarget" | "affectedRecords"> => ({
    key,
    fixTarget,
    affectedRecords,
  });

  it("routes a carbon check with no explicit fixTarget to Lab Samples", () => {
    const link = batchHealthFixLinkFor(
      check("carbon"),
      facilityId,
      "batch-001",
    );
    expect(link.label).toBe("Add Sample data");
    expect(link.href).toBe(
      `/samples?facility=${facilityId}&create=true&createCreditBatch=batch-001`,
    );
  });

  it("routes facility emission blockers to certification emission estimates", () => {
    const link = batchHealthFixLinkFor(
      check("facilityEmissions", "certificationEmissions"),
      facilityId,
    );
    expect(link.label).toBe("Open emission estimates");
    expect(link.href).toBe(
      `/certification/settings?section=emission-estimates&facility=${facilityId}`,
    );
  });

  it("routes an explicit applications fixTarget to the applications page", () => {
    // The noApplications production gap routes here: applications auto-match by
    // crediting period, so there is no manual "link" action to offer.
    const link = batchHealthFixLinkFor(
      check("production", "applications"),
      facilityId,
      "batch-001",
    );
    expect(link.label).toBe("Review applications");
    expect(link.href).toBe(
      `/applications?facility=${facilityId}&creditBatch=batch-001`,
    );
  });

  it("uses 'Edit details' label for an explicit batchDetails fixTarget", () => {
    const link = batchHealthFixLinkFor(
      check("production", "batchDetails"),
      facilityId,
    );
    expect(link.label).toBe("Edit details");
    expect(link.href).toBe("#batch-details");
  });

  it("routes a production check with no fixTarget to productionRuns with the facility", () => {
    const link = batchHealthFixLinkFor(check("production"), facilityId);
    expect(link.href).toBe(`/production-runs?facility=${facilityId}`);
  });

  it("filters a production-run issue to only the affected runs", () => {
    const link = batchHealthFixLinkFor(
      check("entityReadiness", "productionRuns", [
        { id: "run-1", code: "PR-1", missing: ["Electricity"] },
        { id: "run-2", code: "PR-2", missing: ["Meter evidence"] },
      ]),
      facilityId,
      "batch-001",
    );

    expect(link.label).toBe("Fix 2 production runs");
    expect(link.href).toBe(
      `/production-runs?facility=${facilityId}&creditBatch=batch-001&ids=run-1%2Crun-2`,
    );
  });

  it("routes a transport check to deliveries with the facility", () => {
    const link = batchHealthFixLinkFor(
      check("transport"),
      facilityId,
      "batch-001",
    );
    expect(link.href).toBe(
      `/deliveries?facility=${facilityId}&creditBatch=batch-001`,
    );
  });

  it("routes entityReadiness to sourceData within the credit batch", () => {
    const link = batchHealthFixLinkFor(
      check("entityReadiness"),
      facilityId,
      "batch-001",
    );
    expect(link.href).toContain("/production-runs");
    expect(link.href).toContain(facilityId);
    expect(link.href).toContain("creditBatch=batch-001");
  });

  it("routes an explicit biocharProducts fixTarget within the credit batch", () => {
    const link = batchHealthFixLinkFor(
      check("production", "biocharProducts"),
      facilityId,
      "batch-001",
    );
    expect(link.href).toBe(
      `/biochar-products?facility=${facilityId}&creditBatch=batch-001`,
    );
    expect(link.label).toBe("Link production run");
  });

  it("routes an explicit deliveries fixTarget to deliveries with the facility", () => {
    const link = batchHealthFixLinkFor(
      check("transport", "deliveries"),
      facilityId,
      "batch-001",
    );
    expect(link.href).toBe(
      `/deliveries?facility=${facilityId}&creditBatch=batch-001`,
    );
  });

  it("deep-links feedstock transport evidence to the affected feedstock", () => {
    const feedstockId = "11111111-1111-4111-8111-111111111111";
    const link = batchHealthFixLinkFor(
      check("entityReadiness", "feedstocks", [
        {
          id: feedstockId,
          code: "feedstock transport 1",
          missing: ["Transport evidence"],
        },
      ]),
      facilityId,
    );

    expect(link.label).toBe("Review feedstock transport");
    expect(link.href).toBe(
      `/feedstocks?facility=${facilityId}&feedstock=${feedstockId}&mode=edit&focus=transport-evidence`,
    );
  });

  it("deep-links a registry mapping gap to the affected feedstock type", () => {
    const feedstockTypeId = "22222222-2222-4222-8222-222222222222";
    const link = batchHealthFixLinkFor(
      check("feedstockTypeMapping", "feedstockTypes", [
        {
          id: feedstockTypeId,
          code: "Macadamia shells",
          missing: ["Isometric feedstock type"],
        },
      ]),
      facilityId,
    );

    expect(link).toEqual({
      label: "Edit feedstock type",
      href: `/feedstock-types?facility=${facilityId}&feedstockType=${feedstockTypeId}&mode=edit`,
    });
  });

  it("prefers an explicit fixTarget over the fallback", () => {
    // carbon normally falls back to batchDetails, but an explicit override wins.
    const link = batchHealthFixLinkFor(
      check("carbon", "sourceData"),
      facilityId,
    );
    expect(link.href).toContain("/production-runs");
  });

});
