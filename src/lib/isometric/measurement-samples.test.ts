import { describe, expect, it } from "vitest";
import {
  captureMeasurementSampleDatapointIds,
  mergeMeasurementSampleDatapointIds,
  type IsometricMeasurementSample,
} from "./measurement-samples";

function measurementSample(
  id: string,
  values: IsometricMeasurementSample["values"],
): IsometricMeasurementSample {
  return {
    id,
    measured_at: "2026-07-24",
    measurement_location_id: null,
    production_batch_id: null,
    supplier_reference_id: `ref-${id}`,
    values,
  };
}

describe("captureMeasurementSampleDatapointIds", () => {
  it("groups response datapoint IDs by measurement property and preserves replicate order", () => {
    const capture = captureMeasurementSampleDatapointIds(
      measurementSample("mts_1", [
        {
          datapoint_id: "dtp_c1",
          measurement_property: {
            quantity_kind: "mass_fraction_dry_basis",
            qualifier: "total_carbon",
          },
          value: {
            magnitude: 0.8,
            standard_deviation: null,
            unit: "dimensionless",
          },
        },
        {
          datapoint_id: "dtp_s1",
          measurement_property: {
            quantity_kind: "dimensionless_ratio",
            qualifier: "inertinite_fraction",
          },
          value: {
            magnitude: 0.91,
            standard_deviation: null,
            unit: "dimensionless",
          },
        },
        {
          datapoint_id: "dtp_c2",
          measurement_property: {
            quantity_kind: "mass_fraction_dry_basis",
            qualifier: "total_carbon",
          },
          value: {
            magnitude: 0.82,
            standard_deviation: null,
            unit: "dimensionless",
          },
        },
        {
          datapoint_id: "dtp_mass",
          measurement_property: { quantity_kind: "mass", qualifier: null },
          value: { magnitude: 1000, standard_deviation: null, unit: "kg" },
        },
      ]),
    );

    expect(capture.measurementSampleId).toBe("mts_1");
    expect(
      capture.datapointIdsByMeasurementProperty.get(
        "mass_fraction_dry_basis|total_carbon",
      ),
    ).toEqual(["dtp_c1", "dtp_c2"]);
    expect(
      capture.datapointIdsByMeasurementProperty.get(
        "dimensionless_ratio|inertinite_fraction",
      ),
    ).toEqual(["dtp_s1"]);
    expect(capture.datapointIdsByMeasurementProperty.get("mass")).toEqual([
      "dtp_mass",
    ]);
  });

  it("fails closed when the registry response omits a required datapoint_id", () => {
    const sample = measurementSample("mts_bad", [
      {
        datapoint_id: undefined,
        measurement_property: { quantity_kind: "mass", qualifier: null },
        value: { magnitude: 1000, standard_deviation: null, unit: "kg" },
      } as unknown as IsometricMeasurementSample["values"][number],
    ]);

    expect(() => captureMeasurementSampleDatapointIds(sample)).toThrow(
      /without the required datapoint_id.*cannot bind sequestration inputs/,
    );
  });
});

describe("mergeMeasurementSampleDatapointIds", () => {
  it("retains per-sample ordering while combining the same property", () => {
    const first = captureMeasurementSampleDatapointIds(
      measurementSample("mts_1", [
        {
          datapoint_id: "dtp_c1",
          measurement_property: {
            quantity_kind: "mass_fraction_dry_basis",
            qualifier: "total_carbon",
          },
          value: {
            magnitude: 0.8,
            standard_deviation: null,
            unit: "dimensionless",
          },
        },
      ]),
    );
    const second = captureMeasurementSampleDatapointIds(
      measurementSample("mts_2", [
        {
          datapoint_id: "dtp_c2",
          measurement_property: {
            quantity_kind: "mass_fraction_dry_basis",
            qualifier: "total_carbon",
          },
          value: {
            magnitude: 0.82,
            standard_deviation: null,
            unit: "dimensionless",
          },
        },
      ]),
    );

    expect(
      mergeMeasurementSampleDatapointIds([first, second]).get(
        "mass_fraction_dry_basis|total_carbon",
      ),
    ).toEqual(["dtp_c1", "dtp_c2"]);
  });
});
