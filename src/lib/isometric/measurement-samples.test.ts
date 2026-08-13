import { describe, expect, it } from "vitest";
import {
  captureMeasurementSampleDatapointIds,
  findMeasurementSampleBySupplierRef,
  mergeMeasurementSampleDatapointIds,
  type CreateMeasurementSampleRequest,
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

function requestForSample(
  sample: IsometricMeasurementSample,
  values: IsometricMeasurementSample["values"] = sample.values,
): CreateMeasurementSampleRequest {
  return {
    feedstock_batch_id: null,
    measured_at: sample.measured_at,
    measurement_location_id: null,
    measurement_type: "biochar_production_batch",
    production_batch_id: null,
    project_id: "prj_1",
    storage_location_id: null,
    supplier_reference_id: sample.supplier_reference_id,
    values: values.map(({ measurement_property, value }) => ({
      measurement_property,
      value,
    })),
  };
}

function capture(sample: IsometricMeasurementSample) {
  return captureMeasurementSampleDatapointIds(
    sample,
    requestForSample(sample),
  );
}

describe("captureMeasurementSampleDatapointIds", () => {
  it("groups response datapoint IDs by measurement property and preserves replicate order", () => {
    const result = capture(
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

    expect(result.measurementSampleId).toBe("mts_1");
    expect(
      result.datapointIdsByMeasurementProperty.get(
        "mass_fraction_dry_basis|total_carbon",
      ),
    ).toEqual(["dtp_c1", "dtp_c2"]);
    expect(
      result.datapointIdsByMeasurementProperty.get(
        "dimensionless_ratio|inertinite_fraction",
      ),
    ).toEqual(["dtp_s1"]);
    expect(result.datapointIdsByMeasurementProperty.get("mass")).toEqual([
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

    expect(() => capture(sample)).toThrow(
      /value with no identifier.*check the registry response/,
    );
  });

  it("fails closed when the registry response omits a requested value", () => {
    const response = measurementSample("mts_partial", [
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
    ]);
    const expectedValues = [
      ...response.values,
      {
        ...response.values[0],
        datapoint_id: "not-sent-by-registry",
        value: { ...response.values[0].value, magnitude: 0.82 },
      },
    ];

    expect(() =>
      captureMeasurementSampleDatapointIds(
        response,
        requestForSample(response, expectedValues),
      ),
    ).toThrow(/returned 1 value.*2 are required/);
  });

  it("fails closed when the registry reorders replicate values", () => {
    const response = measurementSample("mts_reordered", [
      {
        datapoint_id: "dtp_c2",
        measurement_property: {
          quantity_kind: "mass_fraction_dry_basis",
          qualifier: "total_carbon",
        },
        value: { magnitude: 0.82, standard_deviation: null, unit: "dimensionless" },
      },
      {
        datapoint_id: "dtp_c1",
        measurement_property: {
          quantity_kind: "mass_fraction_dry_basis",
          qualifier: "total_carbon",
        },
        value: { magnitude: 0.8, standard_deviation: null, unit: "dimensionless" },
      },
    ]);
    const request = requestForSample(response, [...response.values].reverse());

    expect(() => captureMeasurementSampleDatapointIds(response, request)).toThrow(
      /values in a different order/,
    );
  });

  it("fails closed on an unexpected response property", () => {
    const response = measurementSample("mts_extra", [
      {
        datapoint_id: "dtp_mass",
        measurement_property: { quantity_kind: "mass", qualifier: null },
        value: { magnitude: 1000, standard_deviation: null, unit: "kg" },
      },
      {
        datapoint_id: "dtp_extra",
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
    ]);

    expect(() =>
      captureMeasurementSampleDatapointIds(
        response,
        requestForSample(response, response.values.slice(0, 1)),
      ),
    ).toThrow(/contains a value the Removal template does not use/);
  });

  it("fails closed on duplicate response datapoint IDs", () => {
    const response = measurementSample("mts_duplicate", [
      {
        datapoint_id: "dtp_duplicate",
        measurement_property: { quantity_kind: "mass", qualifier: null },
        value: { magnitude: 1000, standard_deviation: null, unit: "kg" },
      },
      {
        datapoint_id: "dtp_duplicate",
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
    ]);

    expect(() => capture(response)).toThrow(/repeats value dtp_duplicate/);
  });
});

describe("mergeMeasurementSampleDatapointIds", () => {
  it("retains per-sample ordering while combining the same property", () => {
    const first = capture(
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
    const second = capture(
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

describe("findMeasurementSampleBySupplierRef", () => {
  it("stops paginated scanning at the first supplier-reference match", async () => {
    let yielded = 0;
    const client = {
      paginate: async function* () {
        for (const id of ["before", "target", "after"]) {
          yielded += 1;
          yield measurementSample(id, []);
        }
      },
      paginateAll: () => {
        throw new Error("paginateAll must not be used");
      },
    };

    await expect(
      findMeasurementSampleBySupplierRef(
        client as never,
        "ref-target",
      ),
    ).resolves.toMatchObject({ id: "target" });
    expect(yielded).toBe(2);
  });
});
