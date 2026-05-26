// Project-emission ↔ Project-Component matching (ADR 0005 §5).
//
// Posture B: noma is the LCA journal; the operator publishes
// `PROJECT`-scope Components in the Isometric UI. This module is the
// deterministic matcher that powers both the read-only drift panel on
// `/certification/` and the nightly coverage check
// (`scripts/isometric-coverage-check.ts`). It is pure — no I/O — so it can
// run identically in the browser, in a server function, and in a node CLI.
//
// MATCH RULE:
//   1. Component.blueprint_key === CATEGORY_TO_BLUEPRINT[row.category].blueprintKey
//   2. Find the ComponentScalarInput whose input_key === primaryInputKey;
//      look up its referenced Datapoint by id.
//   3. Datapoint.quantity.unit (case-insensitive) === expectedUnit
//   4. |dp.magnitude − row.magnitude| / row.magnitude <= MAGNITUDE_TOLERANCE
//
// Notes on the design choices:
//   - `supplier_reference_id` is NOT usable as a match key because noma
//     does not POST Project Components or their Datapoints under Posture B.
//   - Magnitude lives on Datapoint, not on Component — the Component only
//     references its inputs by datapoint_id. The drift panel pre-fetches
//     `GET /datapoints?used_in_scope=PROJECT&project_id=...` into a Map.
//   - The ±0.5% tolerance absorbs unit rounding and operator-entered
//     precision (e.g. 59000 vs 59012 kg of staff-travel CO₂e).
//   - For `pyrolyzer_direct` the Component has TWO inputs (concentration +
//     mass_flow); we only match against `mass_flow` (the magnitude noma
//     audits) per ADR 0005 §5. `concentration` is operator-managed in the
//     Isometric UI from the LCA document; missing or wrong values surface
//     to the verifier, not to noma.

import type { components } from "../generated/certify";
import type {
  ProjectEmissionCategory,
} from "@/schemas/project-emissions";

type Component = components["schemas"]["Component"];
type ComponentScalarInput = components["schemas"]["ComponentScalarInput"];
type Datapoint = components["schemas"]["Datapoint"];

export interface ProjectEmissionRowShape {
  id: string;
  category: ProjectEmissionCategory;
  magnitude: number;
  unit: string;
}

// Magnitude tolerance for drift matching — 0.5% absolute relative. Tuned
// large enough to absorb unit rounding (e.g. tCO₂e → kgCO₂e × 1000) and
// operator transcription precision; small enough to flag a real value
// drift.
export const MAGNITUDE_TOLERANCE = 0.005;

// Six canonical category → blueprint mappings (ADR 0005). The primary
// input is the scalar whose magnitude noma audits via the drift panel +
// coverage check; secondary inputs on the same Component are operator-
// managed in the Isometric UI per the LCA document.
//
// COLLISION NOTE: `miscellaneous` and `sampling_consumables` both map to
// `mass_based_ci_emissions` / `mass` / `kg`. This is intentional per ADR
// 0005 — Isometric's Component model allows multiple Components of the
// same blueprint on a Project. The matcher distinguishes them via the
// magnitude check; the operator MUST give the two Components distinct
// `display_name`s in the Isometric UI (e.g. "Misc. emissions YYYY" vs
// "Sampling consumables YYYY") so an ambiguous status surfaces a
// concrete fix path. When magnitudes are also close (<±0.5%), the
// matcher returns `kind: "ambiguous"` and the drift panel asks the
// operator to reconcile manually. A future disambiguator (e.g. a
// noma-side `supplierRefIdPrefix` per category, or matching by Component
// display_name regex) is tracked in docs/open-questions.md.
export const CATEGORY_TO_BLUEPRINT: Record<
  ProjectEmissionCategory,
  {
    blueprintKey: string;
    primaryInputKey: string;
    expectedUnit: string;
  }
> = {
  staff_travel: {
    blueprintKey: "distance_based_ci_emissions",
    primaryInputKey: "distance",
    expectedUnit: "km",
  },
  pyrolyzer_direct: {
    blueprintKey: "ghg_direct_emissions",
    primaryInputKey: "mass_flow",
    expectedUnit: "kg",
  },
  biochar_storage_fuel: {
    blueprintKey: "fuel_usage_by_volume",
    primaryInputKey: "volume_of_fuel",
    expectedUnit: "L",
  },
  miscellaneous: {
    blueprintKey: "mass_based_ci_emissions",
    primaryInputKey: "mass",
    expectedUnit: "kg",
  },
  lab_electricity: {
    blueprintKey: "grid_electricity_use",
    primaryInputKey: "electricity_use",
    expectedUnit: "kWh",
  },
  sampling_consumables: {
    blueprintKey: "mass_based_ci_emissions",
    primaryInputKey: "mass",
    expectedUnit: "kg",
  },
};

export type MatchStatus =
  | { kind: "match"; component: Component; datapoint: Datapoint }
  | { kind: "missing-isometric"; reason: string }
  | {
      kind: "ambiguous";
      candidates: { component: Component; datapoint: Datapoint }[];
      reason: string;
    };

// Case-insensitive unit equality. Certify allows arbitrary unit strings;
// `kg` and `KG` should match, but `kg` and `tonne` should not (those
// represent a real unit conflict the operator must resolve).
function unitsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function magnitudesMatch(dpMagnitude: number, rowMagnitude: number): boolean {
  if (rowMagnitude === 0) {
    // Exact zero on both sides counts as a match; otherwise any non-zero
    // dp magnitude is a drift.
    return dpMagnitude === 0;
  }
  return Math.abs(dpMagnitude - rowMagnitude) / Math.abs(rowMagnitude) <=
    MAGNITUDE_TOLERANCE;
}

function findPrimaryScalarInput(
  component: Component,
  primaryInputKey: string,
): ComponentScalarInput | undefined {
  for (const input of component.inputs) {
    if (
      input.__typename === "ComponentScalarInput" &&
      input.input_key === primaryInputKey
    ) {
      return input;
    }
  }
  return undefined;
}

// For ONE noma row, decide its match status against the list of
// PROJECT-scope Components fetched from Isometric.
export function matchEmissionToComponent(
  row: ProjectEmissionRowShape,
  components: Component[],
  datapointsById: Map<string, Datapoint>,
): MatchStatus {
  const canon = CATEGORY_TO_BLUEPRINT[row.category];
  const candidates: { component: Component; datapoint: Datapoint }[] = [];

  for (const c of components) {
    if (c.blueprint_key !== canon.blueprintKey) continue;
    const scalar = findPrimaryScalarInput(c, canon.primaryInputKey);
    if (!scalar) continue;
    const dp = datapointsById.get(scalar.datapoint_id);
    if (!dp) continue; // missing datapoint = treat as no candidate
    const dpUnit = dp.quantity.unit ?? "";
    if (!unitsMatch(dpUnit, row.unit) && !unitsMatch(dpUnit, canon.expectedUnit)) {
      continue;
    }
    if (!magnitudesMatch(dp.quantity.magnitude, row.magnitude)) {
      continue;
    }
    candidates.push({ component: c, datapoint: dp });
  }

  if (candidates.length === 0) {
    return {
      kind: "missing-isometric",
      reason: `No PROJECT-scope Component with blueprint="${canon.blueprintKey}" + ${canon.primaryInputKey}=${row.magnitude}${row.unit} (±${MAGNITUDE_TOLERANCE * 100}%).`,
    };
  }
  if (candidates.length === 1) {
    return {
      kind: "match",
      component: candidates[0]!.component,
      datapoint: candidates[0]!.datapoint,
    };
  }
  // Common cause: `miscellaneous` and `sampling_consumables` both use the
  // `mass_based_ci_emissions` blueprint (see CATEGORY_TO_BLUEPRINT note).
  // When the operator gives both Components similar magnitudes, the
  // matcher cannot disambiguate. Names the candidates so the operator
  // knows which Isometric Components to inspect.
  const candidateNames = candidates
    .map((c) => `"${c.component.display_name}"`)
    .join(", ");
  return {
    kind: "ambiguous",
    candidates,
    reason: `Multiple PROJECT-scope Components with blueprint="${canon.blueprintKey}" matched (${candidateNames}). Give each a distinct display_name in Isometric (e.g. include the LCA year + category) so noma can match them unambiguously.`,
  };
}

// Reverse direction — Components in Isometric that don't have a matching
// noma row. Used by the drift panel to surface "Add this to
// /admin/emission-estimates for the audit trail." warnings, and by the
// coverage check.
export interface OrphanComponent {
  component: Component;
  datapoint?: Datapoint;
  reason: string;
}

// Collects every Component.id that ANY row claims (matched or ambiguous).
// Callers that already computed per-row statuses should pass them in via
// `claimedComponentIdsFromStatuses` — avoids re-matching every row a second
// time when the drift loader has already done it once.
export function claimedComponentIdsFromStatuses(
  statuses: Iterable<MatchStatus>,
): Set<string> {
  const ids = new Set<string>();
  for (const status of statuses) {
    if (status.kind === "match") {
      ids.add(status.component.id);
    } else if (status.kind === "ambiguous") {
      for (const cand of status.candidates) {
        ids.add(cand.component.id);
      }
    }
  }
  return ids;
}

export function findOrphanComponents(
  rowsOrClaimedIds: ProjectEmissionRowShape[] | Set<string>,
  components: Component[],
  datapointsById: Map<string, Datapoint>,
): OrphanComponent[] {
  const claimedComponentIds =
    rowsOrClaimedIds instanceof Set
      ? rowsOrClaimedIds
      : claimedComponentIdsFromStatuses(
          rowsOrClaimedIds.map((row) =>
            matchEmissionToComponent(row, components, datapointsById),
          ),
        );

  const orphans: OrphanComponent[] = [];
  for (const c of components) {
    if (claimedComponentIds.has(c.id)) continue;
    const blueprintKey = c.blueprint_key;
    const datapoint = (() => {
      for (const input of c.inputs) {
        if (input.__typename === "ComponentScalarInput") {
          const dp = datapointsById.get(input.datapoint_id);
          if (dp) return dp;
        }
      }
      return undefined;
    })();
    orphans.push({
      component: c,
      datapoint,
      reason: `PROJECT-scope Component "${c.display_name}" (blueprint="${blueprintKey}") has no matching /admin/emission-estimates row.`,
    });
  }
  return orphans;
}
