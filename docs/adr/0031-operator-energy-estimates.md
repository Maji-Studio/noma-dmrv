# noma shows operator energy estimates from facility emission factors

**Status: Accepted** (2026-10-01); **estimates paused** (2026-10-16, see below). [Plan](../archive/plans/2026-10-01-energy-page.md). Amends [ADR 0018](./0018-isometric-owns-project-emissions.md) for display only.

> **Amendment 2026-10-16: estimates paused.** Kenji removed estimated CO₂e from
> the Energy page and the "Emission factors" settings section
> ([#1091](https://github.com/Maji-Studio/noma-dmrv/issues/1091)): "its just a
> hurdle that we have different numbers locally and in conjunction with
> isometric its datapoints." The page shows recorded activity only (litres,
> kWh, tonne-km), as the monthly report does, and the per-credit-batch activity
> in `buildEnergyBreakdown` stays. The bullets below about factors, estimates
> and the "est." label describe the paused design. The `facility_emission_factors`
> table stays dormant (no reader, no writer; see
> [open-questions.md](../open-questions.md#energy-estimates-paused-energyemission-factors---dormant));
> resuming means rebuilding the settings form and the read.

> **Proposed amendment 2026-10-15**: [ADR 0032](./0032-per-batch-emissions-entries-bound-to-template-lines.md)
> moves operating emissions onto Removals as per-batch emissions entries.
> Estimates stay display only. The text below stays in force until ADR 0032 is
> accepted and implemented.

Operators asked how much a credit batch, production run, delivery or application emitted. ADR 0018 keeps every emission figure in Isometric, so noma had nothing to answer with: `/energy` listed four all-time activity totals. The registry's numbers are not a substitute. They arrive per Removal, after submission, and only for what was submitted.

## Decision

- Each facility carries its own **emission factors**: kg CO₂e per litre of diesel, per kWh of grid electricity and per tonne-km of road freight, plus a source note (`facility_emission_factors`). Owners and Admins set them in Certification settings; they need no registry link. Diesel and road freight prefill with the DEFRA 2024 values the sandbox template uses; grid electricity has no default because it is country-specific.
- The energy page multiplies recorded activity by those factors and labels every result as an estimate. Without factors it shows activity only, in the units operators enter.
- Estimates never reach a submission. Isometric stays the system of record for project emissions and applies the factors bound on its own template; ADR 0018's journal removal and scope guard are unchanged.
- A missing reading stays missing. It is counted and shown, never read as zero, so totals over records with gaps are a floor. A feedstock moved partly by rail, ship, pipeline or air counts as missing too: only road freight has a factor, and pricing those legs as road would overstate them.
- Attribution follows the saved provenance: feedstock transport splits across runs by wet mass drawn, a delivery or application carries its source runs' production energy by dry mass, and transport counts the round trip ([`round-trip.ts`](../../src/lib/calculations/round-trip.ts)). The rules are in the plan.

## Consequences

- noma and Isometric can show different CO₂e for the same records. The factors differ, and the estimate covers only the six recorded sources while the registry adds project-scope components. The page marks every figure "est." and the settings section says the factors are not sent.
- `scripts/isometric-bootstrap-constants.ts` stays the registry template's source. The form prefill constants were deleted with the form on 2026-10-16.
- The old submission preview on `/energy` is gone. The Removal flow shows what is submitted.
