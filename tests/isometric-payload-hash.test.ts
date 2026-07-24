import { describe, expect, it } from "vitest";
import { payloadHash } from "@/lib/isometric";
import {
  INPUT_MAPPING,
  MAPPING_REVISION,
} from "@/lib/isometric/transformers/datapoint";
import { SEQUESTRATION_COMPONENT_INPUT_BINDINGS } from "@/lib/isometric/transformers/sequestration-binding";

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

  it("changes the mapping revision when a sequestration binding source changes", () => {
    const binding =
      SEQUESTRATION_COMPONENT_INPUT_BINDINGS.biochar_sequestration_1000_year;
    const oldMeasurementPropertyShape = {
      inputMapping: INPUT_MAPPING,
      sequestrationComponentInputBindings: {
        ...SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
        biochar_sequestration_1000_year: {
          inputs: {
            ...binding.inputs,
            s_fraction: {
              dataShape: "LIST",
              source: "measurement-property",
              measurementProperty: {
                quantity_kind: "dimensionless_ratio",
                qualifier: "inertinite_fraction",
              },
            },
          },
        },
      },
    };

    expect(payloadHash(oldMeasurementPropertyShape)).not.toBe(MAPPING_REVISION);
  });
});
