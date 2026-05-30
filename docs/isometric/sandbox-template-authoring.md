# Sandbox Template Authoring — noma-tailored Removal Template

A one-time walkthrough for an admin to author a sandbox Removal Template in
Isometric's Registry UI that noma can actually fill end-to-end. This unblocks
the Phase 3 `submitCreditBatch` write path against
`api.sandbox.isometric.com` / project `prj_1K9YJ33RKSBX9FFF`.

The sandbox's two default templates (`Protocol default`,
`Dark Earth removal template`) declare **21 monitored inputs** and **~12
unbound fixed constants** — most of which noma can't supply today
(`docs/open-questions.md` → `isometric/phase-3-input-coverage`,
`isometric/phase-3-fixed-constants`). Authoring a tailored template that
declares only the inputs noma already aggregates side-steps both gates.

## Scope (MVP)

The MVP template contains **4 components across 4 groups**, covering
**7 monitored inputs** sourced from noma's aggregation pipeline plus
**6 fixed-constant Datapoints** pre-bound in the template editor.

| Group key | Component (blueprint) | Monitored inputs | Fixed constants |
|---|---|---|---|
| `co2-stored` | CO₂ stored from biochar application (`carbon_rich_substance_sequestration`) | `carbon_content`, `product_mass` | — |
| `biomass-feedstock-transport` | Biomass transportation to processing site via truck (`transport`) | `distance`, `mass` | `carbon_intensity` |
| `biochar-transport` | Biochar transportation to storage site via truck (`transport`) | `distance`, `mass` | `carbon_intensity` |
| `sampling-required-for-mrv` | Sample transportation via car (`distance_based_ci_emissions`) | `distance` | `carbon_intensity` |

Omitted from MVP (incremental follow-ups):

- `metered_energy_based_ci_emissions` (pyrolyzer electricity — blocked by
  electricity-readout schema work, see `phase-3-input-coverage`)
- `fuel_usage_by_volume` (biomass handling, processing fuel)

**Do NOT add these as REMOVAL-scope components** — they live as
`PROJECT`-scope Components per
[ADR 0005](../adr/0005-period-emissions-as-project-components.md). A
Removal Template that declares any of them as REMOVAL-scope trips a
scope-conflict `SafeError` from `lookupPeriodInputTuple` in
`src/lib/isometric/transformers/datapoint.ts` at submit time, naming the
canonical scope:

- `staff-travel/distance_based_ci_emissions/distance` → category `staff_travel`
- `direct-emissions/ghg_direct_emissions/{concentration,mass_flow}` → category `pyrolyzer_direct`
- `biochar-storage/fuel_usage_by_volume/volume_of_fuel` → category `biochar_storage_fuel`
- `miscellaneous/mass_based_ci_emissions/mass` → category `miscellaneous`
- `sampling-required-for-mrv/mass_based_ci_emissions/mass` → category `sampling_consumables`
- `sampling-required-for-mrv/grid_electricity_use/electricity_use` → category `lab_electricity`

The operator publishes the matching Project Component in the Isometric
UI from a row in `/admin/emission-estimates` (LCA journal); the
read-only drift panel on `/certification/` reconciles. The nightly
`pnpm isometric:coverage-check` step in `isometric-health.yml` reads
`tests/fixtures/isometric-coverage.json` and asserts:

1. Every monitored tuple in the live template is in `INPUT_MAPPING` and
   not in `PERIOD_INPUT_TUPLES`.
2. Every `expectedCategories` entry has a matching PROJECT-scope
   Component (within ±0.5% magnitude tolerance).
3. Every PROJECT-scope Component has a matching expected entry.

**Refresh the fixture** whenever a new sandbox project ships, a
template gains a component, or an LCA window rolls — add or update the
`facilities[]` entry in `tests/fixtures/isometric-coverage.json` in the
same PR that authors the Isometric-side change.

## Prerequisites

- Isometric account with admin access to project
  `prj_1K9YJ33RKSBX9FFF` (sandbox demo).
- `.env.local` already has `ISOMETRIC_ENVIRONMENT=sandbox`,
  `ISOMETRIC_CLIENT_SECRET`, `ISOMETRIC_ACCESS_TOKEN`, and
  `ISOMETRIC_DEMO_PROJECT_ID=prj_1K9YJ33RKSBX9FFF`. Run
  `pnpm tsx scripts/isometric-smoke.ts inspect-template` to confirm
  connectivity before proceeding.

## Step 1 — Create the template

1. Open `https://registry.sandbox.isometric.com` and sign in.
2. Navigate to project `prj_1K9YJ33RKSBX9FFF` → **Removal Templates** →
   **New template**.
3. Name it `noma-mvp` (or any name; keep it short — facility settings
   reference the `rt_…` ID, not the name).

## Step 2 — Add the 4 components

For each row in the MVP table above, click **Add component**, then:

a. **CO₂ stored from biochar application** — group `co2-stored`,
   blueprint `carbon_rich_substance_sequestration`.

b. **Biomass transportation to processing site via truck** — group
   `biomass-feedstock-transport`, blueprint `transport`. Default
   display name is fine.

c. **Biochar transportation to storage site via truck** — group
   `biochar-transport`, blueprint `transport`.

d. **Sample transportation via car** — group
   `sampling-required-for-mrv`, blueprint `distance_based_ci_emissions`.

Leave all monitored inputs (carbon_content, product_mass, distance, mass)
unbound — noma supplies these as Datapoints at submit time.

## Step 3 — Pre-bind fixed constants

Each `type=fixed` input needs a Datapoint bound in the template editor.
For each fixed input below, in the template editor click **Bind
constant** → **Create new Datapoint** → enter `magnitude` + `unit` →
save → re-open the input row and select the new Datapoint.

| Component | Input | Recommended value | Source |
|---|---|---|---|
| Biomass transport via truck | `carbon_intensity` | `100` gCO2e / (tonne · km) | DEFRA / IPCC default for heavy-duty diesel truck |
| Biochar transport via truck | `carbon_intensity` | `100` gCO2e / (tonne · km) | Same |
| Sample transport via car | `carbon_intensity` | `0.171` kgCO2e / km | DEFRA average passenger car |

The CO₂ stored component (`carbon_rich_substance_sequestration`) has no
fixed inputs in the demo blueprint — verify the same is true after
creation; if any appear, bind them and update this doc.

If a verifier requests different emission factors, edit each Datapoint's
magnitude in the registry UI; the template ID stays the same.

## Step 4 — Save and link

1. Click **Save** at the top of the template editor.
2. Copy the new template ID (format `rt_…` or `rvt_…`).
3. In noma, open the facility side-sheet that's linked to
   `prj_1K9YJ33RKSBX9FFF` → **Edit Isometric mapping** → set
   **Default removal template** to the new template → save.
4. Verify via:
   ```bash
   pnpm tsx scripts/isometric-smoke.ts inspect-template
   ```
   The output should now include the new `noma-mvp` template alongside
   the existing two. All 7 monitored inputs should show `preboundDatapoint=—`;
   all 3 fixed `carbon_intensity` inputs should show `preboundDatapoint=dtp_…`.

## Step 5 — End-to-end submit

1. Open a credit batch whose facility is linked to the sandbox project
   and has the new template set as default.
2. Record transport legs:
   - For the credit batch's outbound delivery: at least one
     `entityType='delivery'` leg with `distance_km` and `load_mass_kg`.
   - For each upstream feedstock delivery: at least one
     `entityType='feedstock'` leg.
   - For at least one sample taken during the production runs: at least
     one `entityType='sample'` leg.
3. On the Certify Panel, verify the **Transport coverage** checklist
   shows ✓ for all three categories. The Submit button enables.
4. Click **Submit to Isometric**. A real Removal appears in the sandbox
   registry. The `certification_submissions` table has a row with
   `version=1`, `status='submitted'`, and `externalId=rmv_…`.
5. Re-click Submit — no-op (matched payload hash).

## Troubleshooting

- **`SafeError: No INPUT_MAPPING entry for ...`** — A blueprint or
  input on your template isn't covered in
  `src/lib/isometric/transformers/datapoint.ts`. Either remove that
  component from the template or add the entry.
- **`SafeError: ... fixed input ... without a pre-bound datapoint`** —
  Re-open the template in the registry UI and bind a Datapoint for
  every fixed input.
- **`SafeError: Aggregated source ... is null`** — The credit batch's
  upstream chain has missing data (no transport legs, no biochar mass,
  etc.). Fix the source data, not the template.

---

## Alternative — Bootstrap fixed constants on `Dark Earth removal template`

Use this path when the noma facility must submit against the broader
`Dark Earth removal template` (`rvt_1K9YK6YRQSBXFVZ0`) rather than the
minimal `noma-mvp` template. That template has **13 unbound fixed
constants** that `submitCreditBatch` will refuse to submit against.

Rather than clicking "Create new Datapoint" 13 times in the Registry UI,
run the bootstrap script and paste the resulting IDs into the template
editor.

### Step A — Create the constant Datapoints

```bash
pnpm tsx scripts/isometric-smoke.ts bootstrap-fixed-constants \
  prj_1K9YJ33RKSBX9FFF rvt_1K9YK6YRQSBXFVZ0
```

The script:

1. Reads every `type=fixed` input whose `datapoint_id` is null.
2. Looks each up in `scripts/isometric-bootstrap-constants.ts` →
   `FIXED_CONSTANT_DEFAULTS` (keyed by `${componentDisplayName}::${inputKey}`).
3. POSTs one Datapoint per input via `POST /datapoints`, reading the
   `compatible_unit` straight off the live blueprint (no hardcoded units
   in the magnitude → POST path).
4. Uses a stable `supplier_reference_id` of
   `nm-fc-<templateId>-<rtcId>-<inputKey>` so re-runs reconcile via
   `findDatapointBySupplierRef` instead of POSTing duplicates.
5. Prints a binding table of `{ status, datapoint_id, component → input }`.

### Step B — Bind in the Registry UI

1. Open `https://registry.sandbox.isometric.com` → project
   `prj_1K9YJ33RKSBX9FFF` → **Removal Templates** →
   `Dark Earth removal template` → **Edit**.
2. For each row in the script output, locate the matching component +
   fixed input, click **Bind constant** → **Select existing Datapoint**,
   and paste the `datapoint id`.
3. Save the template.

### Step C — Verify

```bash
pnpm tsx scripts/isometric-smoke.ts inspect-template prj_1K9YJ33RKSBX9FFF
```

All 13 fixed inputs on `Dark Earth removal template` should now show
`preboundDatapoint=dtp_…`. `submitCreditBatch` will get past its
fixed-input guard.

### Curated DEFRA / IPCC values

The 13 defaults are static reference data (DEFRA 2024, IPCC AR6). Source
of truth and override guidance:

| Component | Input | Default | Source |
|---|---|---|---|
| Biomass processing fuel usage | `fuel_combustion_carbon_intensity` | 2.68 kgCO2e/L | DEFRA 2024 diesel |
| Pyrolyzer electricity usage | `carbon_intensity` | 0.21 kgCO2e/kWh | DEFRA 2024 UK grid |
| Pyrolyzer CH₄ emissions | `global_warming_potential` | 27 | IPCC AR6 100-yr |
| Pyrolyzer CO emissions | `global_warming_potential` | 1.9 | IPCC AR4 indirect (no AR6 update) |
| Biochar processing electricity usage | `grid_carbon_intensity` | 0.21 kgCO2e/kWh | DEFRA 2024 UK grid |
| Biochar transport to storage (truck) | `carbon_intensity` | 0.107 kgCO2e/(tonne·km) | DEFRA 2024 HGV |
| Biochar to tractor (loader) | `emissions_factor` | 2.68 kgCO2e/L | DEFRA 2024 diesel |
| Biochar to tractor (loader) | `volume_material_per_mass` | 2.5 m³/tonne | IBI v2.1 bulk density |
| Biochar application via tractor | `fuel_combustion_carbon_intensity` | 2.68 kgCO2e/L | DEFRA 2024 diesel |
| Sampling consumables | `carbon_intensity` | **1.0** (placeholder) | **Replace before production** |
| Sample transport via car | `carbon_intensity` | 0.171 kgCO2e/km | DEFRA 2024 average car |
| Laboratory analysis electricity | `grid_carbon_intensity` | 0.21 kgCO2e/kWh | DEFRA 2024 UK grid |
| Staff travel | `carbon_intensity` | 0.171 kgCO2e/km | DEFRA 2024 average car |

Override path: edit each Datapoint's magnitude directly in the Registry
UI — the template binding survives. Do **not** add a `fixed_constants`
DB table or admin UI — the Registry UI already provides this, and
fixed constants are policy-level reference data, not noma-specific
operational data. See "What to deliberately NOT do" in
`docs/isometric/integration-plan.md` for the full rationale.

## Verifier-readiness (before production submission)

Three follow-ups gate any non-sandbox use of this template:

1. **Replace the sampling-consumables placeholder.**
   `Sampling consumables / carbon_intensity = 1.0` is a deliberate stub.
   Before production: source a real LCA value (vendor data, peer-reviewed
   study, or recognised registry industry-average), edit the bound
   Datapoint's magnitude in the Registry UI (template binding is
   preserved), and update the row in
   `scripts/isometric-bootstrap-constants.ts` so future bootstraps emit
   the right value.
2. **Validate region-specific factors.** Defaults are UK DEFRA 2024. If
   operations run elsewhere (Kenya, US, EU non-UK), expect the verifier
   to flag: grid carbon intensity (swap for host-country grid factor —
   IEA, IFI, or national agency), diesel combustion factor (generally
   close across jurisdictions but a national source is preferred),
   HGV freight factor (depends on local vehicle fleet mix). Same edit
   path as above.
3. **Resolve all zero-stubbed monitored inputs** — see
   `docs/open-questions.md` → `isometric/phase-3.7-period-inputs`. No
   template carrying a zero stub may be promoted to a production
   project.
