# Plan: align lab-sampling to the protocol's Production Batch unit

**Date:** 2026-06-19
**Status:** Draft — modelling decision RESOLVED (§5): the **Credit Batch is the sampling/batch unit**, capped at ≤ 1 month when the certifier is Isometric.
**Owner:** —
**Branch:** TBD (`feat/credit-batch-sampling-unit` — do **not** build on the transport-evidence branch)

> ⚠️ All Isometric summaries below are **non-authoritative**. Verify against:
> - Protocol §8.3.1 — https://registry.isometric.com/protocol/biochar/1.3
> - Measurement samples — https://docs.isometric.com/user-guides/certify/measurement-samples
> - Field measurements — https://docs.isometric.com/user-guides/certify/field-measurements
> - GHG entries — https://docs.isometric.com/user-guides/certify/ghg-entry

---

## 1. Problem

Operationally, formal lab characterisation of biochar is done **per credit-batch period (≈ a protocol Production Batch)** — one lab set (Method B) or every batch (Method A) — and the **in-process production-run samples are internal telemetry only**. Our code instead assumes **production run = Production Batch**: it requires a lab sample per *run*, counts Method A/B cadence in *runs*, and gates ≥3 replicates per *run*. That's finer-grained and stricter than the protocol requires, and it has no explicit "Production Batch" unit between the run and the credit batch.

## 2. Compliance verdict — **yes, we can comply** (and the operational model is the protocol-correct one)

Confirmed against biochar protocol v1.3 §8.3.1 and the Certify data model:

- **The sampling unit is the Production Batch**, not the physical run. A Production Batch is a project-defined period **< 1 month** (< 7 days with combustion co-products), single feedstock / consistent blend, consistent pyrolysis conditions. It may span multiple runs.
- **A *measured* batch needs ≥ 3 independent lab samples** (spatially/temporally spread, each analysed individually) — **under both Method A and Method B**. The A/B difference is *frequency*, not replicate count:
  - **Method A** — measure every batch. Required until ≥ 30 samples banked (e.g. 3 × 10 batches).
  - **Method B** — after that baseline, measure **≥ 1 batch per 10**; unsampled batches get the conservative estimate `C = μ_CC − σ_CC/√n` from the trailing 6 months.
  - → The "1 (Method B) or 3 (Method A) lab samples per credit-batch period" framing maps to **how many *measured batches* fall in a period**, not a per-batch replicate cap. A measured batch is always ≥ 3 replicates.
- **In-process run samples are explicitly not crediting-eligible** — must be formal lab samples of the final pre-storage biochar. Matches "internal use only." ✓ (Decision: keep `productionSamples` internal — never submitted.)
- **Mass-weighted averaging is the sanctioned roll-up.** A Storage Batch (biochar stored/blended together = our **Credit Batch**) takes the **mass-weighted average of carbon content across its constituent Production Batches** (Equation 3). Certify GHG-entry boundaries are free-form (a continuous process may report weekly totals as one entry; one statement holds many entries with attribution factors).

### 2b. Answering "is averaging across credit batches for a GHG entry OK?"
Yes, with one precision: the average must be the **mass-weighted average across Production Batches** within the storage/credit batch (Eq.3) — not a naïve unweighted mean — and it must trace to **production-batch lab samples**, not in-process run samples. A single GHG entry may span multiple credit batches; attribution factors handle a component split across entries. Our `weightedOrganicCarbonPercent` already implements the mass-weighted form; the gap is the *unit it averages over* (runs vs batches) and how it treats unsampled Method B batches.

## 3. Certify data-model facts that constrain the design

- Biochar measurement-sample types: **`Production batch`** (→ CDR **quantification**: Total Carbon, H:C `HYDROGEN_TO_ORGANIC_CARBON_RATIO`, Fixed Carbon, Total Inorganic Carbon, …), **`Pyrolysis reactor`** (→ monitoring), **`Soil`** (required only for 200-yr+ durability). Production-batch + reactor samples are required for all biochar projects.
- A measurement sample carries **many** measured properties at once (vs a datapoint = one value); keyed to a measurement location + date.

## 4. Current state (what diverges) — file map

| Concern | File | What it does today | Issue |
|---|---|---|---|
| Lab samples | `src/db/schema/production.ts:154` (`samples`) | FK `productionRunId`; full carbon chemistry (TC, OC, IC, H/C_org, O/C_org, R₀, …) | Attached to **run**, not a batch |
| In-process samples | `src/db/schema/production.ts:270` (`productionSamples`) | Run telemetry (fixed C, volatile matter, ash) | Correctly separate; keep internal ✓ |
| Cadence engine (D6) | `src/lib/certification/sampling-requirements.ts` | `deriveSamplingRequirement` counts **runs**; Method A = every run, Method B = `ceil(N_runs/10)` | Wrong unit (runs, not batches) |
| Submission gates (D3) | `src/lib/certification/durability-submission-gates.ts` | ≥3 replicates **per run**; Method A presence per run; Method B cadence per run | Wrong unit; over-strict |
| Cadence constant | `src/config/certification.ts:20` | `METHOD_B_SAMPLING_CADENCE_RUNS = 10` | Rename → `_BATCHES` |
| Carbon aggregation | `src/lib/isometric/utils/aggregation.ts:164` | Mass-weighted mean over runs **with samples**; unsampled runs drop out | Method B unsampled batches get **no carbon + no conservative estimate** |
| Credit-batch preview | `src/data-access/credit-batches.ts:200` (`buildCo2eStoredPreview`) | Pulls runs via chain of custody, mass-weights C, computes per-application CO₂e | Inherits the unit + unsampled-batch gaps |
| Credit batch ↔ runs | `src/db/schema/credits.ts:35` | Linked only via Application→Delivery→BiocharProduct→Run chain | No explicit production-batch grouping |
| Isometric measurement samples | `src/lib/isometric/measurement-samples.ts` | `production-batch` role keyed per **run** | Re-key to the batch |

## 5. Core design decision — RESOLVED

**The Credit Batch *is* the protocol batch unit** (decided by user 2026-06-19): one credit batch holds **multiple production runs within a ≤ 1-month window**, and is the unit that is lab-characterised and quantified. We do **not** add a separate `production_batches` entity.

Concretely:
- A **credit batch** = the sampling/quantification batch. Its `startDate`..`endDate` window must be **≤ 1 month when `certifier = 'isometric'`** (new hard constraint — see Phase 1). The window plays the role of the protocol's Production Batch period (§8.3.1: "less than one month").
- Formal lab **`samples` stay attached to runs** (we already have them) and are **aggregated at the credit-batch level** — the credit batch's set of sampled runs *is* its lab characterisation.
- **≥ 3 lab replicates per *measured credit batch*** (across its runs) — **not** per run. This is the relaxation that matches "1 (Method B) or 3 (Method A) lab samples per credit-batch period."
- **Method A** = every credit batch is lab-sampled (≥ 3 across its runs). **Method B** = ≥ 1 sampled credit batch per 10; unsampled credit batches use the conservative estimate (`μ_CC − σ_CC/√n`). Cadence is counted in **credit batches**, grouped per production process (reactor + feedstock).
- **In-process `productionSamples` stay on the run, internal only**, never submitted (confirmed).
- Carbon content = **mass-weighted average across the credit batch's runs** (Eq.3), already implemented; the gap is Method B unsampled handling + that gating moves off the run.

Rejected alternative (explicit `production_batches` table grouping runs) — heavier, and unnecessary now that the credit batch carries the ≤ 1-month period. Revisit only if one credit batch must blend several *distinct production processes* that each need independent sampling (then the credit batch is a Storage Batch of multiple Production Batches and we'd reintroduce the sub-unit).

### New requirement surfaced by this decision
**A credit batch with `certifier = 'isometric'` must not span more than 1 month.** Enforce at three layers: Zod form schema (calendar-month check via date-fns), server validation in the credit-batch fn, and a DB backstop. This is the concrete fix behind "we need to set it up that we can't go longer than 1 month if Isometric is chosen."

> **Edge case to confirm during build:** a credit batch whose runs come from **multiple reactors** (different `samplingMethod`s) — cadence is per production process (reactor + feedstock), so a mixed-reactor credit batch needs the cadence grouped by reactor within the batch. Default assumption: one credit batch ≈ one reactor's output for the period.

## 6. Phased implementation (Credit Batch = batch unit)

### Phase 1 — enforce the ≤ 1-month credit-batch window (Isometric)
1. **Zod** (`src/schemas/` credit-batch form/action schema): when `certifier === 'isometric'`, `superRefine` that `endDate − startDate ≤ 1 calendar month` (date-fns `isAfter(endDate, addMonths(startDate, 1))` → error on `endDate`). Reuse `optionalDateOnly` helpers.
2. **Server** (`src/fn/` credit-batch create/update): re-validate the same rule before persist; return `ActionResult` error.
3. **DB backstop** (`src/db/schema/credits.ts`): add a `check` constraint — `certifier IS DISTINCT FROM 'isometric' OR (end_date - start_date) <= 31` (conservative day-count backstop; the app layer enforces the precise calendar month). `pnpm db:generate`.
4. UI: surface the limit on the credit-batch form (InfoHint) and a clear inline error.

### Phase 2 — move the sampling unit from run → credit batch
5. `sampling-requirements.ts`: reframe `deriveSamplingRequirement` to operate over **credit batches** (per production process = reactor + feedstock). Method A = every credit batch sampled; Method B = `ceil(N_creditBatches / 10)`. `RunSampling` → `BatchSampling { creditBatchId, sampledRunCount, replicateCount }`.
6. `durability-submission-gates.ts`: ≥ 3 replicates **per measured credit batch** (sum across its sampled runs, complete-chemistry replicates); Method A presence = the credit batch has a lab set; Method B cadence per production process. Eligibility (H/C_org < 0.5, O/C_org < 0.2) judged on the **credit-batch mass-weighted mean** (D8), not per run.
7. `config/certification.ts`: `METHOD_B_SAMPLING_CADENCE_RUNS` → `METHOD_B_SAMPLING_CADENCE_BATCHES` (value 10); `MINIMUM_REPLICATES_PER_RUN` → `MINIMUM_REPLICATES_PER_BATCH` (keep 3).
8. Update readiness facts + reactor/removal readiness UI strings (run → credit batch).

### Phase 3 — carbon aggregation + Method B conservative estimate
9. `aggregation.ts`: keep the mass-weighted average across the credit batch's runs (Eq.3); add the **Method B conservative estimate** `C = μ_CC − σ_CC/√n` for **unsampled credit batches**, drawing eligible samples from the trailing 6 months of the same production process (today unsampled mass silently drops — protocol wants it credited at the conservative value). Add trailing-window + "stable process" selection.
10. `credit-batches.ts` `buildCo2eStoredPreview`: unchanged structurally (already credit-batch-scoped); feed it the new unsampled-batch path.

### Phase 4 — Isometric submission mapping
11. `measurement-samples.ts`: key the Certify **`Production batch`** measurement sample to the **credit batch** (one per measured credit batch), carrying H/C + Total/Inorganic Carbon from the batch's mass-weighted lab set. Update the reference scheme (`-pb-` segment → credit batch).
12. Add a test asserting `productionSamples` (in-process) is **never** mapped to any Certify measurement sample.

### Phase 5 — migration triggers, docs, tests
13. Re-point hand-written trigger migrations `0052` (Method B 30-sample baseline) / `0053` (200-yr completeness) from the per-run model to the credit-batch model (new migration + journal + snapshot — never edit applied migrations; probe with rolled-back psql txns).
14. Update `docs/isometric/{requirements-shortlist,condition-registry,schema-mapping}.md` + append `docs/isometric/changes.md` (unit run→credit-batch; ≤ 1-month window; conservative-estimate add). Update `CONTEXT.md` if "Credit batch" / "Production batch" definitions shift.
15. Reseed (`seed-chain-data.ts`) so seeded runs roll into ≤ 1-month credit batches with a lab set. Tests: ≤ 1-month enforcement (Isometric vs non-Isometric), cadence-in-credit-batches, ≥ 3-per-measured-batch, Method B unsampled → conservative estimate, mass-weighted average, in-process-samples-never-submitted guard. E2E: build a multi-run credit batch within a month, attach lab samples, submit.

## 7. Risks / watch-items
- **No new entity** (Option B) keeps chain-of-custody untouched — the credit-batch ↔ runs path already exists via Application→Delivery→BiocharProduct→Run. The sampling logic just changes the *grouping key* (run → credit batch).
- **Method B conservative estimate** is new math — needs its own unit tests and a documented trailing-6-month eligibility window + "stable production process" guard.
- **Reactor `samplingMethod` is the source of truth** (D6 derive). A credit batch may draw from multiple reactors → cadence must group by production process (reactor + feedstock) *within* the batch (see §5 edge case).
- **≤ 1-month constraint precision:** the DB `check` is a coarse day-count backstop (≤ 31); the precise calendar-month rule lives in Zod/server. Document that the backstop is intentionally conservative.
- Migration triggers `0052` (Method B 30-sample baseline) / `0053` (200-yr completeness) reference the per-run model — re-point to the credit-batch model with a **new** hand-written trigger migration (never edit applied migrations; probe with rolled-back psql txns — see memory).
- **Existing credit batches** (seed/dev only — no prod data) may exceed 1 month; reseed rather than migrate data.

## 8. Out of scope
- 1000-year (R₀/TGA) durability pathway changes beyond moving its inputs to the batch unit.
- Pyrolysis-reactor **monitoring** measurement-sample submission (separate gap; in-process samples remain internal for now — revisit later).
- GHG-entry boundary automation (entries can already span credit batches via attribution).
