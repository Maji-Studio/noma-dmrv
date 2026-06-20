# Plan: credit batch = production batch; a production process scopes sampling

**Date:** 2026-06-19
**Decision:** ADR 0016 (refines ADR 0014; this plan is its implementation shape). Submission path per ADR 0013.
**Branch:** `feat/credit-batch-production-process` (own branch — NOT transport-evidence).
**Status:** Archived implementation plan. ADR 0016 is the current decision record.

> ⚠️ Isometric rules below are our reading of Biochar Protocol **v1.3 §8.3.1**
> (https://registry.isometric.com/protocol/biochar/1.3), with the production-process /
> Method A-B facts **verified verbatim 2026-06-19**. Re-verify before relying for credit claims.

## What & why (one paragraph)

The protocol's sampling unit is a **production batch** = one feedstock under consistent
conditions, < 1 month. noma's **credit batch** becomes exactly that (carries a feedstock,
capped ≤ 1 month under Isometric, several concurrent). Sampling *frequency* (Method A/B) and
the 30-sample baseline live on a new **`production_processes`** campaign entity keyed
**(facility, feedstock)** — which, per the protocol, **spans reactors** (reactor identity is
not part of the process boundary). Lab **Samples** attach **per credit batch**. DEC runs
**Method A everywhere** today; Method B is a future super-admin unlock, so this plan ships the
*structure* + *Method-A behaviour* and **defers the live Method-B compute** (see Scope). ADR
0016 has the rationale and the verified protocol citations.

## Design invariants (from ADR 0016 / 0014 / 0013)

- Credit batch = **one feedstock**, facility-scoped, ≤ 1 month under Isometric = the protocol
  production batch. Membership stays **production runs** (ADR 0014), each run matching the
  batch's feedstock; a run blending >1 feedstock *type* fails a loud assertion.
- `production_processes` keyed **(facility, feedstock)**, spans reactors; **registry-agnostic**,
  with Isometric rules (≤1-month, 30-sample baseline, Method-B unlock, unsampled estimate) as
  **conditional gates** fired only when `certifier='isometric'`. New process on feedstock /
  pyrolysis-condition / 3σ-deviation change.
- Lab **Samples** attach **per credit batch** (`samples.creditBatchId`), ≥ 3 per *sampled*
  batch. In-process `production_samples` stay on the run, internal-only.
- **Submission per ADR 0013:** per-credit-batch H/C_org datapoint list → registry aggregates &
  computes `F_durable`. noma's mass-weighted average is **preview only**.
- No prod data → reseed, not migrate. Never edit applied migrations.

## Scope — ships now vs deferred

- **Ships now (structure + Method-A):** `production_processes` entity + keying;
  `sampling_method` moved off reactors; `credit_batches.feedstockTypeId` + `productionProcessId`;
  ≤1-month Isometric cap; `samples` → credit batch; ≥3-per-sampled-batch characterisation;
  per-process grouping; per-credit-batch submission datapoint (Method A → every batch sampled).
- **Deferred to the Method-B-unlock ADR (ADR 0017):** the 30-sample baseline counter, the
  μ − σ/√n unsampled estimate, the 6-month borrow-pool, the 3σ winsorising / compliance
  triggers, live per-process eligibility, the super-admin unlock, and the Method-B operator UI
  (surfacing an unsampled batch's estimate provenance + freshness). The conditional-gate seam
  is laid now; borrow-pool pooling granularity is re-verified against the registry then.

## Phases

### Phase 1 — `production_processes` + credit-batch feedstock & month cap
1. New table `production_processes`: `id`, `facilityId`, `feedstockTypeId`, `establishedAt`,
   `samplingMethod` (moved off `reactors`), baseline state; `schema/index.ts`; `db:generate`.
2. `credit_batches`: add `feedstockTypeId` (NOT NULL) + `productionProcessId` FK.
3. `samples`: re-point `production_run_id` → `creditBatchId` (run kept optional as provenance
   or dropped). `production_samples` untouched.
4. **≤1-month cap (Isometric):** Zod `superRefine` (`certifier==='isometric'` →
   `endDate − startDate ≤ 1 calendar month`, date-fns), server re-validate, DB `check` backstop
   (`certifier IS DISTINCT FROM 'isometric' OR (end_date - start_date) <= 31`).
5. Remove `reactors.samplingMethod`; move the form field / Zod to the production process.
6. Reseed: seeded runs roll into ≤1-month, single-feedstock credit batches under a (facility,
   feedstock) process; ≥3 lab samples per sampled batch.

### Phase 2 — sampling logic: per-process grouping, per-credit-batch cadence (Method-A live)
7. `getMethodBEligibilityByReactor` → `…ByProcess`: count samples within the process **since
   `establishedAt`** (closes the cross-feedstock bug; dormant under Method A). Move
   `validateReactorSamplingMethodFn` to the process.
8. `sampling-requirements.ts`: unit = credit batch; Method A = every credit batch sampled.
   Method-B cadence (`ceil(N_batches / 10)` per process) is **scaffolded but inert** until unlock.
9. `durability-submission-gates.ts`: ≥3 replicates **per sampled credit batch**; eligibility on
   the credit-batch mass-weighted mean; cadence grouped per process.
10. `config/certification.ts`: `…_CADENCE_RUNS` → `…_CADENCE_BATCHES`; `…_PER_RUN` → `…_PER_BATCH`.
11. Re-point trigger migrations `0052`/`0053` to the process / credit-batch grain (**new** migrations).

### Phase 3 — submission mapping (align to ADR 0013)
12. `measurement-samples.ts`: one `biochar_production_batch` measurement sample **per credit
    batch** (its ≥3-replicate mean + std-dev), blueprint `…_200_year_c_org`. The Method-B
    `_unsampled` path is **deferred** (no unsampled batches under Method A). Assert in-process
    `production_samples` are never mapped.
13. `aggregation.ts` / `credit-batches.ts`: mass-weighted average stays **preview only**.

### Phase 4 — docs + tests
14. CONTEXT.md terms (Credit batch, Sample, Replicate, Method A/B, +Production process) — **done
    2026-06-19**. Update `docs/isometric/{requirements-shortlist,condition-registry,
    schema-mapping,changes}.md`; record the deferred Method-B work in `docs/open-questions.md`.
15. Tests: ≤1-month enforcement (Isometric vs not), per-process grouping, ≥3-per-sampled-batch,
    one-feedstock-per-run loud assertion, in-process-never-submitted guard. E2E: multi-run
    single-feedstock credit batch within a month → submit.

## Open / watch
- **Sequencing vs ADR 0013 + issue #291** (template-driven remodel) — shared measurement-sample
  path; coordinate so we don't double-build the submission layer.
- **Facility vs Isometric "project" scope** for the process — protocol says project-scoped; noma
  scopes credit batches at facility. Confirm facility is the right noma analog at build.
- **"Consistent blend" as a process feedstock** (protocol allows it) vs the current
  `productionRunFeedstocks` M:M — deferred until a real blend feedstock appears.
- **Borrow-pool pooling granularity** (facility vs reactor) — re-verify against the registry
  before the Method-B unsampled estimate is built.
