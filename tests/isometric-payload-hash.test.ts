import { describe, expect, it } from "vitest";
import { payloadHash } from "@/lib/isometric";
import {
  buildMappingRevisionInput,
  MAPPING_REVISION,
} from "@/lib/isometric/transformers/datapoint";
import { SEQUESTRATION_COMPONENT_INPUT_BINDINGS } from "@/lib/isometric/transformers/sequestration-binding";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";

const PRE_NORMALIZATION_MAPPING_REVISION =
  "ade17311184266354b7ee20e1ea0b58406c05deae8e2dbb6709d3105e007a2e5";

describe("Isometric payload hash", () => {
  it("keeps GHG statement semantic hashes stable across property ordering", () => {
    const a = payloadHash({ projectId: "prj_123", endOn: "2026-05-05" });
    const b = payloadHash({ endOn: "2026-05-05", projectId: "prj_123" });

    expect(a).toBe(b);
  });

  // Regression: functions inside INPUT_MAPPING (transforms like (v) => v / 100)
  // used to be silently dropped by JSON.stringify, so MAPPING_REVISION never
  // changed when a transform body did. canonicalize must fingerprint them.
  it("changes hash when a nested function body changes", () => {
    const a = payloadHash({ transform: (v: number) => v / 100 });
    const b = payloadHash({ transform: (v: number) => v / 1000 });

    expect(a).not.toBe(b);
  });

  it("keeps hash stable when an equivalent function appears in two payloads", () => {
    const fn = (v: number) => v / 100;
    const a = payloadHash({ transform: fn });
    const b = payloadHash({ transform: (v: number) => v / 100 });

    expect(a).toBe(b);
  });

  it("ignores diagnostic sequestration metadata in the revision input and hash", () => {
    const binding =
      SEQUESTRATION_COMPONENT_INPUT_BINDINGS[
        CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR
      ];
    const changedConfirmation = {
      ...SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
      [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
        inputs: {
          ...binding.inputs,
          total_carbon_contents: {
            ...binding.inputs.total_carbon_contents,
            sourceContract: {
              ...binding.inputs.total_carbon_contents.sourceContract,
              confirmation: "externally-unconfirmed",
            },
          },
        },
      },
    } as const;
    const changedLabel = {
      ...SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
      [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
        inputs: {
          ...binding.inputs,
          total_carbon_contents: {
            ...binding.inputs.total_carbon_contents,
            sourceContract: {
              ...binding.inputs.total_carbon_contents.sourceContract,
              nomaSource: "Diagnostic label only",
            },
          },
        },
      },
    } as const;
    const baselineInput = buildMappingRevisionInput();
    const changedConfirmationInput =
      buildMappingRevisionInput(changedConfirmation);
    const changedLabelInput = buildMappingRevisionInput(changedLabel);

    expect(changedConfirmationInput).toEqual(baselineInput);
    expect(payloadHash(changedConfirmationInput)).toBe(
      payloadHash(baselineInput),
    );
    expect(changedLabelInput).toEqual(baselineInput);
    expect(payloadHash(changedLabelInput)).toBe(payloadHash(baselineInput));
    expect(MAPPING_REVISION).toBe(PRE_NORMALIZATION_MAPPING_REVISION);
  });

  it("changes the revision input and hash when a semantic binding changes", () => {
    const binding =
      SEQUESTRATION_COMPONENT_INPUT_BINDINGS[
        CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR
      ];
    const changedMeasurementProperty = {
      ...SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
      [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
        inputs: {
          ...binding.inputs,
          s_fraction: {
            ...binding.inputs.s_fraction,
            measurementProperty: {
              ...binding.inputs.s_fraction.measurementProperty,
              qualifier: "total_inorganic_carbon",
            },
          },
        },
      },
    } as const;
    const baselineInput = buildMappingRevisionInput();
    const semanticChangeInput = buildMappingRevisionInput(
      changedMeasurementProperty,
    );

    expect(semanticChangeInput).not.toEqual(baselineInput);
    expect(payloadHash(semanticChangeInput)).not.toBe(payloadHash(baselineInput));
    expect(payloadHash(baselineInput)).toBe(MAPPING_REVISION);
  });
});
