# Energy submits as a single combined measurement point

Status: accepted (2026-06-19) — supersedes the stage-split portion of ADR 0001.

## Context

The operator-authored production removal template (`rvt_1KS4S43VPSBXA26X`) now carries
energy under one `pyrolysis` group: `grid_electricity_use` for grid electricity and
`energy_based_ci_emissions` for diesel-genset energy. It no longer declares the
per-stage biomass-processing, pyrolysis, and biochar-processing energy components that
ADR 0001 mapped through facility-level stage split percentages.

noma's production runs also record energy at this same combined measurement point:
combined electricity kWh and diesel-genset litres for the run. Keeping synthetic stage
splits after the template changed would route data to components that no longer exist.

The active template also declares no `fuel_usage_by_volume` component for startup/plant
diesel or preprocessing fuel. Those run fields can still be recorded locally, but there is
currently no removal-template input that can carry them to Certify.

## Decision

noma submits production-run energy as one combined pair under the `pyrolysis` group:

- `grid_electricity_use/electricity_use` receives total grid electricity kWh.
- `energy_based_ci_emissions/energy` receives total diesel-genset energy kWh.

The diesel-genset kWh value remains derived from the facility's admin-configured genset
yield (`gensetEnergyYieldKwhPerLitre`). The three facility stage-split percentages are
removed from schema, validation, admin UI, aggregation, transformer mapping, and seed data.

Startup/plant diesel and preprocessing fuel remain recorded in noma. If the active removal
template does not declare a `fuel_usage_by_volume` component, submit readiness surfaces a
non-blocking advisory and submit logging records the same advisory. The submission still
proceeds because there is no compatible template component to populate.

## Why

The new template and noma's source data now agree on the measurement boundary. A synthetic
stage split no longer improves auditability; it only creates an invalid mapping surface.
Keeping one grid-electricity datapoint and one genset-energy datapoint preserves the
measured totals and avoids inventing per-stage precision operators do not have.

The genset yield stays as admin config because it is emissions-affecting: operators record
litres, while the template expects kWh. Unlike the removed stage split, changing this value
changes submitted emissions.

## Consequences

- ADR 0001 still explains why the genset yield is facility-level admin config, but its
  per-stage split decision is superseded.
- `certifier_projects.stage_split_*_pct` columns are dropped; existing non-production
  environments should be reseeded rather than migrated with data preservation semantics.
- Energy preview UI shows combined submitted values, not per-stage apportionment.
- Templates that later reintroduce `fuel_usage_by_volume` can submit startup/plant diesel
  through the retained transformer mapping; until then those fields are advisory-only for
  the active template.

All Isometric protocol references are non-authoritative summaries; verify against
registry.isometric.com before encoding credit-claim logic.
