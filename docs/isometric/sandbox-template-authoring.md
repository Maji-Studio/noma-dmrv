# Sandbox GHG Entry Template Guide

> **Current compatibility guide.** The former `noma-mvp` walkthrough and fixed
> DEFRA/IPCC bootstrap values were for legacy templates and are no longer the
> active contract. Do not promote those example values or component counts.
> Current compatibility is owned by the live template, committed mappings, and
> the coverage check.

This guide applies to the sandbox project recorded in
[`versions.json`](./versions.json). Template mutation remains an operator action
in the Isometric UI; Certify exposes read operations, not a template-authoring
API.

## Sources of truth

Before editing a template, inspect:

- `src/lib/isometric/transformers/datapoint.ts` for ordinary monitored inputs,
  component-name discriminators, and PROJECT-scope guards;
- `src/lib/isometric/transformers/sequestration-binding.ts` for explicit
  durability component inputs;
- `src/lib/certification/removal-source-bindings.ts` for exact evidence targets;
- the facility's durability tier and default template mapping;
- the live template output from:

  ```bash
  pnpm tsx scripts/isometric-smoke.ts inspect-template prj_1K9YJ33RKSBX9FFF
  ```

Do not treat a value in this document as a registry-approved emission factor.
Fixed factors and their justification Sources are registry-owned configuration.

## Required template shape

A usable template must:

1. be a `REMOVAL` credit template for the mapped project;
2. contain exactly one supported storage component;
3. use a storage component compatible with the facility durability tier;
4. declare only monitored inputs covered by an ordinary or explicit durability
   mapping;
5. pre-bind every fixed input to a justified registry Datapoint;
6. keep PROJECT-scope emissions out of the Removal template;
7. use the exact display names required for component-instance
   discrimination.

Compilation verifies quantity kind, unit, input shape, component name, and
durability tier before any registry write.

## Storage component

### 1,000-year sandbox facility

Use `biochar_sequestration_1000_year_f_durable_max` under `co2-stored` with
exactly:

| Input | Shape | Quantity kind | noma source |
|---|---|---|---|
| `total_carbon_contents` | list | `mass_fraction_dry_basis` | Measurement-sample total-carbon replicates |
| `inorganic_carbon_contents` | list | `mass_fraction_dry_basis` | Directly measured inorganic-carbon replicates; registry pairing key unconfirmed |
| `product_mass` | scalar | `mass` | Standalone credit-batch product-mass Datapoint |
| `s_fraction` | list | `dimensionless_ratio` | Measurement-sample reflectance-fraction replicates |

The local submission gate requires at least three complete paired replicates per
member credit batch.
Verify the registry `MeasurementSample` record grain and pairing key before
migrating the template.
The registry calculates organic carbon per replicate as total minus inorganic,
then applies the binomial lower durability estimate and 0.95 cap. noma's local
calculation is explanatory; the registry result is authoritative. Application
support is sandbox-only. Migrate the external sandbox template to this contract,
then verify one complete submission and supersession. Production submission
remains fail-closed while the registry-confirmation work in
[`open-questions-isometric.md`](../open-questions-isometric.md) remains open.

`biochar_sequestration_1000_year` is a deprecated historical component with
total-carbon and uncapped durability semantics. Do not select it for a new
facility mapping; noma rejects it and directs the operator to the current key.

### 200-year facility

The recognized template keys are
`biochar_sequestration_200_year_c_org` and
`biochar_sequestration_200_year_unsampled`, but the complete binding contract
is not confirmed. Authoring one of these keys makes the tier check pass, not the
submission path. 200-year submission still fails closed.

### Legacy storage component

`carbon_rich_substance_sequestration` remains recognized only for legacy
compatibility. Do not use it when authoring a new tier-specific template.

## Ordinary monitored components

The current transformer supports these monitored inputs when the template
declares them:

| Group | Blueprint | Input | noma source |
|---|---|---|---|
| `biomass-feedstock-transport` | `mass_distance_based_ci_emissions` | `mass_distance` | Feedstock transport tonne-km |
| `biochar-transport` | `mass_distance_based_ci_emissions` | `mass_distance` | Biochar delivery transport tonne-km |
| `sampling-required-for-mrv` | `mass_distance_based_ci_emissions` | `mass_distance` | Sample transport tonne-km |
| `pyrolysis` | `grid_electricity_use` | `electricity_use` | Production electricity kWh |
| `pyrolysis` | `fuel_usage_by_volume` | `volume_of_fuel` | Component-specific diesel litres |
| `miscellaneous` | `mass_based_ci_emissions` | `mass` | Safety-margin dry biochar mass only |

The transformer also contains compatibility mappings for
`specific_volume_based_emissions / feedstock_mass` under the feedstock and
biochar transport groups. Do not add them merely because they are recognized;
the live project/template determines applicability.

## Exact component names

Certify does not expose a stable component-instance key for two components that
share the same group/blueprint/input tuple. The current mapping therefore
requires these display names, matched case/whitespace-insensitively:

| Display name | Submitted value |
|---|---|
| `Generator diesel usage` | Generator diesel plus preprocessing fuel |
| `Startup diesel usage` | Reactor-startup/plant diesel |
| `Safety margin` | Removal dry biochar mass |

A rename fails closed. If the registry template changes, update the mapping and
its tests in the same application-code change; do not work around the guard
with a zero.

## PROJECT-scope components

Do not place these monitored tuples in a Removal/GHG Entry template:

- staff travel;
- pyrolyzer direct-gas concentration or mass flow;
- biochar-storage fuel;
- sampling-consumable mass;
- laboratory electricity;
- miscellaneous LCA overhead other than the exact `Safety margin` carve-out.

Where applicable, the operator authors them as PROJECT-scope Components in
Isometric and attaches the supporting LCA Source there. noma intentionally has
no project-emissions journal. The scope guard in `datapoint.ts` rejects a
Removal template that crosses this boundary.

## Fixed inputs

Every `type=fixed` input must already reference a registry Datapoint. noma
submits monitored operational quantities only.

For each fixed input:

1. choose a source appropriate to the project, geography, activity, and pinned
   module;
2. create or select the Datapoint in Isometric;
3. bind it in the template;
4. attach its justification Source in Isometric;
5. have the project/verifier process review the choice.

No fixed constant is stored in noma. Do not reintroduce a `fixed_constants`
table or copy the retired template's placeholder values.

## Evidence binding contract

Template inputs must remain compatible with the current per-input Source plan:

- application inventory/logbook evidence supports storage `product_mass` and,
  when present, safety-margin `mass`;
- feedstock and delivery bills of lading support their corresponding transport
  `mass_distance`;
- the generated transport ledger supports each transport input present;
- the generated durability ledger supports the tier-specific durability
  inputs.

The plan is snapshot- and hash-covered. After submission, noma verifies the
actual Source attachment through GHG-entry component attributions and
Datapoints.

## Validate before selection

After saving the template:

1. inspect it:

   ```bash
   pnpm tsx scripts/isometric-smoke.ts inspect-template prj_1K9YJ33RKSBX9FFF
   ```

2. update the matching facility fixture in
   `tests/fixtures/isometric-coverage.json` if the checked-in sandbox contract
   changed;
3. run:

   ```bash
   pnpm isometric:coverage-check -- --source=fixture
   ```

4. when an interactive configured database is available, run:

   ```bash
   pnpm isometric:coverage-check -- --source=db
   ```

5. select the template in the facility's Isometric mapping;
6. compile a New Removal and review the exact monitored/fixed bindings and
   Source plan before submitting.

## Failure meanings

- **Missing mapping:** the template declares an unsupported monitored input.
- **Unbound fixed input:** bind a registry Datapoint; noma will not invent one.
- **Unsupported durability component:** tier, blueprint, or input table does not
  match the implemented path.
- **Unrecognized diesel/Safety margin component:** restore the exact display
  name or ship a reviewed mapping change.
- **PROJECT-scope conflict:** move the component out of the Removal template.
- **Missing intended Source:** fix the evidence/lineage or template target; do
  not attach every Source to every input.
