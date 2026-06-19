# A credit batch is a production cohort; member applications are derived

Status: accepted (2026-06-19) — Dark Earth Carbon answered the four domain questions in
`docs/archive/2026-06-19-credit-batch-production-cohort.md` §5. Resolves the open question
in issue `#201`; supersedes the intent of `#113` (closed). Complements ADR 0003 (Removal as
submission unit) and ADR 0011 (credit-batch-anchored chain of custody).

> **Amended by ADR 0015 (2026-06-19).** This ADR left the cohort *feedstock-agnostic*,
> even though its own justification leaned on Isometric's **production batch** (which is
> *one feedstock under consistent conditions*). The §5 domain questions never covered
> feedstock-per-batch, so it fell through. ADR 0015 closes that gap: a credit batch is the
> production runs of **one feedstock** at one facility within ≤ 1 month — making it a genuine
> protocol production batch (the lab-sampling unit). A facility running several feedstocks in
> a month therefore has several **concurrent** credit batches, one per feedstock. Everything
> below — run-membership, derived applications, the 12-month clock, produced-vs-applied
> coverage — **stands unchanged**; 0015 adds only the feedstock constraint and a
> `production_processes` entity that scopes the Method A/B sampling regime.

## Context

A credit batch carried a `startDate/endDate` window but no fixed meaning for that window
(#201). Membership was anchored on **applications**, auto-matched into the batch by
*application date* (`credit_batch_applications`, the M:M junction; the prior
`credit_batch_production_runs` table was removed in #63 as redundant). Two
protocol-mandatory needs had no clean home on that model: (1) the **12-month-from-production**
stockpiling limit (`G-6VWJ-0`, biochar-storage-soil-environments v1.3), and (2)
**produced-vs-applied** tracking — "how much of this production has actually reached end
use, and is it too early to submit?" Both are anchored on *production*, not application.

Isometric's own model reinforces this: the **production batch is the atomic accounting
unit** (≤ 1 month; carbon sampling, dry-weight, and loss allocation attach to it —
Protocol v1.3 §8.3.1), while crediting is **ex-post and applied-mass-scoped** (§8.1, §8.4,
§8.6.2). The Certify API even joins `BiocharApplication.production_batch_id` to
`ghg_entry_id` — production cohort → application → credit-bearing entry.

## Decision

A **credit batch is a production cohort**: the production runs of one **feedstock**
(feedstock scoping added by ADR 0015) at one facility within a ≤ 1-month window.
**Production runs are the membership primitive** (strict — one run belongs to at most one
batch, which is where #93's no-double-counting attaches). The
batch's date window means **production period**. **Member applications are derived** from
membership via lineage (run → product → delivery → application), not stored.

**Applied-mass scoping is unchanged.** The cohort defines *which runs are in scope*; the
credited CO₂e remains the applied fraction only (`appliedDryKg / runTotalBiocharOutput`,
via `buildMassAccounting`). This is the same allocation ADR 0003 already performs at the
submission layer — so this decision does **not** re-introduce the run-as-submission-grain
over-count ADR 0003 warned against. The cohort is the *grouping/monitoring* unit; the
*Removal* and its run set are unchanged in shape, preserving the ADR 0003/0008 idempotency
ledger. The previously-invisible gap between cohort produced mass and applied mass becomes
a first-class, surfaced quantity (the produced-vs-applied coverage view) and the home for
the 12-month clock.

**The batch window gates runs, not applications.** Applications attach by lineage
regardless of their own date — biochar produced in June but applied in October belongs to
the June cohort. Application date drives only derived checks: the 12-month-from-production
eligibility clock (`G-6VWJ-0`/`G-946V-0`) and produced-vs-applied submit timing. A late
application landing after the cohort's removal was submitted re-derives applied mass and
amends the same removal (supplier-ref versioning), never double-counting.

**Stored batch aggregates become derived, not stored** (#285): `totalCo2eStoredTons`,
emissions, counterfactual, feedstock masses, `weightTons`, and durability inputs are
recomputed from member runs + applied-mass-scoped applications, eliminating the drift risk.

## Why

The production cohort is the unit the protocol actually credits and times. Anchoring the
batch on it gives the 12-month clock and produced-vs-applied coverage a natural home,
makes no-double-counting structural (one run → one batch, and — because a product links to
exactly one run — one application → one batch falls out for free), and keeps the
application as the credit-bearing leaf where Isometric expects it. The fractional
attribution math this requires already exists; the only new traversal is a forward
resolver (run → applications), which ADR 0011 anticipated.

## Consequences

- New `credit_batch_production_runs` membership table with `unique(productionRunId)`;
  `credit_batch_applications` is dropped or demoted to a derived cache.
- A new forward resolver `getApplicationsForRuns` replaces every `batch.applicationIds`
  read; it asserts each application resolves to exactly one run, so any future
  delivery-level cross-run blending fails loudly rather than mis-crediting silently.
- The chain-of-custody batch roll-up and the certify context source lineages from member
  runs; their aggregation math (`buildMassAccounting`, `buildBatchSankey`) is unchanged.
- The credit-batch form changes from application date-match to a production-run cohort
  picker (unassigned runs only).
- Out of scope: the `Removal → GhgEntry` rename (separate plan), the chain-of-custody page
  anchor (ADR 0011 stands — this changes only what "batch membership" resolves to).

All Isometric protocol references are non-authoritative summaries; verify against
registry.isometric.com before encoding credit-claim logic.
