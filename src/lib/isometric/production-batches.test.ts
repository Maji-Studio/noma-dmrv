import { describe, expect, it } from "vitest";
import { formatFacilityDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import {
  buildCreateProductionBatchRequest,
  buildProductionBatchReference,
  PRODUCTION_BATCH_KIND,
  PRODUCTION_BATCH_MASS_UNIT,
  productionBatchMassUnitsMatch,
} from "./production-batches";

const BASE = {
  creditBatchCode: "CB-2026-001",
  externalFacilityId: "fcl_1G8QT5ZAB1S0XSDW",
  feedstockTypeIds: ["ftt_1D7KZ1P761S0G7BN"],
  startedAt: "2026-03-01T07:15:00.000Z",
  endedAt: "2026-03-28T18:45:00.000Z",
  totalDryMassKg: 12_345.678,
  supplierReferenceId: "nm-ptb-abc123def456",
};

describe("buildProductionBatchReference", () => {
  it("is stable per credit batch and namespaced away from other refs", () => {
    const first = buildProductionBatchReference({ creditBatchId: "cb-1" });
    const second = buildProductionBatchReference({ creditBatchId: "cb-1" });
    expect(first).toBe(second);
    expect(first.startsWith("nm-ptb-")).toBe(true);
    expect(first).not.toBe(
      buildProductionBatchReference({ creditBatchId: "cb-2" }),
    );
  });
});

describe("productionBatchMassUnitsMatch", () => {
  it("accepts Isometric's canonical kilogram readback", () => {
    expect(productionBatchMassUnitsMatch("kilogram", "kg")).toBe(true);
  });

  it("does not convert a different mass unit", () => {
    expect(productionBatchMassUnitsMatch("gram", "kg")).toBe(false);
  });
});

describe("buildCreateProductionBatchRequest", () => {
  it("submits the total dry mass in kilograms with no standard deviation", () => {
    const body = buildCreateProductionBatchRequest(BASE);
    expect(body.mass).toEqual({
      magnitude: 12_345.678,
      unit: PRODUCTION_BATCH_MASS_UNIT,
    });
    // Requirement: omit the spread rather than fabricate one.
    expect("standard_deviation" in body.mass).toBe(false);
    expect(body.kind).toBe(PRODUCTION_BATCH_KIND);
  });

  it("maps facility, feedstock types, reference and the date-only window", () => {
    const body = buildCreateProductionBatchRequest({
      ...BASE,
      feedstockTypeIds: ["ftt_b", "ftt_a", "ftt_b"],
    });
    expect(body.facility_id).toBe(BASE.externalFacilityId);
    expect(body.feedstock_type_ids).toEqual(["ftt_a", "ftt_b"]);
    expect(body.supplier_reference_id).toBe(BASE.supplierReferenceId);
    expect(body.display_name).toBe(BASE.creditBatchCode);
    expect(body.started_at).toBe(BASE.startedAt);
    expect(body.ended_at).toBe(BASE.endedAt);
  });

  it.each([
    {
      timeZone: "Europe/Zurich",
      startedAt: "2026-07-31T22:15:00.000Z",
      endedAt: "2026-08-31T19:45:00.000Z",
    },
    {
      timeZone: "America/Los_Angeles",
      startedAt: "2026-08-01T07:15:00.000Z",
      endedAt: "2026-09-01T05:45:00.000Z",
    },
  ])(
    "keeps the physical August production window in $timeZone",
    ({ timeZone, startedAt, endedAt }) => {
      const body = buildCreateProductionBatchRequest({
        ...BASE,
        startedAt,
        endedAt,
      });

      expect(formatFacilityDate(new Date(body.started_at), timeZone)).toBe(
        "2026-08-01",
      );
      expect(formatFacilityDate(new Date(body.ended_at), timeZone)).toBe(
        "2026-08-31",
      );
    },
  );

  it("keeps a same-day batch as a non-zero physical window", () => {
    const body = buildCreateProductionBatchRequest({
      ...BASE,
      startedAt: "2026-08-31T06:00:00.000Z",
      endedAt: "2026-08-31T14:00:00.000Z",
    });

    expect(Date.parse(body.ended_at)).toBeGreaterThan(
      Date.parse(body.started_at),
    );
  });

  it("omits the display name when the credit-batch code is blank", () => {
    const body = buildCreateProductionBatchRequest({
      ...BASE,
      creditBatchCode: "   ",
    });
    expect("display_name" in body).toBe(false);
  });

  it("truncates the display name to the registry's 100-char limit", () => {
    const body = buildCreateProductionBatchRequest({
      ...BASE,
      creditBatchCode: "C".repeat(140),
    });
    expect(body.display_name).toHaveLength(100);
  });

  it("is deterministic for the same inputs", () => {
    expect(buildCreateProductionBatchRequest(BASE)).toEqual(
      buildCreateProductionBatchRequest({
        ...BASE,
        feedstockTypeIds: [...BASE.feedstockTypeIds],
      }),
    );
  });

  it.each([
    ["no Isometric facility id", { externalFacilityId: "" }],
    ["no mapped feedstock type", { feedstockTypeIds: [] }],
    ["a malformed timestamp", { startedAt: "not-a-date" }],
    [
      "an inverted window",
      {
        startedAt: "2026-03-28T12:00:00.000Z",
        endedAt: "2026-03-01T12:00:00.000Z",
      },
    ],
    [
      "a zero-length window",
      {
        startedAt: "2026-03-28T12:00:00.000Z",
        endedAt: "2026-03-28T12:00:00.000Z",
      },
    ],
    ["no recorded dry mass", { totalDryMassKg: 0 }],
    ["a negative dry mass", { totalDryMassKg: -1 }],
    ["a non-finite dry mass", { totalDryMassKg: Number.NaN }],
  ])("refuses %s", (_label, patch) => {
    expect(() =>
      buildCreateProductionBatchRequest({ ...BASE, ...patch }),
    ).toThrow(SafeError);
  });
});
