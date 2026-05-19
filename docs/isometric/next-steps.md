# Next steps — after Dark Earth fixed-constant bootstrap

Sequenced actions after running
`scripts/isometric-smoke.ts bootstrap-fixed-constants` on
`Dark Earth removal template` (`rvt_1K9YK6YRQSBXFVZ0`).

Status legend: 🔴 blocking next submit · 🟡 do before production · 🟢
follow-up / nice-to-have.

## 1. Sandbox unblock (this PR's outcome)

🔴 **Bind the 13 Datapoints in the Registry UI.** The script POSTed the
Datapoints, but Certify will not consume them until each is selected as
the bound value for its fixed input. Walkthrough:
`docs/isometric/sandbox-template-authoring.md` →
"Alternative — Bootstrap fixed constants on Dark Earth removal template"
→ Step B.

The 13 Datapoints are already created on sandbox project
`prj_1K9YJ33RKSBX9FFF` (verified 2026-05-13, magnitudes/units converged
via PATCH). Open
`https://registry.sandbox.isometric.com` → project →
`Dark Earth removal template` (`rvt_1K9YK6YRQSBXFVZ0`) → **Edit**,
then for each row below click the fixed input → **Bind constant** →
**Select existing Datapoint** → paste the matching `dtp_…` ID → save
the template at the end.

| Datapoint ID | Component | Input |
|---|---|---|
| `dtp_1KRHK3F18SBXZGFA` | Biomass processing fuel usage | `fuel_combustion_carbon_intensity` |
| `dtp_1KRHK3FGBSBX6T6M` | Pyrolyzer electricity usage | `carbon_intensity` |
| `dtp_1KRHK3FYCSBXE3XY` | Pyrolyzer CH₄ emissions | `global_warming_potential` |
| `dtp_1KRHK3GDHSBXNDN8` | Pyrolyzer CO emissions | `global_warming_potential` |
| `dtp_1KRHK3GS7SBXWQCJ` | Biochar processing electricity usage | `grid_carbon_intensity` |
| `dtp_1KRHK3HDTSBX413W` | Biochar transportation to storage site via truck | `carbon_intensity` |
| `dtp_1KRHK3HSDSBXBAV6` | Biochar transportation to tractor via loader | `emissions_factor` |
| `dtp_1KRHK3J3VSBXJMJG` | Biochar transportation to tractor via loader | `volume_material_per_mass` |
| `dtp_1KRHK3JF2SBXSY9T` | Biochar application via tractor | `fuel_combustion_carbon_intensity` |
| `dtp_1KRHK3JT2SBX1814` | Sampling consumables | `carbon_intensity` |
| `dtp_1KRHK3K4DSBX8HRE` | Sample transportation via car | `carbon_intensity` |
| `dtp_1KRHK3KHZSBXFVFR` | Laboratory analysis electricity use | `grid_carbon_intensity` |
| `dtp_1KRHK3KX2SBXQ572` | Staff travel | `carbon_intensity` |

If any ID changes (e.g., the sandbox project is rotated), re-run
`pnpm tsx scripts/isometric-smoke.ts bootstrap-fixed-constants prj_1K9YJ33RKSBX9FFF rvt_1K9YK6YRQSBXFVZ0`
to print the current set.

🔴 **Reseed local DB.** Run `pnpm db:reset` to wipe noma's DB and re-seed
with the 13 prerequisite entities. Required because the existing seeded
facility / credit batch may have stale `defaultRemovalTemplateId` or
submission rows from earlier failed attempts.

🔴 **Re-link the facility.** In the noma UI, open the seeded facility's
side sheet → **Edit Isometric mapping**:

- Set **External project** = `prj_1K9YJ33RKSBX9FFF`
- Set **Default removal template** = `Dark Earth removal template`
  (the dropdown shows `rvt_1K9YK6YRQSBXFVZ0`)
- Save.

🔴 **Record transport legs.** On the credit batch's chain, ensure at
least one leg per category:

- `entityType='feedstock'` on each upstream feedstock with `distance_km`
  and `load_mass_kg`.
- `entityType='biochar'` on each biochar product (truck to storage).
- `entityType='sample'` on at least one sample (car to lab).

The Certify Panel's "Transport coverage" checklist should show ✓✓✓.

🔴 **Submit.** Click **Submit to Isometric**. Expected: sync log shows
N datapoint POSTs + 1 removal POST, and `certification_submissions`
gets a new row with `version=1`, `status='submitted'`,
`externalId=rmv_…`.

## 2. Verifier-readiness (before production)

🟡 **Replace the sampling-consumables placeholder.** The script seeds
`Sampling consumables / carbon_intensity = 1.0 kgCO2e/unit` as a
deliberate placeholder. Before any production submission:

1. Source a real LCA value (vendor data, peer-reviewed study, or
   industry-average from a recognised registry).
2. Edit the corresponding Datapoint's magnitude in the Registry UI
   (template binding is preserved).
3. Update the row in `scripts/isometric-bootstrap-constants.ts` and the
   table in `docs/isometric/sandbox-template-authoring.md` so future
   bootstraps emit the right value.

🟡 **Validate region-specific factors.** The defaults are UK DEFRA 2024.
If noma's operations are in a different jurisdiction (Kenya, US, EU
non-UK), the verifier will likely flag:

- Grid carbon intensity (currently 0.21 kgCO2e/kWh — UK average) — swap
  for the host country's grid factor (e.g., IEA, IFI, or national
  emissions agency).
- Diesel combustion factor (2.68 kgCO2e/L) — generally close across
  jurisdictions but verifier may prefer a national source.
- HGV freight factor — depends on vehicle fleet mix; DEFRA's articulated
  HGV may not match local trucks.

Process: same as sampling — edit in Registry UI + sync the script.

🟡 **Resolve the 5 zero-stub monitored inputs** before promoting the
template to a production project. Tracked under
`isometric/sandbox-zero-stubs` in `docs/open-questions.md`:

- `direct-emissions / ghg_direct_emissions / concentration` (CH4, CO)
- `direct-emissions / ghg_direct_emissions / mass_flow` (CH4, CO)
- `biochar-storage / fuel_usage_by_volume / volume_of_fuel`
- `sampling-required-for-mrv / grid_electricity_use / electricity_use`
- `staff-travel / distance_based_ci_emissions / distance`

Each currently emits `0` with the correct quantity_kind. Replace once
the source data lands (per-run electricity readouts, per-run GHG
concentrations, etc.).

## 3. Process hygiene

🟢 **Migrate the Isometric MCP URL.** The deprecated token-URL method
(`https://api.isometric.com/mcp/?token=…`) is removed **2026-05-15**.
Switch to `https://api.isometric.com/mcp` with Certify/Registry
account sign-in. Verify with `mcp__claude_ai_isometric__me`. Tracked
under `isometric/mcp-auth` in `docs/open-questions.md`.

🟢 **Document per-Datapoint sources.** Once the documents subsystem has
a real S3-equivalent backend, swap `source_ids: []` for a real source
attachment per Datapoint. The bootstrap script and the main
`submitCreditBatch` flow both currently POST with empty source_ids —
sandbox-acceptable, production-blocked. Tracked under
`isometric/phase-3.5` in `docs/open-questions.md`.

🟢 **Webhook reconciliation.** Once Isometric publishes a webhook event
schema, build the `/api/certification/webhook` route to reconcile
state automatically rather than relying on the manual "Refresh" button.
Tracked under `isometric/phase-5` in `docs/open-questions.md`.

## 4. Things deliberately NOT to do (overengineering tripwires)

These have been considered and rejected. Re-justify before reopening.

🚫 **Do NOT add a `fixed_constants` DB table.** The 13 values are
policy-level reference data, not noma-specific operational data. A
table would add a migration, a CRUD layer, an admin UI, and ongoing
maintenance for ~zero workflow benefit.

🚫 **Do NOT add an admin UI for editing emission factors.** The
Registry UI already provides this (edit the Datapoint's magnitude).
Duplicating it in noma would force admins to keep two values in sync.

🚫 **Do NOT make `submitCreditBatch` aware of fixed constants.** Fixed
constants are consumed Certify-side from the template binding; they
do not flow through noma's payload. Keep the orchestrator's
fixed-input guard as a hard pre-flight check, not a fallback creator.

🚫 **Do NOT auto-bind on the template via API.** The Certify API has
no template-mutation endpoint by design — templates are author-time
artefacts. Wrapping the manual UI step in our own automation would
require reverse-engineering an undocumented endpoint.

🚫 **Do NOT extend `FIXED_CONSTANT_DEFAULTS` to cover monitored
inputs.** Monitored inputs flow through `INPUT_MAPPING` and the
aggregation pipeline. They are conceptually different (per-removal,
sourced from noma data) and the two systems should remain separate.

## Verification checklist (paste into PR description)

- [ ] `pnpm tsx scripts/isometric-smoke.ts bootstrap-fixed-constants prj_1K9YJ33RKSBX9FFF rvt_1K9YK6YRQSBXFVZ0` exits 0 with 13 `created` rows
- [ ] Re-run shows 13 `existing` rows (idempotency)
- [ ] Registry UI: all 13 fixed inputs on Dark Earth show a bound Datapoint
- [ ] `pnpm tsx scripts/isometric-smoke.ts inspect-template prj_1K9YJ33RKSBX9FFF` shows 0 unbound fixed inputs on Dark Earth
- [ ] `pnpm db:reset` succeeds
- [ ] noma UI: facility linked, transport legs recorded, Certify Panel checklist green
- [ ] **Submit to Isometric** succeeds, `certification_submissions` row reaches `status='submitted'`
- [ ] Re-clicking Submit is a no-op (hash match)
- [ ] `pnpm typecheck` and `pnpm lint` clean
