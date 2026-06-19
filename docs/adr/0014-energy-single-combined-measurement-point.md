# Energy is submitted as a single combined measurement point

Status: accepted (2026-06-19). **Supersedes the per-stage-split half of
[ADR 0001](0001-emission-estimate-config.md);** the genset-yield-as-config
decision in ADR 0001 still stands.

## Context

ADR 0001 split a run's single combined electricity + genset figures across
three process-stage template components (biomass / pyrolysis / biochar) using
per-facility `stageSplit{Biomass,Pyrolysis,Biochar}Pct` percentages, because the
removal template declared a separate electricity + genset component per stage.
The split was emissions-neutral (all electricity shares one carbon intensity,
all genset shares another) and only shaped the registry's per-stage display.

The operator re-authored the production removal template
(`rvt_1KS4S43VPSBXA26X`) so that **all energy enters at one point**: a single
`grid_electricity_use` component (grid electricity, input `electricity_use`,
kWh) and a single `energy_based_ci_emissions` component (diesel genset, input
`energy`, kWh), both under the `pyrolysis` group. The
`biomass-feedstock-processing` and `biochar-processing` energy components — and
the `metered_energy_based_ci_emissions` pair — are gone. The rationale is
honest measurement: operators cannot meter the feedstock-processing or
biochar-processing stages separately, so there is nothing to split. The
mismatch crashed every submit of the removal — `grid_electricity_use` under
`pyrolysis` was absent from `INPUT_MAPPING`, which only knew it under
`biochar-processing` — failing closed in `buildCreateDatapointRequest`.

## Decision

noma submits energy as **one combined electricity figure and one combined
genset figure**, mapped to the single energy components the template declares
under `pyrolysis`. The per-stage apportionment — and the three `stageSplit*Pct`
config columns / Zod schema / admin form fields / energy-page UI — are
**removed**. The genset **yield** (`gensetEnergyYieldKwhPerLitre`) is
**retained**: it converts genset litres → kWh and is emissions-affecting,
exactly as ADR 0001 noted.

Additional points of measurement remain possible in future: if operators gain
per-stage metering, the template can re-declare per-stage components and noma
can map them — but that is a deliberate, non-trivial change, not the default.

## Why

- The split existed only to fill template components that no longer exist. With
  one electricity component and one genset component, there is nothing to
  apportion; keeping the split would be machinery with no consumer.
- It is emissions-neutral, so removing it changes **no** verified total — only
  that noma stops fabricating a per-stage breakdown it cannot measure. That is
  more honest, and matches the operator's reason for re-authoring.
- The genset yield is a different kind of value (emissions-affecting), so it is
  kept while the split is dropped — the same distinction ADR 0001 drew.

## Consequences

- `stageSplit{Biomass,Pyrolysis,Biochar}Pct` is dropped from `certifier_projects`
  (no production data yet, so a fresh drop-column migration + reseed, not an
  in-place edit of an applied migration).
- `INPUT_MAPPING` maps `pyrolysis / grid_electricity_use / electricity_use` →
  combined electricity (`totalElectricityKwh`) and
  `pyrolysis / energy_based_ci_emissions / energy` → combined genset
  (`totalGensetKwh`, litres × yield); the per-stage and
  `metered_energy_based_ci_emissions` entries are removed.
- Startup/plant diesel + preprocessing fuel have **no component in this
  template** (the volume-based `fuel_usage_by_volume` groups are empty), so they
  are no longer submitted. To avoid a silent under-count they are de-marked as
  certify-required and a **non-blocking warning** fires at submit/readiness when
  a recorded value has no template component to carry it.
- This does **not** make the removal submittable end-to-end. The re-authored
  `co2-stored` group uses the `biochar_sequestration_200_year_c_org` /
  `_unsampled` blueprints, submitted as **measurement samples** per
  [ADR 0013](0013-registry-computed-durable-fraction.md) — separate, not-yet-built
  work tracked in the lab-sampling plan and issue #291.
