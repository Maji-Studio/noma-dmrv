// Tests for the deterministic match function that powers the read-only
// drift panel + the nightly coverage check (ADR 0005 §5).
//
// Match rule recap:
//   1. Component.blueprint_key === CATEGORY_TO_BLUEPRINT[row.category].blueprintKey
//   2. ComponentScalarInput.input_key === primaryInputKey
//   3. Datapoint.quantity.unit (case-insensitive) === expectedUnit OR row.unit
//   4. |dp.magnitude − row.magnitude| / row.magnitude <= 0.005 (±0.5%)
//
// Covers: match, missing-isometric, ambiguous, and orphan paths plus the
// magnitude-tolerance edges (in / out of band) and unit-mismatch rejection.

import { describe, expect, it } from "vitest";
import type { components } from "@/lib/isometric/generated/certify";
import {
  CATEGORY_TO_BLUEPRINT,
  MAGNITUDE_TOLERANCE,
  findOrphanComponents,
  matchEmissionToComponent,
  type ProjectEmissionRowShape,
} from "@/lib/isometric/utils/project-emission-match";

type Component = components["schemas"]["Component"];
type Datapoint = components["schemas"]["Datapoint"];

const ROW_STAFF: ProjectEmissionRowShape = {
  id: "row_staff",
  category: "staff_travel",
  magnitude: 59000,
  unit: "km",
};

function makeDatapoint(args: {
  id: string;
  magnitude: number;
  unit: string;
}): Datapoint {
  return {
    description: null,
    display_name: "x",
    id: args.id,
    locked_status: "not_locked",
    measured_at: null,
    project_id: null,
    quantity: { magnitude: args.magnitude, unit: args.unit },
    source_ids: [],
    supplier_reference_id: null,
    type: "REPORTED",
  };
}

function makeComponent(args: {
  id: string;
  blueprintKey: string;
  scalarInputs: { inputKey: string; datapointId: string }[];
}): Component {
  return {
    activity_completed_at: null,
    activity_started_at: null,
    blueprint_key: args.blueprintKey,
    description: null,
    display_name: args.id,
    id: args.id,
    inputs: args.scalarInputs.map((s) => ({
      __typename: "ComponentScalarInput",
      datapoint_id: s.datapointId,
      input_key: s.inputKey,
    })),
    removal_template_component_id: null,
    scope: "PROJECT",
    supplier_reference_id: null,
    type: "ACTIVITY",
  };
}

describe("matchEmissionToComponent — `match` outcome", () => {
  it("matches exact magnitude + unit + blueprint + primary input", () => {
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59000, unit: "km" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    const status = matchEmissionToComponent(
      ROW_STAFF,
      [cmp],
      new Map([[dp.id, dp]]),
    );
    expect(status.kind).toBe("match");
  });

  it("matches inside the ±0.5% magnitude tolerance", () => {
    // Right at the upper edge: 59000 + (59000 * 0.005) = 59295
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59295, unit: "km" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    expect(
      matchEmissionToComponent(ROW_STAFF, [cmp], new Map([[dp.id, dp]])).kind,
    ).toBe("match");
  });

  it("matches case-insensitively on unit", () => {
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59000, unit: "KM" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    expect(
      matchEmissionToComponent(ROW_STAFF, [cmp], new Map([[dp.id, dp]])).kind,
    ).toBe("match");
  });
});

describe("matchEmissionToComponent — `missing-isometric` outcome", () => {
  it("flags when no Component exists for the blueprint", () => {
    const status = matchEmissionToComponent(ROW_STAFF, [], new Map());
    expect(status.kind).toBe("missing-isometric");
  });

  it("flags when magnitude drifts outside ±0.5%", () => {
    // 1% over → outside tolerance
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59590, unit: "km" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    const status = matchEmissionToComponent(
      ROW_STAFF,
      [cmp],
      new Map([[dp.id, dp]]),
    );
    expect(status.kind).toBe("missing-isometric");
  });

  it("flags when unit conflicts (km vs miles)", () => {
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59000, unit: "miles" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    expect(
      matchEmissionToComponent(ROW_STAFF, [cmp], new Map([[dp.id, dp]])).kind,
    ).toBe("missing-isometric");
  });

  it("flags when the primary input key is absent on the Component", () => {
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59000, unit: "km" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [{ inputKey: "some_other_input", datapointId: "dp_1" }],
    });
    expect(
      matchEmissionToComponent(ROW_STAFF, [cmp], new Map([[dp.id, dp]])).kind,
    ).toBe("missing-isometric");
  });
});

describe("matchEmissionToComponent — `ambiguous` outcome", () => {
  it("returns every candidate when two Components both match", () => {
    const dp1 = makeDatapoint({ id: "dp_1", magnitude: 59000, unit: "km" });
    const dp2 = makeDatapoint({ id: "dp_2", magnitude: 59000, unit: "km" });
    const cmp1 = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    const cmp2 = makeComponent({
      id: "cmp_2",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_2" },
      ],
    });
    const status = matchEmissionToComponent(
      ROW_STAFF,
      [cmp1, cmp2],
      new Map([
        [dp1.id, dp1],
        [dp2.id, dp2],
      ]),
    );
    expect(status.kind).toBe("ambiguous");
    if (status.kind === "ambiguous") {
      expect(status.candidates).toHaveLength(2);
    }
  });
});

describe("findOrphanComponents", () => {
  it("returns Components with no matching row", () => {
    const dp = makeDatapoint({ id: "dp_1", magnitude: 1000, unit: "kg" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.miscellaneous.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.miscellaneous.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    const orphans = findOrphanComponents([], [cmp], new Map([[dp.id, dp]]));
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.component.id).toBe("cmp_1");
  });

  it("does not flag a Component that does match a row", () => {
    const dp = makeDatapoint({ id: "dp_1", magnitude: 59000, unit: "km" });
    const cmp = makeComponent({
      id: "cmp_1",
      blueprintKey: CATEGORY_TO_BLUEPRINT.staff_travel.blueprintKey,
      scalarInputs: [
        { inputKey: CATEGORY_TO_BLUEPRINT.staff_travel.primaryInputKey, datapointId: "dp_1" },
      ],
    });
    const orphans = findOrphanComponents(
      [ROW_STAFF],
      [cmp],
      new Map([[dp.id, dp]]),
    );
    expect(orphans).toHaveLength(0);
  });
});

describe("MAGNITUDE_TOLERANCE", () => {
  it("is 0.5% as documented", () => {
    expect(MAGNITUDE_TOLERANCE).toBe(0.005);
  });
});
