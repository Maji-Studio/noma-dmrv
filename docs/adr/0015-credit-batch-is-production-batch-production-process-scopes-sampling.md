# The credit batch is the protocol production batch; a production process scopes Method A/B sampling

Status: accepted (2026-06-19)

> **Refines ADR 0014** (credit batch as production cohort) — it does **not** supersede it.
> ADR 0014's run-membership (`credit_batch_production_runs`, `unique(productionRunId)`),
> derived applications, 12-month clock, and produced-vs-applied coverage all stand. This ADR
> adds exactly two things: (a) the cohort is scoped to **one feedstock**, and (b) a
> **`production_processes`** entity owns the Method A/B sampling regime. Stays consistent with
> **ADR 0013** (the registry computes the durable fraction; noma submits per-production-batch
> H/C_org datapoints — the "production batch" ADR 0013 submits per *is* the credit batch
> defined here). Implementation shape: `docs/plans/2026-06-19-credit-batch-lab-sampling-compliance.md`.

## Context

The Isometric Biochar Protocol (v1.3, §8.3.1) measures carbon content at the **production
batch** level — a period < 1 month of **one feedstock under consistent pyrolysis
conditions** — and governs sampling *frequency* (Method A / Method B) at the **production
process** level (the campaign of that feedstock under consistent conditions). The protocol
texts that fix this were verified verbatim on 2026-06-19 (not the AI summarizer):

- **The production process is keyed by feedstock + pyrolysis conditions, and nothing else.**
  Physical reactor identity is *not* part of its boundary — the protocol is silent on
  equipment and even treats same-design reactors as interchangeable without re-validation.
  Two reactors running the same feedstock under the same conditions are **one** production
  process. (§8.3.1 definition; `G-F74T-0`.)
- **The ≥30-sample Method-A baseline, the 1-in-10 Method-B cadence, the μ − σ/√n conservative
  estimate for unsampled batches, and the 6-month sample-eligibility window are all scoped to
  the production process** — never to reactor or site. (`G-F74T-0`, `G-2W0F-0`, Eqs. 4–5.)
- **A new production process (baseline restarts from zero) is triggered by a feedstock change,
  a pyrolysis-condition change, or a 3σ carbon-content deviation** — not by equipment,
  operator, or elapsed time.

noma's code and prior glossary treated the **production run** as the batch: lab `samples`
hang off `production_run_id`; `sampling_method` is a `reactors` column; and Method-B
eligibility (`getMethodBEligibilityByReactor`) counts a reactor's samples across **all**
feedstocks — a latent over-credit bug (30 hardwood samples would wrongly unlock Method B for
a new softwood batch). ADR 0014 then defined the credit batch as a facility-month cohort but
left it feedstock-agnostic.

Dark Earth Carbon confirmed the real operation (2026-06-19): production is consistent within
a month, **one feedstock per accounting batch** (a different feedstock is a separate,
concurrent batch); a single run never blends feedstock *types* today; **pyrolysis conditions
are stable per feedstock**; and they **always start on Method A**, unlocking Method B later
via a super-admin action only if needed. Because conditions are stable per feedstock, the
protocol's `(feedstock × conditions)` process key collapses, for noma, to **(facility,
feedstock)** spanning reactors.

## Decision

1. **The credit batch is the protocol production batch** — the lab-characterisation /
   sampling unit. It carries **one feedstock** and is capped at **≤ 1 month when the certifier
   is Isometric**. Several credit batches run concurrently (one per feedstock). Lab **Samples**
   attach **per credit batch** (`samples.creditBatchId`), ≥ 3 per *sampled* credit batch;
   their mass-weighted mean + std-dev characterise the batch. The in-process per-run
   spot-checks (`production_samples`) stay internal-only and are never submitted. A run that
   blends >1 feedstock *type* is rejected with a loud assertion (consistent-blend modelling is
   deferred until a real blend feedstock appears).

2. **A `production_processes` entity scopes Method A/B and the baseline.** It is keyed
   **(facility, feedstock)** — a campaign spanning many monthly credit batches and, per the
   protocol, **spanning reactors** (reactor identity is not part of the boundary). It owns
   `sampling_method` (moved **off** `reactors`), an `established_at`, and the baseline state.
   `credit_batches` gains `feedstockTypeId` and a `productionProcessId` FK (a batch is one
   ≤1-month slice of its process). A feedstock change, pyrolysis-condition change, or 3σ
   deviation opens a **new** process and resets the baseline to zero.

3. **`production_processes` is registry-agnostic.** It is a generic production campaign; the
   Isometric-specific behaviour (the ≤1-month cap, the ≥30-sample baseline, the Method-B
   unlock, the unsampled estimate) is a set of **conditional gates** applied only when
   `certifier = 'isometric'`. No registry branding in the schema — the same separation already
   used for certifier-validated feedstock types.

4. **Submission is unchanged from ADR 0013.** noma submits the **list** of per-credit-batch
   H/C_org datapoints (each the batch's ≥3-replicate mean + std-dev) via
   `biochar_production_batch` measurement samples; the **registry** aggregates and computes
   `F_durable`. Under Method A every credit batch is sampled →
   `biochar_sequestration_200_year_c_org`. noma's mass-weighted average stays a **local
   preview / reconciliation value only**.

### Scope of this change (what ships vs what is deferred)

Because DEC runs **Method A everywhere** with stable conditions, this branch ships the
**structure** and the **Method-A behaviour** only:

- **Ships now:** the `production_processes` entity + (facility, feedstock) keying;
  `sampling_method` moved onto it; `credit_batches.feedstockTypeId` + `productionProcessId`;
  the ≤1-month Isometric cap; `samples` re-pointed to the credit batch; ≥3-per-sampled-batch
  characterisation; per-process grouping of eligibility.
- **Deferred to a future ADR tied to the super-admin Method-B unlock (e.g. ADR 0016):** the
  live Method-B compute — the 30-sample baseline counter, the μ − σ/√n unsampled estimate, the
  6-month borrow-pool, the 3σ winsorising/compliance triggers, the per-process eligibility
  wiring, and the Method-B operator UI (which must surface *why* and *how fresh* an unsampled
  batch's estimate is). The conditional-gate seam is laid now so these light up without a
  re-model; the borrow-pool's facility-vs-reactor pooling granularity is re-verified against
  the registry before it computes anything.

## Considered options

- **Key the production process at (reactor, feedstock)** (the original draft). Rejected:
  contradicts the protocol — the process boundary is feedstock + conditions, not equipment;
  reactor-keying over-fragments baselines, and a facility-level credit batch would straddle
  two reactor-keyed processes, breaking the clean process → batch → run → sample hierarchy.
- **Derive the process from (reactor/facility, feedstock) with no table.** Rejected: a derived
  key can't store `established_at`, can't hold the baseline counter, and can't represent a
  reset caused by a *condition* change or a 3σ deviation (same feedstock, new process).
- **Keep production run = batch (status quo).** Rejected: doesn't match the operation (lab
  characterisation per period, not per run), and leaves Method-B eligibility reactor-global
  (the cross-feedstock over-credit bug).
- **Leave the credit batch feedstock-agnostic (ADR 0014 as written).** Rejected: then the
  credit batch is *not* the protocol production batch, the lab-sampling unit has no clean home,
  and 0014 contradicts its own production-batch justification.
- **Materialize `production_processes` keyed (facility, feedstock), registry-agnostic, with
  Method-B compute deferred** — chosen.

## Consequences

- New `production_processes` table (`facilityId`, `feedstockTypeId`, `establishedAt`,
  `samplingMethod`, baseline state). `reactors.sampling_method` is removed. `credit_batches`
  gains `feedstockTypeId` + `productionProcessId`. `samples.production_run_id` → `creditBatchId`
  (run becomes optional provenance or is dropped); `production_samples` is untouched.
- `getMethodBEligibilityByReactor` → per-process (dormant under Method A; closes the
  cross-feedstock over-credit bug when Method B unlocks). Cadence / replicate / eligibility
  gates move from run-grain to credit-batch-grain, grouped by process.
- ≤1-month enforcement on credit batches at three layers (Zod + server + DB check) when the
  certifier is Isometric.
- **Glossary (CONTEXT.md):** "Credit batch", "Sample", "Replicate", "Method A / Method B"
  updated, and "Production process" added (done 2026-06-19).
- No production data yet → **reseed, don't migrate** (project convention). The hand-written
  trigger migrations `0052` (Method-B baseline) / `0053` (200-yr completeness) re-point to the
  process / credit-batch grain via **new** migrations (never edit applied ones).
- Builds on its own branch (`feat/credit-batch-production-process`). Interacts with ADR 0013
  and issue #291 (template-driven data model) — sequence alongside the durability-submission
  track, since they share the measurement-sample path.

All Isometric protocol references are non-authoritative summaries of verified text; re-verify
against registry.isometric.com before encoding credit-claim logic (especially before the
Method-B compute is built).
