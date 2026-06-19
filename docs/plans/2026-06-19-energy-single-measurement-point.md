# Plan: collapse energy to a single measurement point (drop the stage split)

**Date:** 2026-06-19
**Status:** Approved — scope = **energy-only**, on its own `feat/` branch.
**Branch:** `feat/energy-single-measurement-point` (do **not** build on `feat/transport-leg-evidence-sources`)
**Decision record:** [ADR 0014](../adr/0014-energy-single-combined-measurement-point.md) (supersedes the stage-split half of [ADR 0001](../adr/0001-emission-estimate-config.md))
**Structural follow-up:** issue #291 (template-driven data model)

> Authoritative source for the template shape: a live read-only inspect
> (`NODE_ENV=development pnpm tsx scripts/isometric-smoke.ts inspect-template prj_1K9YJ33RKSBX9FFF`).
> Re-run it before implementing to confirm the template hasn't moved again.

---

## 1. Problem

The operator re-authored the production removal template `rvt_1KS4S43VPSBXA26X`
("Dark Earth Carbon Template") so all energy enters at **one** point — both
`grid_electricity_use` (grid electricity) and `energy_based_ci_emissions` (diesel
genset) sit under the **`pyrolysis`** group as plain scalars; the
`biomass-feedstock-processing` and `biochar-processing` energy components are
gone. noma still splits a run's combined electricity + genset across three stages
via per-facility `stageSplit*Pct` percentages (ADR 0001). The mismatch crashes
every submit:

> No INPUT_MAPPING entry for `pyrolysis / grid_electricity_use / electricity_use`

`buildCreateDatapointRequest` fails closed (only knew `grid_electricity_use`
under `biochar-processing`). The stage split now has nothing to split across.

## 2. Live template — energy-relevant groups (verified)

| Group | Component | Blueprint / input | Status |
|---|---|---|---|
| `pyrolysis` | Grid electricity use | `grid_electricity_use` / `electricity_use` (kWh) | **unmapped → crash** |
| `pyrolysis` | Electricity diesel genset | `energy_based_ci_emissions` / `energy` (kWh) | mapped → `pyrolysisGensetKwh` (repoint) |
| `biomass-feedstock-processing` | *(empty)* | — | dead |
| `biochar-processing` | *(empty)* | — | dead |
| `biomass-feedstock-sourcing` | *(empty)* | — | dead (no `fuel_usage_by_volume`) |

Transport (`biomass-feedstock-transport`, `biochar-transport`, sample) is
unchanged and maps fine.

## 3. Resolved decisions

1. **Scope = energy-only**, own branch. The submit will **still not complete
   end-to-end** afterward — `co2-stored` was also re-authored onto
   `biochar_sequestration_200_year_*` (measurement samples per ADR 0013,
   not-yet-built). That is out of scope here; tracked by the lab-sampling plan +
   issue #291. This change is the correct prerequisite either way.
2. **Startup/plant diesel + preprocessing fuel** have no `fuel_usage_by_volume`
   component in this template → **non-silent drop**: de-mark them as
   certify-required and surface a **non-blocking warning** when a recorded value
   has no template component to carry it. (Not a hard block; the operator
   deliberately removed the component.)
3. **Genset yield stays** (emissions-affecting); only the three stage-split
   percentages go.

## 4. Implementation — file by file

### Mapping — `src/lib/isometric/transformers/datapoint.ts`
- `pyrolysis`: **add** `grid_electricity_use / electricity_use` → `totalElectricityKwh`;
  **repoint** `energy_based_ci_emissions / energy` → `totalGensetKwh`;
  **remove** `metered_energy_based_ci_emissions` (gone from template).
- **Remove** the `biomass-feedstock-processing` energy entries (metered +
  energy_based) and the `biochar-processing` group's energy entries.
- **Keep** the `fuel_usage_by_volume` entries (correct if a template carries that
  component again; the not-carried case is handled by the warning).
- `MAPPING_REVISION` changes automatically (hash of `INPUT_MAPPING`) — expected.

### Aggregation — `src/lib/isometric/utils/aggregation.ts`
- Delete the 6 per-stage fields from `AggregatedProductionData`
  (`{biomass,pyrolysis,biochar}{Electricity,Genset}Kwh`); add one
  `totalGensetKwh: number`.
- `enrichWithFacilityConfig`: stop splitting; compute
  `totalGensetKwh = totalGensetDieselLitres × gensetEnergyYieldKwhPerLitre`.
  `totalElectricityKwh` is already the combined figure. (Keep the function name
  for minimal churn, or rename to `enrichWithGensetYield` — implementer's call.)
- `FacilityEmissionConfig`: drop the three `stageSplit*Pct` fields; keep
  `gensetEnergyYieldKwhPerLitre`.

### Config / schema / DB
- `src/schemas/certification.ts`: drop `stageSplit*Pct` from
  `facilityEmissionConfigSchema`; delete the sum `superRefine` + `STAGE_SPLIT_TOTAL_PCT`
  / `STAGE_SPLIT_SUM_TOLERANCE` consts.
- `src/db/schema/certification.ts`: drop the 3 `stage_split_*_pct` columns →
  `pnpm db:generate` a **new** drop-column migration (no prod data; never edit an
  applied migration) → `db:reset` locally.
- `src/db/seed-data.ts`: remove the 3 `stageSplit*` seed values (L1570–72).
- `src/components/admin/emission-estimates-form.tsx`: remove the 3 stage-split
  inputs.
- `src/lib/certification/certify-field-registry.ts`: remove the 3 `stageSplit*`
  field entries; **de-mark** `dieselOperationLiters` + `preprocessingFuelLiters`
  as certify-required.

### Startup-diesel warning
- In the submit pipeline (`src/fn/certification/submit-removal.ts`) and the
  readiness path (`certify-context-core.ts` warnings), add a **non-blocking**
  warning when `totalStartupDieselLitres > 0` and the active template declares no
  `fuel_usage_by_volume` component. Mirror the existing `lineageWarnings`
  surfacing; do not throw.

### Energy UI — `src/components/energy/energy-summary.tsx`
- Remove the per-stage split rendering; show combined electricity (kWh) + genset
  (L → kWh via yield) + startup/plant diesel (L, tagged "not submitted under
  active template"). Fix the banner copy ("…and stage splits").

### Tests
- `tests/isometric-transformers.test.ts`: update the demo-template tuple
  expectations (drop per-stage; add `pyrolysis / grid_electricity_use`; genset →
  `totalGensetKwh`).
- Update the `enrichWithFacilityConfig` aggregation tests for the single
  `totalGensetKwh` and no split.

## 5. Out of scope (stated)

`co2-stored` sequestration / measurement-samples (ADR 0013 + the lab-sampling
plan) — submit remains blocked there after this lands. Issue #291 tracks the
broader template-driven data model that makes this class of drift mechanical
instead of manual.

## 6. Validation

`pnpm lint` + `pnpm typecheck` + the transformer/aggregation tests. Re-run the
inspector to confirm zero **energy** tuples remain in the "NOT covered by
INPUT_MAPPING" report for `rvt_1KS4S43VPSBXA26X` (period-scope and sequestration
tuples will still be listed — expected, out of scope).
