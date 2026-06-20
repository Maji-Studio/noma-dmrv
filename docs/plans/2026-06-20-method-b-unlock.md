# Plan: Method-B unlock + credit-batch sampling re-grain

**Date:** 2026-06-20
**Decision record:** ADR 0017 (refines ADR 0016; submission boundary per ADR 0013).
**Branch (when built):** `feat/method-b-unlock` — own branch, NOT the Tier-1 durability branch.
**Status:** Plan. Supersedes the deferred half of
`docs/archive/2026-06-19-credit-batch-lab-sampling-compliance.md` (its Phase 2 items 7–11
and the "Deferred to ADR 0017" scope).

> ⚠️ **Premise correction (2026-06-20).** ADR 0016, the archived plan, and the
> open-questions tracker all assume "DEC runs **Method A everywhere**; Method B is a
> *deferred* future unlock." DEC has since confirmed the opposite: **a process switches to
> Method B once it clears its 30-sample baseline.** Method B is the destination, not a shelf
> item. This plan therefore builds it to ship-ready depth. The schema seam laid in ADR-0016
> Phase 1 (`production_processes.{samplingMethod, establishedAt, methodBUnlockedAt}`) was
> designed for exactly this — Method B lights up without a re-model.

> ⚠️ All Isometric rules below were **verified verbatim against Biochar Protocol v1.3**
> ("Frequency of Measurement" section) on 2026-06-20 via the `isometric` MCP — not the AI
> summariser. Authoritative source: <https://registry.isometric.com/protocol/biochar/1.3>.
> Re-verify before relying for credit claims.

---

## 1. What the protocol actually requires (verified verbatim, v1.3)

| Rule | Verbatim substance | Scope |
|---|---|---|
| `G-F74T-0` (Method A baseline) | Initial sampling uses Method A (sample every batch) until **≥ 30 samples** collected; the number is "determined through consultation with Isometric, with a minimum requirement of 30 samples, **for example three replicate samples from 10 batches**." | **Production process**, per feedstock |
| `G-2W0F-0` (Method B cadence) | After the baseline, "at least once every **10 production batches**, a set of **≥ 3 samples from a single batch**" is analysed. | Production process |
| Eq 4 (unsampled estimate) | `C_biochar = μ_CC − σ_CC/√n` | "across all **eligible samples** for this production process" |
| Eq 5 (standard error) | `σ_CC̄ = σ_CC / √n_samples` | same |
| Eligible samples | "those taken in the **previous 6 months before a specific production batch was produced**… from a demonstrably stable production process (consistent temperatures + residence times)." | Production process, rolling 6-mo |
| 3σ winsorisation | Clamp any measurement beyond `μ ± 3σ_CC` to the bound; μ/σ from **historical** process measurements in the trailing 6 mo, **excluding the batch being calculated** (leave-one-out); applies **only after ≥ 30 measurements** exist; sample-stddev formula. | Production process |
| Compliance triggers → Isometric review | Within any 6-mo window: **≥ 3 missed required samplings**, OR **> 3 measurements below 3σ** from the mean. | Production process |
| New-process reset | Feedstock change, pyrolysis-condition change, or a significant (compliance-trigger) deviation → **new production process, baseline restarts from zero, no historical data carried forward.** | Production process |
| `R-ADXG-0` (moisture pathway) | Transition to Method B **forces** declaring one of three moisture pathways: (1) dry-weight every batch (volume-traceable); (2) consistent target moisture, SEM < 5 % across Method-A samples, revert-to-every-batch if it drifts; (3) moisture measured every batch. | Production process |
| `R-S8K1-1` / Random Sampling | Method B requires a random-sampling plan **agreed with Isometric and documented in the PDD.** | Project / process |

### Two windows that must never be conflated
- **Baseline counter** = eligible samples **since `established_at`** (the whole life of the
  process) → drives the ≥ 30 *unlock eligibility*.
- **Eligible-sample / "borrow" pool** = samples in the **trailing 6 months before the batch**
  → the population for Eq 4/5 + winsorisation.

A process can be unlocked (lifetime ≥ 30) yet hold *few* eligible samples (6-mo window). See
the new `CONTEXT.md` glossary term **Eligible sample**.

---

## 2. Locked decisions (this planning session, 2026-06-20)

| # | Decision | Rationale / source |
|---|---|---|
| **D1 — Compute boundary** | The **registry** computes Eq 4/5 + winsorisation. noma does **gating + submission routing + a local *preview* only** — never credit-bearing math. | **ADR 0013** ("registry-derived, not noma-asserted"; "the registry takes the mean or Winsorized mean + SE"). The handoff's "noma builds the unsampled estimate" was wrong against 0013. |
| **D2 — Borrow-pool scope** | The eligible-sample pool is the **production process** (noma's `(facility, feedstock)` row), trailing 6 mo. The "facility vs reactor" open question is **dissolved** — the protocol fixes it, and per D1 noma never *asserts* a pooling choice for crediting anyway. | Verbatim Eq 4 scope. |
| **D3 — Unlock model** | **Eligible-then-unlock.** At ≥ 30 eligible samples a process surfaces as *eligible*; a deliberate **unlock action** flips `samplingMethod`→`method_b` and stamps `methodBUnlockedAt`. The action **captures** (a) the agreed baseline number (≥ 30, Isometric-negotiable; default 30, editable), (b) a random-sampling-plan reference, (c) the moisture pathway. | Protocol: 30 is necessary-not-sufficient (Isometric consultation + random plan + `R-ADXG-0`). The seam is a *timestamp* because the switch carries state a count can't. |
| **D4 — Who unlocks** | **Facility managers (DEC) may unlock**, not super-admin only. Guardrail = the mandatory prerequisite captures (D3) + the explanation surface (D5), which force acknowledgement that the Isometric agreement is in place. | DEC operating choice (2026-06-20). |
| **D5 — UI explanation** | A **persistent explanation surface** states *why* the three prerequisites exist (cited to the protocol) and that they apply **because Isometric is the verifier**. Shown only when `certifier = 'isometric'`. | DEC request; consistent with ADR-0016 registry-conditional gates. |
| **D6 — Carbon drift / 3σ** | noma **surfaces + warns + tracks** (the two compliance counters) but **never auto-creates** a new process. The **registry is the detector of record** (it has the raw samples per D1). A new production process is a **deliberate human action** that resets the baseline → back to Method A re-sampling. | DEC instinct confirmed: "Isometric would be realising this; we should let know." |
| **D7 — Moisture** | Pathway (3) **measure every batch** — noma **already records** `production_runs.biochar_moisture_percent` → `biochar_dry_mass_kg`. Build = record the *declared pathway* on the process at unlock. The SEM-monitored consistent-moisture pathway is **out of scope**. | DEC choice (2026-06-20); existing capture. |
| **D8 — Unsampled routing** | Under Method B, an unsampled batch routes to the **`biochar_sequestration_200_year_unsampled`** blueprint instead of being skipped (today `buildDurabilityMeasurementSampleSubmissions` does `if (!body) continue`). The **exact `_unsampled` wire-format** (mass-only row vs. registry-derives-from-history) is a **sandbox confirm**, folded into the existing `DURABILITY_MEASUREMENT_SAMPLES_LIVE` gate + `isometric:coverage-check`. | ADR 0013 A0 resolution; the seam (`SEQUESTRATION_BLUEPRINT_UNSAMPLED`, `selectSequestrationBlueprintKey`) already exists. |

---

## 3. What ADR-0016 Phase 1 + Tier-1 already shipped (do NOT rebuild)

The archived plan listed Phases 1–4; much has landed. Confirmed live 2026-06-20:

- ✅ `production_processes` table + `(facility, feedstock)` keying + `samplingMethod` (moved off
  reactors) + `establishedAt` + `methodBUnlockedAt` seam. (ADR-0016 Phase 1, PR #294, `dde0c8e`.)
- ✅ `credit_batches.feedstock_type_id` + `production_process_id`; `samples.credit_batch_id`;
  single-feedstock invariant; ≤ 1-month Isometric cap; reactor trigger `0052` dropped (migration
  `0057`).
- ✅ **Per-credit-batch measurement-sample submission** — `buildDurabilityMeasurementSampleSubmissions`
  already POSTs **one `biochar_production_batch` per sampled credit batch** (H/C + carbon + mass,
  mean ± std-dev) + one `biochar_soil` facility-reference sample. **Archived Phase 3 (item 12) is
  done.** It already *anticipates* the unsampled case (skips it) — D8 just wires the route.
- ✅ The unsampled blueprint constants + `selectSequestrationBlueprintKey` (throws for non-Method-B
  today — D8 makes `_unsampled` reachable).

**Still run/reactor-grained → this plan's Track 1.**

---

## 4. Track 1 — Re-grain the sampling/eligibility layer (Method-A-safe, ships first)

Closes a **latent cross-feedstock over-credit bug** (today a reactor's hardwood samples wrongly
count toward a softwood batch's Method-B eligibility) and finishes the mid-migration enforcement
model. Entirely dormant-safe under Method A (it changes *grain*, not *behaviour*, while every
batch is sampled). **No dependency on the unlock** — buildable and shippable on its own.

1. **`getMethodBEligibilityByReactor` → `getMethodBEligibilityByProcess`**
   (`src/data-access/isometric.ts`). Count **eligible samples (replicates)** in the production
   process **since `established_at`**, ≥ 30 → eligible. Replace the reactor join with the
   process→credit-batch→samples path. Re-point callers `validateReactorSamplingMethodFn` →
   `validateProcessSamplingMethodFn` (`src/fn/isometric.ts`); keep a back-compat alias one release.
2. **`sampling-requirements.ts` — unit run → credit batch.** `deriveSamplingRequirement` operates
   on **credit batches**, not runs. Method A = every credit batch sampled; **≥ 3 replicates per
   *credit batch*** (distributed across runs/days), fixing the stale per-*run* `MINIMUM_REPLICATES_PER_RUN`
   check (today it over-requires sampling). Method-B branch `ceil(N_batches / 10)` per process —
   scaffolded but inert until the unlock flips the method.
3. **Cadence constants** (`src/config/certification.ts`): `METHOD_B_SAMPLING_CADENCE_RUNS` →
   `…_CADENCE_BATCHES`; any `…_PER_RUN` → `…_PER_BATCH`. Update the doc-comments still citing
   `getMethodBEligibilityByReactor`.
4. **`durability-submission-gates.ts`** — confirm the gate reads at credit-batch grain (PR #296 may
   already have moved it; verify and finish).
5. **Process operator surface (read-only under Method A)** — a production-process view showing each
   process, its `samplingMethod`, baseline progress (**N / 30 eligible samples**), and the cadence
   status. This is the surface Track 2's unlock CTA and Method-B signals attach to.

---

## 5. Track 2 — Method-B unlock (ADR 0017), the live compute

Build when the first process nears 30 eligible samples. Each item maps to a locked decision.

1. **Eligibility signal** — derive "process is Method-B-eligible" from
   `getMethodBEligibilityByProcess ≥ baselineTarget` (default 30). Surface on the Track-1 process
   view. *(D3)*
2. **Unlock flow + prerequisite captures** — a facility-manager action that, when
   `certifier = 'isometric'`, opens a dialog capturing: agreed baseline number (default 30,
   editable), random-sampling-plan reference (note/doc), moisture pathway (default "measure every
   batch"). On submit: stamp `methodBUnlockedAt`, flip `samplingMethod`, persist the captures
   (new nullable columns on `production_processes`: `agreed_baseline_size`,
   `random_sampling_plan_ref`, `moisture_pathway`). *(D3, D4, D7)*
3. **Explanation surface** — persistent, protocol-cited copy on the unlock dialog + process view,
   shown only under Isometric. *(D5)*
4. **Cadence go-live** — the `deriveSamplingRequirement` Method-B branch becomes enforced once
   `samplingMethod = method_b`: gate requires ≥ 1 sampled batch per 10 per process. *(per protocol
   `G-2W0F-0`)*
5. **Unsampled submission routing** — in `buildDurabilityMeasurementSampleSubmissions`, route an
   unsampled Method-B batch to `_unsampled` rather than skipping. **Gate the live POST behind the
   existing `DURABILITY_MEASUREMENT_SAMPLES_LIVE` flag** and resolve the exact `_unsampled` body via
   `pnpm isometric:coverage-check -- --source=db` before flipping. *(D1, D8)*
6. **Local preview engine** — a pure `previewUnsampledCarbon(process, asOfBatchDate)` = `μ − σ/√n`
   over **eligible** samples (trailing 6 mo, same process), **labelled non-authoritative**, mirroring
   `computeFDurable200`'s role. Surfaced on the process / unsampled-batch view with its *freshness*
   (eligible-sample count + window) so DEC sees what a batch will credit at. **Never** submitted. *(D1, D6)*
7. **Drift + compliance surfacing** — track the two trailing-6-mo counters (missed required
   samplings; measurements below 3σ) and warn when either approaches the protocol trigger. **No
   auto-action.** A "start new production process" affordance (manual, confirmed) resets the
   baseline. *(D6)*
8. **Process-grain enforcement backstop** — replace the dropped reactor trigger `0052` with a
   **process-grain** guard preventing `samplingMethod → method_b` before ≥ 30 eligible samples.
   **Recommendation:** app-layer guard (in the unlock fn) as primary, plus a lightweight DB
   `CHECK`/trigger backstop. **Hand-write** the trigger migration (db:generate can't emit triggers);
   new migration, never edit applied ones; no prod data → reseed. *(per repo trigger-migration convention)*

---

## 6. Out of scope / deferred

- The **SEM < 5 % consistent-target-moisture** pathway (`R-ADXG-0` option 2) — only if DEC later
  wants to measure moisture less often.
- **Auto-new-process** on 3σ drift (D6 keeps it human-confirmed).
- **Consistent-blend** feedstock as a process feedstock — until a real blend appears (current
  single-feedstock-per-run invariant holds).
- **1000-year** durability (ADR 0013 scope note).

## 7. Coordination & sequencing

- **Issue #291 (template-driven remodel)** shares the measurement-sample submission path —
  sequence so the `_unsampled` routing (D8) isn't double-built.
- **Order:** Track 1 first (Method-A-safe, fixes the latent bug, no unlock dependency) → Track 2
  before the first process hits 30. The live registry POST for unsampled batches stays behind the
  existing live-flip + the two sandbox confirms already gating Tier-1.
- **Docs on landing:** remove the `certification/credit-batch-sampling-phases` open-questions entry
  piecewise as each track lands; record in `docs/isometric/changes.md`; update the ADR-0016 "Scope"
  section's "deferred to ADR 0017" lines to "shipped in ADR 0017."

## 8. Tests

- Track 1: `getMethodBEligibilityByProcess` counts per process since `established_at` (cross-feedstock
  isolation — the bug regression test); ≥ 3 replicates judged **per credit batch** not per run;
  cadence-constant rename coverage.
- Track 2: unlock captures persisted + `methodBUnlockedAt` stamped + method flipped; eligibility
  signal at the boundary; Method-B cadence gate (`ceil(N/10)`); `previewUnsampledCarbon` over a
  6-mo window with leave-one-out; unsampled-batch routes to `_unsampled` (mocked POST behind the
  flag); compliance-counter warnings; the process-grain backstop rejects an under-baseline flip.
- E2E (@live, nightly): a process accumulates 30 samples → unlock → a later batch left unsampled →
  submit routes `_unsampled`.
