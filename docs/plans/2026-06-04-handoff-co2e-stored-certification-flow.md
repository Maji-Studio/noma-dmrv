# Handoff — Wire CO₂e-stored (biochar net carbon removal) into the certification flow

**Branch:** `chore/refactor-certify-flow` (1 commit ahead of origin, **unpushed**)
**Date:** 2026-06-04

## Goal

Make the per-application/credit-batch **CO₂e durably stored** figure real (today it's `null` for every non-seed record — the field is never computed; see `applications.co2eStoredTonnes`). Three work items:

1. **Move certifier selection to the facility level** via the existing `certifierProjects` table; derive `creditBatches.certifier` from it instead of choosing per batch.
2. **Wire the already-built 200-year durability calc engine** into the certification / credit-batch view, gated on the facility's certifier being Isometric — and **remove the four ungated CO₂e display surfaces from the generic application view**.
3. **Keep durability at the facility level** (`facilities.defaultDurabilityOption`) with a per-batch override retained (protocol allows per-batch tiers).

## Already done — do NOT redo

- **Protocol research is complete and grounded.** Authoritative formula pinned to *Biochar Storage in Soil Environments* **v1.2** (`docs/isometric/versions.json`): Eq.1 `CO₂e_stored = C_biochar × m_biochar × F_durable × 44.01/12.01` (§5.1.1.1); Eq.2 organic carbon = Total − Inorganic (§5.1.1.2); Eq.3 F_durable,200 with Woolf coeffs a=−0.383 b=0.350 c=−0.048, 7 °C floor, 0.95 cap (§5.1.1.3.1). Authoritative URL: https://registry.isometric.com/module/biochar-storage-soil-environments/1.2
- **Prototype engine + drift-guard tests are committed** (commit `c3e673d`): `src/lib/calculations/biochar-removal.ts` + `biochar-removal.test.ts` (11 tests, all pass via `pnpm vitest run`). Exposes `computeApplicationCo2eStored`, `computeFDurable200`, `computeCo2eStoredTonnes`, `resolveOrganicCarbonPercent` and pinned constants. **200-year only** by design; branches on `durabilityOption`.
- **1000-year path deferred** to GitHub issue **#142**: https://github.com/Maji-Studio/noma-dmrv/issues/142 (don't build it here).

## Grounded facts the plan rests on

| Concern | Reality in the schema | Ref |
|---|---|---|
| Certifier binding | `certifierProjects` binds facility→provider, unique per `(facility, provider)`. Enum `['isometric','puro_earth','verra']`. | `db/schema/certification.ts:26-33`, `common.ts:205` |
| Redundant column | `creditBatches.certifier` (text, default `'isometric'`, CHECK-constrained to isometric) — derivable from facility. | `db/schema/credits.ts:79`,`:177-179` |
| Durability default | `facilities.defaultDurabilityOption`; batch override `creditBatches.durabilityOption`. | `facilities.ts:23`, `credits.ts:92` |
| Calc inputs (drift-safe source) | Feed Corg + H/C_org from `aggregation.ts` weighted averages — the **same values submitted to Certify**, so preview can't drift from submission. Soil temp + dry mass from the application. | `lib/isometric/utils/aggregation.ts` (`weightedOrganicCarbonPercent`, `weightedHToCorgRatio`) |
| FK chain to carbon data | Application→Delivery→Order→BiocharProduct→`linkedProductionRunId`→ProductionRun→samples. `linkedProductionRunId` is **often null** → inputs missing → engine returns `null` + `missingInputs` (intended). | `db/schema/production.ts:147-221` (samples) |
| Display surfaces to REMOVE | application card `application-card.tsx:95-104`; table col + stat card `application-list.tsx:101-110` & `:291-297`; side-sheet metrics `application-list.tsx:419-428`. | — |
| Display surfaces to ADD/populate | credit-batch card `credit-batches/credit-batch-card.tsx:97-123` (already has CO₂e + net-removal slots, disabled); removal review `components/certification/removal-review/{assemble,review}-step.tsx`. Certifier is hardcoded `'isometric'` in `credit-batch-form.tsx` (~line 240). | — |

## Implementation outline (follow the project's layered checklist)

**A. Facility-level certifier**
- Add data-access helper `getFacilityCertifier(facilityId)` reading `certifierProjects.provider`.
- Credit-batch create/update: stop taking `certifier` from the form; inherit from the facility binding. Form already hardcodes isometric, so this is mostly removing the redundant input.
- Decide column fate (see open decisions).

**B. 200-year preview**
- Add `fn/` + `data-access/` that resolves engine inputs through the FK chain and calls `computeApplicationCo2eStored`. Reuse `aggregation.ts` weighted averages — don't recompute carbon independently.
- Surface the result (with breakdown + `missingInputs` "pending lab data" state) in the credit-batch detail and removal-review steps. **Gate on `getFacilityCertifier === 'isometric'`.**
- Remove the four application-view surfaces listed above.

**C. Durability**
- Ensure batch inherits `facilities.defaultDurabilityOption`; keep override. Engine already branches; 1000-year returns `null` (→ #142).

## Open decisions — get user input before coding

1. **`creditBatches.certifier` column**: drop, or keep deprecated/derived? (Project is **not live → reseed, don't migrate** — see memory `not-live-reseed-not-migrate`.)
2. **Persist `co2eStoredTonnes`** (cached batch contribution) vs **compute-on-read only**. Recommend compute-on-read — lab inputs arrive after the application is recorded.
3. Keep `applications.co2eStoredTonnes` column at all?
4. **Scope of "net removal"**: this work covers **CO₂e *stored*** only. Net removal (`stored − emissions − counterfactual`) + the 2% buffer pool (§7.1) pull in the energy-use + transportation modules — confirm whether they're in scope.

## Watch-outs (drift)

- Molar ratio must stay **44.01/12.01**, not 44/12 (engine already correct; a test locks it).
- Module pinned to **v1.2** but `how_to` flagged a **v1.3** exists → a version review is due via `docs/isometric/update-playbook.md`. Don't silently bump.
- All local protocol summaries are **non-authoritative** — verify against the registry URL before any credit-claim logic.

## Suggested skills for the next session

- **`modify-feature`** (primary) — this extends existing certification + credit-batch features; it maps the contracts that shift (certifier derivation crosses a schema/contract boundary).
- **`grill-with-docs`** — stress-test the certifier-inheritance decision against the domain model + ADRs (`docs/adr/`) before writing code; resolves open decision #1.
- Post-step reviewers once code lands: **`reviewer-contracts`** (certifier read-path change) and **`reviewer-data-integrity`** (any column drop/derive).
