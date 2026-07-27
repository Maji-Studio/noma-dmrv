import { describe, expect, it } from "vitest";
import {
  addJournaledMeasurementSample,
  readJournaledMeasurementSamples,
} from "./measurement-sample-journal";

describe("measurement-sample submission journal", () => {
  it("reads the supplier-reference to remote-ID mappings from payload_snapshot.journaled", () => {
    expect(
      readJournaledMeasurementSamples({
        journaled: {
          measurementSamples: [
            {
              supplierReferenceId: "nm-mts-removal-pb-batch-v1",
              measurementSampleId: "mts-1",
            },
          ],
        },
      }),
    ).toEqual([
      {
        supplierReferenceId: "nm-mts-removal-pb-batch-v1",
        measurementSampleId: "mts-1",
      },
    ]);
  });

  it("adds mappings deterministically without dropping earlier entries", () => {
    const first = addJournaledMeasurementSample([], {
      supplierReferenceId: "ref-b",
      measurementSampleId: "mts-b",
    });
    const second = addJournaledMeasurementSample(first, {
      supplierReferenceId: "ref-a",
      measurementSampleId: "mts-a",
    });

    expect(second).toEqual([
      { supplierReferenceId: "ref-a", measurementSampleId: "mts-a" },
      { supplierReferenceId: "ref-b", measurementSampleId: "mts-b" },
    ]);
  });

  it("is idempotent for an identical mapping", () => {
    const entry = {
      supplierReferenceId: "ref-a",
      measurementSampleId: "mts-a",
    };
    expect(addJournaledMeasurementSample([entry], entry)).toEqual([entry]);
  });

  it("fails closed on a conflicting supplier-reference mapping", () => {
    expect(() =>
      addJournaledMeasurementSample(
        [
          {
            supplierReferenceId: "ref-a",
            measurementSampleId: "mts-original",
          },
        ],
        {
          supplierReferenceId: "ref-a",
          measurementSampleId: "mts-conflict",
        },
      ),
    ).toThrow(/already journaled.*different measurement sample/i);
  });

  it("fails closed on malformed journal state", () => {
    expect(() =>
      readJournaledMeasurementSamples({
        journaled: {
          measurementSamples: [{ supplierReferenceId: "ref-a" }],
        },
      }),
    ).toThrow(/measurement-sample journal is invalid/i);
  });

  it("fails closed on duplicate journal identities", () => {
    expect(() =>
      readJournaledMeasurementSamples({
        journaled: {
          measurementSamples: [
            {
              supplierReferenceId: "ref-a",
              measurementSampleId: "mts-a",
            },
            {
              supplierReferenceId: "ref-a",
              measurementSampleId: "mts-b",
            },
          ],
        },
      }),
    ).toThrow(/measurement-sample journal is invalid/i);
  });
});
