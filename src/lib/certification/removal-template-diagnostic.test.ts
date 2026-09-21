import { describe, expect, it } from "vitest";
import type {
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
} from "@/lib/isometric/transformers/measurement-sample";
import { buildRemovalTemplateDiagnostic } from "./removal-template-diagnostic";

function template(
  blueprintKey: string,
  inputs: Array<{
    key: string;
    quantityKind: string;
    type?: "fixed" | "monitored";
    datapointId?: string | null;
  }>,
  groupKey = "pyrolysis",
): IsometricGhgEntryTemplate {
  return {
    id: "rvt-test",
    display_name: "Test Removal template",
    credit_type: "REMOVAL",
    project_id: "prj-test",
    supplier_reference_id: null,
    groups: [
      {
        id: "rtg-test",
        key: groupKey,
        display_name: "Test group",
        description: "",
        components: [
          {
            id: "rtc-test",
            blueprint_key: blueprintKey,
            display_name: "Test component",
            description: null,
            ghg_entry_template_component_group_id: "rtg-test",
            ghg_entry_template_id: "rvt-test",
            inputs: inputs.map((input) => ({
              datapoint_id: input.datapointId ?? null,
              display_name: input.key.replaceAll("_", " "),
              input_key: input.key,
              quantity_kind: input.quantityKind as never,
              type: input.type ?? "monitored",
            })),
          },
        ],
      },
    ],
  };
}

function blueprint(
  key: string,
  inputs: Array<{
    key: string;
    quantityKind: string;
    unit: string;
    shape?: "SCALAR" | "LIST";
  }>,
): IsometricComponentBlueprint {
  return {
    key,
    display_name: key,
    description: "",
    type: "ACTIVITY",
    expressions: [],
    inputs: inputs.map((input) => ({
      input_key: input.key,
      description: "",
      quantity_kind: input.quantityKind as never,
      compatible_unit: input.unit,
      data_shape: input.shape ?? "SCALAR",
    })),
  };
}

describe("buildRemovalTemplateDiagnostic", () => {
  it("maps an ordinary input through the production INPUT_MAPPING contract", () => {
    const diagnostic = buildRemovalTemplateDiagnostic({
      template: template("grid_electricity_use", [
        { key: "electricity_use", quantityKind: "energy" },
      ]),
      blueprints: [
        blueprint("grid_electricity_use", [
          { key: "electricity_use", quantityKind: "energy", unit: "kWh" },
        ]),
      ],
    });

    const input = diagnostic.groups[0].components[0].inputs[0];
    expect(input).toMatchObject({
      inputKey: "electricity_use",
      nomaSource: "Production-run electricity",
      transform: "Unchanged",
      status: "mapped",
      expected: {
        dataShape: "SCALAR",
        quantityKind: "energy",
        unit: "kWh",
      },
    });
    expect(input.status).toBe("mapped");
    expect(diagnostic.optionalNotPresent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "optional-not-present" }),
      ]),
    );
  });

  it("distinguishes registry-owned fixed values and template contract drift", () => {
    const fixed = buildRemovalTemplateDiagnostic({
      template: template("grid_electricity_use", [
        {
          key: "factor",
          quantityKind: "mass",
          type: "fixed",
          datapointId: "dtp-fixed",
        },
      ]),
      blueprints: [
        blueprint("grid_electricity_use", [
          { key: "factor", quantityKind: "mass", unit: "kg" },
        ]),
      ],
    });
    expect(fixed.groups[0].components[0].inputs[0].status).toBe(
      "registry-owned-fixed",
    );

    const drifted = buildRemovalTemplateDiagnostic({
      template: template("grid_electricity_use", [
        { key: "electricity_use", quantityKind: "mass" },
      ]),
      blueprints: [
        blueprint("grid_electricity_use", [
          { key: "electricity_use", quantityKind: "energy", unit: "kWh" },
        ]),
      ],
    });
    expect(drifted.groups[0].components[0].inputs[0].status).toBe(
      "template-contract-drift",
    );
  });

  it("renders the current four-input 1,000-year contract and compiled values", () => {
    const diagnostic = buildRemovalTemplateDiagnostic({
      template: template(
        CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
        [
          {
            key: "total_carbon_contents",
            quantityKind: "mass_fraction_dry_basis",
          },
          {
            key: "inorganic_carbon_contents",
            quantityKind: "mass_fraction_dry_basis",
          },
          { key: "s_fraction", quantityKind: "dimensionless_ratio" },
          { key: "product_mass", quantityKind: "mass" },
        ],
        "co2-stored",
      ),
      compilation: {
        review: {
          bindings: [],
          measurementSamples: [
            {
              values: [
                {
                  measurement_property: {
                    quantity_kind: "mass_fraction_dry_basis",
                    qualifier: "total_carbon",
                  },
                  value: { magnitude: 0.82, unit: "dimensionless" },
                },
                {
                  measurement_property: {
                    quantity_kind: "mass_fraction_dry_basis",
                    qualifier: "total_inorganic_carbon",
                  },
                  value: { magnitude: 0.01, unit: "dimensionless" },
                },
                {
                  measurement_property: {
                    quantity_kind: "dimensionless_ratio",
                    qualifier: "inertinite_fraction",
                  },
                  value: { magnitude: 0.91, unit: "dimensionless" },
                },
              ],
            },
          ],
          directSequestrationDatapoints: [
            {
              componentId: "rtc-test",
              inputKey: "product_mass",
              magnitude: 900,
              unit: "kg",
            },
          ],
        },
      },
    });

    const inputs = Object.fromEntries(
      diagnostic.groups[0].components[0].inputs.map((input) => [
        input.inputKey,
        input,
      ]),
    );
    expect(inputs.total_carbon_contents).toMatchObject({
      nomaSource: "Sample totalCarbonPercent[]",
      transform: "Divide by 100",
      status: "mapped",
      resolved: { binding: "measurement-sample", count: 1, magnitudes: [0.82] },
    });
    expect(inputs.inorganic_carbon_contents).toMatchObject({
      nomaSource: "Sample inorganicCarbonPercent[]",
      transform: "Divide by 100",
      status: "externally-unconfirmed-contract",
      resolved: { count: 1, magnitudes: [0.01] },
    });
    expect(inputs.s_fraction).toMatchObject({
      nomaSource: "Sample sReflectanceFraction[]",
      transform: "Unchanged",
      status: "externally-unconfirmed-contract",
      resolved: {
        binding: "measurement-sample",
        count: 1,
        magnitudes: [0.91],
      },
    });
    expect(inputs.s_fraction.wirePath).toContain("/measurement-samples.values[]");
    expect(inputs.product_mass).toMatchObject({
      nomaSource: "Attribution-scaled dry applied biochar mass",
      transform: "Unchanged",
      status: "externally-unconfirmed-contract",
      resolved: { binding: "datapoint", count: 1, magnitudes: [900] },
    });
    expect(diagnostic.aggregateStatus).toBe("drift");
  });

  it("distinguishes a missing noma mapping from registry contract drift", () => {
    const diagnostic = buildRemovalTemplateDiagnostic({
      template: template("new_registry_blueprint", [
        { key: "new_input", quantityKind: "mass" },
      ]),
      blueprints: [
        blueprint("new_registry_blueprint", [
          { key: "new_input", quantityKind: "mass", unit: "kg" },
        ]),
      ],
    });

    expect(diagnostic.groups[0].components[0].inputs[0].status).toBe(
      "missing-noma-mapping",
    );
    expect(diagnostic.aggregateStatus).toBe("missing");
  });

  it("marks the legacy 1,000-year component deprecated and incompatible", () => {
    const diagnostic = buildRemovalTemplateDiagnostic({
      template: template(
        DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
        [
          { key: "carbon_contents", quantityKind: "mass_fraction_dry_basis" },
          { key: "s_fraction", quantityKind: "dimensionless" },
          { key: "product_mass", quantityKind: "mass" },
        ],
        "co2-stored",
      ),
    });

    expect(diagnostic.groups[0].components[0]).toMatchObject({
      status: "deprecated-incompatible",
    });
    expect(diagnostic.aggregateStatus).toBe("drift");
  });

  it("marks an unavailable ordinary blueprint unsupported", () => {
    const diagnostic = buildRemovalTemplateDiagnostic({
      template: template("removed_blueprint", [
        { key: "mass", quantityKind: "mass" },
      ]),
    });

    expect(diagnostic.groups[0].components[0].status).toBe(
      "unsupported-component",
    );
    expect(diagnostic.aggregateStatus).toBe("missing");
  });
});
