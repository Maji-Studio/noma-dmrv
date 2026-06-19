// Tests for the ADR 0005 period-input scope guard + INPUT_MAPPING cleanup.
//
// Three guarantees:
//   1. PERIOD_INPUT_TUPLES holds exactly the seven (group, blueprint, input)
//      tuples the cleanup removed from INPUT_MAPPING (five categories, with
//      `pyrolyzer_direct` carrying two inputs and `sampling-required-for-mrv`
//      housing two distinct categories).
//   2. buildCreateDatapointRequest raises the scope-conflict SafeError
//      (naming the canonical PROJECT scope) when called with a tuple from
//      that set — not the generic "missing INPUT_MAPPING entry" message.
//   3. Regression — no `INPUT_MAPPING` entry carries the legacy `zeroStub`
//      property. The field was removed from `InputMappingEntry`; this test
//      keeps an additional runtime tripwire so a future re-introduction
//      from a merge or refactor surfaces immediately.

import { describe, expect, it } from "vitest";
import { SafeError } from "@/lib/errors";
import type { components } from "@/lib/isometric/generated/certify";
import {
  buildCreateDatapointRequest,
  INPUT_MAPPING,
  lookupInputMapping,
  lookupPeriodInputTuple,
  MAPPING_REVISION,
} from "@/lib/isometric/transformers/datapoint";
import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";

type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type RemovalTemplateComponentInput =
  components["schemas"]["RemovalTemplateComponentInput"];

// The canonical 7 tuples. Mirrors `PERIOD_INPUT_TUPLES` in
// `transformers/datapoint.ts` — if a category is added or renamed there,
// update this list.
const PERIOD_INPUT_TUPLE_CANON: ReadonlyArray<{
  group: string;
  blueprint: string;
  input: string;
  category:
    | "staff_travel"
    | "pyrolyzer_direct"
    | "biochar_storage_fuel"
    | "miscellaneous"
    | "lab_electricity"
    | "sampling_consumables";
}> = [
  {
    group: "staff-travel",
    blueprint: "distance_based_ci_emissions",
    input: "distance",
    category: "staff_travel",
  },
  {
    group: "direct-emissions",
    blueprint: "ghg_direct_emissions",
    input: "concentration",
    category: "pyrolyzer_direct",
  },
  {
    group: "direct-emissions",
    blueprint: "ghg_direct_emissions",
    input: "mass_flow",
    category: "pyrolyzer_direct",
  },
  {
    group: "biochar-storage",
    blueprint: "fuel_usage_by_volume",
    input: "volume_of_fuel",
    category: "biochar_storage_fuel",
  },
  {
    group: "miscellaneous",
    blueprint: "mass_based_ci_emissions",
    input: "mass",
    category: "miscellaneous",
  },
  {
    group: "sampling-required-for-mrv",
    blueprint: "mass_based_ci_emissions",
    input: "mass",
    category: "sampling_consumables",
  },
  {
    group: "sampling-required-for-mrv",
    blueprint: "grid_electricity_use",
    input: "electricity_use",
    category: "lab_electricity",
  },
];

describe("PERIOD_INPUT_TUPLES", () => {
  it("covers exactly the seven canonical tuples", () => {
    for (const t of PERIOD_INPUT_TUPLE_CANON) {
      expect(lookupPeriodInputTuple(t.group, t.blueprint, t.input)).toEqual({
        category: t.category,
      });
    }
  });

  it("does not match a tuple that lives in INPUT_MAPPING", () => {
    // `co2-stored / carbon_rich_substance_sequestration / product_mass` is a
    // real Removal-scope mapping. It must NOT be flagged as a period input.
    expect(
      lookupPeriodInputTuple(
        "co2-stored",
        "carbon_rich_substance_sequestration",
        "product_mass",
      ),
    ).toBeUndefined();
  });
});

describe("INPUT_MAPPING (post-ADR-0005 cleanup)", () => {
  it("no entry carries a residual `zeroStub` property", () => {
    for (const [groupKey, group] of Object.entries(INPUT_MAPPING)) {
      for (const [blueprintKey, blueprint] of Object.entries(group)) {
        for (const [inputKey, entry] of Object.entries(blueprint)) {
          expect(
            (entry as { zeroStub?: unknown }).zeroStub,
            `INPUT_MAPPING entry ${groupKey}/${blueprintKey}/${inputKey} carries a residual zeroStub property; the field was removed by ADR 0005.`,
          ).toBeUndefined();
        }
      }
    }
  });

  it("removed the seven previously-zero-stubbed families", () => {
    for (const t of PERIOD_INPUT_TUPLE_CANON) {
      expect(
        lookupInputMapping(t.group, t.blueprint, t.input),
        `${t.group}/${t.blueprint}/${t.input} must not appear in INPUT_MAPPING — period inputs live as PROJECT-scope Components.`,
      ).toBeUndefined();
    }
  });
});

describe("buildCreateDatapointRequest scope-conflict SafeError", () => {
  // A minimal aggregator + blueprint that lets us drive the function for
  // PERIOD_INPUT_TUPLE families. The function should never reach the
  // type/unit guards because PERIOD_INPUT_TUPLES is checked first.
  const minimalAgg: AggregatedProductionData = {
    weightedOrganicCarbonPercent: 0,
    weightedHToCorgRatio: 0,
    weightedOToCorgRatio: 0,
    weightedAshPercent: 0,
    weightedMoisturePercent: 0,
    totalBiocharDryMassKg: 1,
    totalFeedstockDryMassKg: 1,
    totalStartupDieselLitres: 0,
    totalGensetDieselLitres: 0,
    totalElectricityKwh: 0,
    feedstockTransportMassDistanceTonneKm: 0,
    biocharTransportMassDistanceTonneKm: 0,
    sampleTransportMassDistanceTonneKm: 0,
    totalGensetKwh: 0,
    earliestStartTime: new Date(0),
    latestEndTime: new Date(0),
    sourceProductionRunIds: [],
    warnings: [],
  };

  // Distinctive (non-"kg") unit so the stub assertion verifies the builder
  // echoes blueprintInput.compatible_unit rather than coincidentally matching a
  // hard-coded "kg".
  const STUB_COMPATIBLE_UNIT = "tonne";

  function callWith(
    tuple: typeof PERIOD_INPUT_TUPLE_CANON[number],
    opts?: { allowPeriodInputStub?: boolean },
  ) {
    const blueprintInput: ComponentBlueprintInput = {
      compatible_unit: STUB_COMPATIBLE_UNIT,
      data_shape: "SCALAR",
      description: "x",
      input_key: tuple.input,
      quantity_kind: "mass",
    };
    const rtcInput: RemovalTemplateComponentInput = {
      datapoint_id: null,
      display_name: "x",
      input_key: tuple.input,
      quantity_kind: "mass",
      type: "monitored",
    };
    return () =>
      buildCreateDatapointRequest({
        groupKey: tuple.group,
        componentBlueprintKey: tuple.blueprint,
        rtcInput,
        blueprintInput,
        agg: minimalAgg,
        projectId: "prj_TEST",
        supplierRefId: "nm-test",
        allowPeriodInputStub: opts?.allowPeriodInputStub,
      });
  }

  it("throws a SafeError naming PROJECT scope and the category", () => {
    for (const t of PERIOD_INPUT_TUPLE_CANON) {
      let err: unknown;
      try {
        callWith(t)();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SafeError);
      const message = (err as Error).message;
      expect(message).toMatch(/PROJECT/);
      expect(message).toContain(t.category);
      expect(message).toContain(t.input);
      // The generic missing-entry message must NOT fire — that would mean the
      // scope-conflict guard didn't run first.
      expect(message).not.toMatch(/No INPUT_MAPPING entry/);
    }
  });

  it("emits a 0-magnitude REPORTED stub when allowPeriodInputStub is set (sandbox)", () => {
    // ADR 0005 sandbox escape hatch: the same tuples that fail closed by
    // default emit a 0 datapoint (in the blueprint's compatible_unit) when the
    // caller opts in. submitRemoval only opts in for ISOMETRIC_ENVIRONMENT
    // === "sandbox", so production keeps failing closed (asserted above).
    for (const t of PERIOD_INPUT_TUPLE_CANON) {
      const dp = callWith(t, { allowPeriodInputStub: true })();
      expect(dp.quantity.magnitude).toBe(0);
      expect(dp.quantity.unit).toBe(STUB_COMPATIBLE_UNIT); // echoes blueprintInput.compatible_unit
      expect(dp.type).toBe("REPORTED");
      expect(dp.display_name).toBe(t.input);
    }
  });
});

describe("MAPPING_REVISION", () => {
  it("is a deterministic 64-char sha256 hex string", () => {
    expect(MAPPING_REVISION).toMatch(/^[0-9a-f]{64}$/);
  });
});
