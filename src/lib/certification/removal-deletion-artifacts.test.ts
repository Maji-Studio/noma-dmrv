import { describe, expect, it } from "vitest";
import { removalOwnedMeasurements } from "./removal-deletion-artifacts";
import { buildMeasurementSampleReference } from "@/lib/isometric/measurement-samples";

function row(version = 1) {
  const reference = buildMeasurementSampleReference({ removalId: "removal", version,
    role: "production-batch", creditBatchId: "batch", sampleId: "sample" });
  return { id: `submission-${version}`, version, metadata: {}, payloadSnapshot: {
    durabilityMeasurementSamples: { submissions: [{ creditBatchId: "batch", sampleId: "sample",
      supplierRefId: reference, body: { supplier_reference_id: reference } }] },
    journaled: { measurementSamples: [{ supplierReferenceId: reference, measurementSampleId: `mts_${version}` }] },
  } };
}

describe("Removal measurement ownership", () => {
  it("keeps ownership exact across immutable versions", () => {
    expect(removalOwnedMeasurements("removal", [row(1), row(2)]).map((item) => [item.submissionId, item.externalId]))
      .toEqual([["submission-1", "mts_1"], ["submission-2", "mts_2"]]);
  });
  it("includes unjournaled POST intents for reconciliation", () => {
    const value = row();
    value.payloadSnapshot.journaled.measurementSamples = [];
    expect(removalOwnedMeasurements("removal", [value])[0].externalId).toBeNull();
  });
  it("accepts legacy snapshots with no measurements", () => {
    for (const payloadSnapshot of [null, {}, { sourceBindingPlan: [] }]) {
      expect(removalOwnedMeasurements("removal", [{ id: "s", version: 1, metadata: null, payloadSnapshot }])).toEqual([]);
    }
  });
  it("reads the metadata measurement journal as well as the immutable journal", () => {
    const value = row();
    value.metadata = { measurementSamples: value.payloadSnapshot.journaled.measurementSamples };
    value.payloadSnapshot.journaled.measurementSamples = [];
    expect(removalOwnedMeasurements("removal", [value])[0].externalId).toBe("mts_1");
  });
  it("refuses conflicting journals", () => {
    const value = row();
    value.metadata = { measurementSamples: [{ ...value.payloadSnapshot.journaled.measurementSamples[0], measurementSampleId: "other" }] };
    expect(() => removalOwnedMeasurements("removal", [value])).toThrow("inconsistent ownership");
  });
  it("refuses a reference from another Removal or version", () => {
    expect(() => removalOwnedMeasurements("other", [row()])).toThrow("inconsistent ownership");
    const value = row(); value.version = 2;
    expect(() => removalOwnedMeasurements("removal", [value])).toThrow("inconsistent ownership");
  });
  it("refuses journal-only identities, duplicate ownership and malformed snapshots", () => {
    const value = row(); value.payloadSnapshot.durabilityMeasurementSamples.submissions = [];
    expect(() => removalOwnedMeasurements("removal", [value])).toThrow("inconsistent ownership");
    expect(() => removalOwnedMeasurements("removal", [row(), row()])).toThrow("inconsistent ownership");
    for (const payloadSnapshot of [[], "broken", { durabilityMeasurementSamples: null }, { durabilityMeasurementSamples: { submissions: [null] } }]) {
      expect(() => removalOwnedMeasurements("removal", [{ id: "s", version: 1, metadata: {}, payloadSnapshot }])).toThrow("inconsistent ownership");
    }
  });
});
