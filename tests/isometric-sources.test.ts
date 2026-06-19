/**
 * Phase 3.5 — pure-logic tests.
 *
 * Covers the deterministic supplier_reference_id builder, the datapoint
 * transformer's source_ids plumbing, and the supersede-on-sources-change
 * payload-hash contract.
 *
 * Mirror-flow integration tests (POST /sources / signed_upload_url /
 * reconciliation branches) require DB + Isometric client mocking; they are
 * deferred to a follow-up integration suite. The full reconciliation
 * decision matrix is already covered for the Removal flow by
 * `isometric-submission-claim.test.ts` — Sources reuse the same
 * (provider, document_id) UNIQUE + supplier_reference_id pattern, so the
 * critical recovery cases the parent plan calls out
 * (GET found → signed_upload_url 200 → PUT → insert; GET found →
 * signed_upload_url 409 → insert) are tracked as a follow-up integration
 * test in docs/open-questions.md under `isometric/sources-integration-tests`.
 */
import { describe, expect, it } from "vitest";
import type { components } from "@/lib/isometric/generated/certify";
import { buildCreateDatapointRequest } from "@/lib/isometric/transformers/datapoint";
import { buildSourceSupplierRef } from "@/lib/isometric/utils/source-ref";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";

type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type GhgEntryTemplateComponentInput =
  components["schemas"]["GhgEntryTemplateComponentInput"];

const PROJECT_ID = "prj_TEST";
const SUPPLIER_REF = "nm-rmv-abc-dp-x-v1";
const DOCUMENT_ID_A = "11111111-1111-1111-1111-111111111111";
const DOCUMENT_ID_B = "22222222-2222-2222-2222-222222222222";

const baseAgg: AggregatedProductionData = {
  weightedOrganicCarbonPercent: 80,
  weightedHToCorgRatio: 0.4,
  weightedOToCorgRatio: 0.2,
  weightedAshPercent: 5,
  weightedMoisturePercent: 10,
  totalBiocharDryMassKg: 1000,
  totalFeedstockDryMassKg: 4000,
  totalStartupDieselLitres: 50,
  totalGensetDieselLitres: 20,
  totalElectricityKwh: 200,
  feedstockTransportMassDistanceTonneKm: 50,
  biocharTransportMassDistanceTonneKm: 100,
  sampleTransportMassDistanceTonneKm: 12,
  biomassElectricityKwh: 40,
  pyrolysisElectricityKwh: 130,
  biocharElectricityKwh: 30,
  biomassGensetKwh: 13.5,
  pyrolysisGensetKwh: 43.875,
  biocharGensetKwh: 6.975,
  earliestStartTime: new Date("2026-01-01T00:00:00Z"),
  latestEndTime: new Date("2026-01-31T23:59:59Z"),
  sourceProductionRunIds: ["pr_1", "pr_2"],
  warnings: [],
};

function blueprintInput(
  overrides: Partial<ComponentBlueprintInput> = {},
): ComponentBlueprintInput {
  return {
    compatible_unit: "kg",
    data_shape: "SCALAR",
    description: "product mass",
    input_key: "product_mass",
    quantity_kind: "mass",
    ...overrides,
  };
}

function rtcInput(
  overrides: Partial<GhgEntryTemplateComponentInput> = {},
): GhgEntryTemplateComponentInput {
  return {
    datapoint_id: null,
    display_name: "Product mass",
    input_key: "product_mass",
    quantity_kind: "mass",
    type: "monitored",
    ...overrides,
  };
}

describe("buildSourceSupplierRef", () => {
  it("is deterministic for the same document id", () => {
    expect(buildSourceSupplierRef(DOCUMENT_ID_A)).toBe(
      buildSourceSupplierRef(DOCUMENT_ID_A),
    );
  });

  it("differs across distinct document ids", () => {
    expect(buildSourceSupplierRef(DOCUMENT_ID_A)).not.toBe(
      buildSourceSupplierRef(DOCUMENT_ID_B),
    );
  });

  it("starts with the documented nm-src- prefix", () => {
    expect(buildSourceSupplierRef(DOCUMENT_ID_A)).toMatch(/^nm-src-/);
  });

  it("embeds the full document UUID — no truncation", () => {
    expect(buildSourceSupplierRef(DOCUMENT_ID_A)).toContain(DOCUMENT_ID_A);
  });

  it("stays under Isometric's 100-char supplier_reference_id cap", () => {
    expect(buildSourceSupplierRef(DOCUMENT_ID_A).length).toBeLessThanOrEqual(
      100,
    );
  });
});

describe("buildCreateDatapointRequest source_ids plumbing", () => {
  it("defaults to [] when sourceIds is omitted (Phase 3.4 behavior preserved)", () => {
    const result = buildCreateDatapointRequest({
      groupKey: "co2-stored",
      componentBlueprintKey: "carbon_rich_substance_sequestration",
      rtcInput: rtcInput(),
      blueprintInput: blueprintInput(),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });
    expect(result.source_ids).toEqual([]);
  });

  it("propagates the supplied sourceIds verbatim onto source_ids", () => {
    const ids = ["src_a", "src_b", "src_c"];
    const result = buildCreateDatapointRequest({
      groupKey: "co2-stored",
      componentBlueprintKey: "carbon_rich_substance_sequestration",
      rtcInput: rtcInput(),
      blueprintInput: blueprintInput(),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
      sourceIds: ids,
    });
    expect(result.source_ids).toEqual(ids);
  });

  it("treats an empty array the same as omitted", () => {
    const result = buildCreateDatapointRequest({
      groupKey: "co2-stored",
      componentBlueprintKey: "carbon_rich_substance_sequestration",
      rtcInput: rtcInput(),
      blueprintInput: blueprintInput(),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
      sourceIds: [],
    });
    expect(result.source_ids).toEqual([]);
  });
});

describe("payloadHash sensitivity to sourceIds — supersede contract", () => {
  // The Removal `semanticPayload` includes a `sourceIds: string[]` field
  // (submit-removal.ts). Phase 3.5's correctness contract: a mirror or
  // unmirror MUST change the hash so the next submit supersedes the
  // previous version. These tests pin the hash sensitivity at the unit
  // level so a regression that drops `sourceIds` from the hash is caught
  // before the integration suite.
  const base = {
    removalId: "removal-1",
    templateId: "rt_1",
    sourceProductionRunIds: ["pr_1", "pr_2"],
    startedOn: "2026-01-01T00:00:00.000Z",
    completedOn: "2026-01-31T23:59:59.000Z",
    inputs: [{ rtcId: "c1", inputKey: "k", kind: "monitored", value: 1, unit: "kg", datapointType: "REPORTED" }],
  };

  it("the same sourceIds list yields the same hash", () => {
    const a = payloadHash({ ...base, sourceIds: ["src_1", "src_2"] });
    const b = payloadHash({ ...base, sourceIds: ["src_1", "src_2"] });
    expect(a).toBe(b);
  });

  it("a mirror-added source changes the hash (supersede triggers)", () => {
    const before = payloadHash({ ...base, sourceIds: ["src_1"] });
    const after = payloadHash({ ...base, sourceIds: ["src_1", "src_2"] });
    expect(after).not.toBe(before);
  });

  it("an unmirror changes the hash (supersede triggers)", () => {
    const before = payloadHash({ ...base, sourceIds: ["src_1", "src_2"] });
    const after = payloadHash({ ...base, sourceIds: ["src_1"] });
    expect(after).not.toBe(before);
  });

  it("an empty sourceIds list produces a different hash than no field at all", () => {
    // submit-removal.ts always sets `sourceIds: [...]`; this asserts that
    // the canonical-JSON serializer distinguishes "missing key" from
    // "key with empty array", so a deploy that accidentally omits the
    // key drives a supersede instead of silently colliding.
    const withEmpty = payloadHash({ ...base, sourceIds: [] });
    const withoutKey = payloadHash(base);
    expect(withEmpty).not.toBe(withoutKey);
  });

  it("sourceIds order matters in the hash (caller is expected to sort)", () => {
    // submit-removal.ts sorts sourceIds via Array.sort() before hashing.
    // This test pins that the hasher itself is sensitive to order, so the
    // caller-side sort is doing real work — a regression that drops the
    // sort would produce non-deterministic hashes across operators.
    const a = payloadHash({ ...base, sourceIds: ["src_1", "src_2"] });
    const b = payloadHash({ ...base, sourceIds: ["src_2", "src_1"] });
    expect(a).not.toBe(b);
  });
});
