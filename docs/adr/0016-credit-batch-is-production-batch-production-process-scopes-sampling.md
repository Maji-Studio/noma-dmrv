# The credit batch is the protocol production batch; a production process scopes Method A/B sampling

Status: accepted (2026-06-19); amended 2026-07-02 (issue #309); amended 2026-07-04 (feedstock declared)

> **Amendment (2026-07-02, issue #309):** the lab-sample entry point moved from the
> production run to the **credit batch itself**. The batch's biochar is commingled across
> its member runs, so no single run is attributable to a grab — `createSample` now requires
> `creditBatchId` and no longer accepts a run; `samples.production_run_id` survives as
> legacy provenance only (nullable, never written). The sample also **inherits the batch's
> declared durability tier** instead of carrying its own selection. This strengthens, not
> changes, this ADR's grain decision: the "both links stay populated / derive the batch from
> the run" mechanics below describe the pre-amendment write path and now apply only to the
> batch-side back-fill of legacy run-linked rows.
>
> **Amendment (2026-07-04, feedstock declared):** the batch's feedstock type flips from
> **derived** to **declared**. It is now chosen on the credit-batch form up front (a required
> `feedstockTypeId`), because the (facility, feedstock) **production process** it resolves
> carries the Method A/B regime, sampling cadence, and borrow pool — surfacing the durability
> method *before* runs are assigned, and letting the form scope the run cohort to a single
> feedstock (which makes auto-selecting the eligible runs unambiguous). This does **not**
> change the one-feedstock grain (Decision #1/#2 stand) or make runs any less the membership
> primitive: `resolveSingleFeedstockType` is retained as an **equality guard**
> (`assertDeclaredFeedstockType`) — every member run must still resolve to exactly the declared
> type, so the declaration can never drift from the actual runs. The dependency inverts only
> for *how the type is chosen* (declared, then guarded), not for what the batch is made of
> (runs). Touch-points: `credit_batches.feedstock_type_id` is written from the declared value
> in `createCreditBatch`/`updateCreditBatch`; the run picker filters to the declared type;
> a `FeedstockProcessChip` previews the resolved process + Method A/B + progress-to-baseline.
>
> **Refines ADR 0014** (credit batch as production cohort) — it does **not** supersede it.
> ADR 0014's run-membership (`credit_batch_production_runs`, `unique(productionRunId)`),
> derived applications, 12-month clock, and produced-vs-applied coverage all stand. This ADR
> adds exactly two things: (a) the cohort is scoped to **one feedstock**, and (b) a
> **`production_processes`** entity owns the Method A/B sampling regime. Stays consistent with
> **ADR 0013** (the registry computes the durable fraction; noma submits per-production-batch
> H/C_org datapoints — the "production batch" ADR 0013 submits per *is* the credit batch
> defined here). Archived implementation shape:
> `docs/archive/2026-06-19-credit-batch-lab-sampling-compliance.md`.
>
> **Amendment (2026-07-24 — version-citation correction):** the v1.3 label in
> the Context is not the applicable local interpretation pin. Read the cited
> Biochar Protocol rules against the v1.2 interpretation set. The Certify
> project was separately observed on v1.1 on this date; that project
> discrepancy requires operator resolution and does not change this ADR's
> production-batch/process grain.

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
- **Deferred to a future ADR tied to the super-admin Method-B unlock (e.g. ADR 0017):** the
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
  — the run link is **kept** as provenance + the data-entry anchor: a Sample is entered against
  **one** production run and its credit batch is **derived** from that run's membership (the
  accounting grain). Both links stay populated; the run is never the characterisation / ≥3-count
  grain, and the ≥3 must be representative of the full range of physical characteristics present
  in the batch (protocol §8.3.1). `production_samples` is untouched.
  _(Correction 2026-07-28: this consequence previously read "the ≥3 are independent samples
  distributed across the batch's runs/days (protocol §8.3.1, re-verified 2026-06-19)". That was a
  misreading — §8.3.1 imposes no within-batch run/day distribution; its distinct-days language
  governs Method B's random-sampling cadence ACROSS production batches. The gate built on the
  misreading was removed.)_
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
