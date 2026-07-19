# Plan — Credit batch = production cohort (re-anchor membership on production runs)

> **Date:** 2026-06-19 · **Status:** Accepted (Dark Earth Carbon answered the 4 domain questions — recorded in §5)
> **Closes:** #201 (decision = Option B), #93 (uniqueness guard), #285 (derive-vs-store aggregates) · **Reopens the intent of** #113 (now superseded by this richer model)
> **ADR:** [0014 — Credit batch is a production cohort](../adr/0014-credit-batch-as-production-cohort.md)
> **Touches but does not change:** ADR 0003 (Removal submission unit), ADR 0004 (GHG Statement artifact), ADR 0011 (credit-batch-anchored chain of custody)

## 1. Decision

A **credit batch becomes a production cohort**: a set of production runs produced at one facility within a bounded window (≤ 1 month, per Isometric's production-batch definition), rather than an "application folder" auto-matched by application date. Production runs become the **membership primitive**; applications attach by **lineage** and are **derived**, not stored.

This resolves the long-open semantic question (#201) in favor of **Option B**, and is grounded in Isometric's protocol: the **production batch is the atomic accounting unit** (sampling cadence, dry-weight, loss allocation, and the 12-month clock all attach to production), while crediting is **applied-mass-scoped** (only biochar that reached end use is credited).

### Why this is safe against the ADR 0003 over-count warning

ADR 0003 rejected *"production run as the submission grain"* because run-as-Removal assumed a run's whole output was applied → over-count. **This plan does not do that.** The credit batch (production cohort) defines *which runs are in scope*; the **CO₂e credited remains the applied fraction only**, via the existing `appliedDryKg / runTotalBiocharOutput` attribution (`buildMassAccounting`). The cohort is the grouping/monitoring unit; applied-mass scoping is preserved end to end. The gap between *cohort produced mass* and *applied mass* becomes a first-class, visible quantity (the produced-vs-applied coverage view) instead of an invisible assumption.

## 2. Canonical model (for CONTEXT.md)

- **Credit batch** — a production cohort: the production runs of one facility within a ≤ 1-month window. Its date window means **production period**, not application period.
- **Batch membership** — production runs. **Strict: one run belongs to at most one credit batch** (enforced by a unique constraint — this is where #93's no-double-counting attaches).
- **Member applications** — *derived* from membership: the applications whose biochar traces (via product → delivery → order/application lineage) to a member run. Not stored.
- **Applied-biochar scoping** — credited CO₂e counts only the applied fraction of each member run (`appliedDryKg / runTotalBiocharOutput`), unchanged from ADR 0003.
- **Produced-vs-applied coverage** — per batch: produced dry mass (Σ member-run output) vs applied dry mass (Σ member applications' applied dry mass). Drives the "don't submit too early" signal and the 12-month-from-production deadline.

## 3. Key code finding — the hard math already exists

The fractional lineage-weight infrastructure Option B needs is already built and battle-tested by the certification layer:

- `buildMassAccounting(lineages, runs)` → `attributionByRunId: Map<runId, fraction>` where `fraction = appliedDryKg / runTotalBiocharOutput` (`src/lib/certification/mass-accounting.ts:74`).
- `aggregateProductionRuns(runs, attributionByRunId)` scales all run chemistry by the attribution factor (`src/lib/isometric/utils/aggregation.ts:158`); `weightedHToCorgRatio` / `weightedOrganicCarbonPercent` are already applied-mass weighted.
- A biochar product links to **exactly one** run (`biocharProduct.linkedProductionRunId`), and an application resolves to exactly one product → one run (`getChainOfCustodyData`, `src/data-access/chain-of-custody.ts:115`). **Consequence:** the #201 "blended-product trap" is not real in today's schema. One run → one batch therefore implies each application belongs to at most one batch — #93 strictness falls out for free at the application level.

What's **missing** and must be built: a **forward resolver** (run → member applications), which ADR 0011 anticipated. Today lineage only runs application → run.

## 4. Isometric grounding (sourced; summaries non-authoritative — verify at the URLs)

- **Production batch is the accounting unit**, ≤ 1 month, single feedstock or consistent blend; carbon content, dry-weight, sampling (Method A/B) and **loss allocation** are per production batch (Protocol v1.3 §8.3.1; `R-6YSW-0`). → cohort = the natural credit-batch spine.
- **12-month clock runs from production** (`G-6VWJ-0`, biochar-storage-soil-environments v1.3); reversed/expired stockpiled biochar's creation carbon **still burdens the project boundary** (`G-946V-0`); stockpiling must be declared (`R-6E1D-0`) with safety conditions (`G-TGR7-0` wet/moist, `G-E5KW-0` weatherproof cover, `G-1TFH-0` away from waterways, `G-NFB6-0` documented in PDD).
- **Crediting is ex-post, applied-mass-scoped**: credits issuable only once durably stored; the Reporting Period for a batch ends at application (§8.1, §8.6.2); only "successfully delivered and stored biochar is credited" with loss accounting (§8.4).
- **Submission objects** (Certify OpenAPI): `Removal` is deprecated → `GhgEntry`; `Project 1—N GhgStatement 1—N GhgEntry 1—N components`. A `GhgStatement` carries `reporting_period_start_at/end_at` (date-driven membership). **`BiocharApplication` carries both `production_batch_id` and `ghg_entry_id`** — Isometric's own model joins production batch → application → credit-bearing entry, which mirrors this plan's "cohort-anchored, application-realized" shape. GhgEntry boundaries are supplier-defined (no mandated one-entry-per-batch). Idempotency via `supplier_reference_id`.
- **Mapping (interpretation):** credit batch (cohort) → one removal/statement period; applications remain the credit-bearing leaf. **This plan does not change the submission cardinality** (ADR 0003's `N credit batches → 1 Removal`, applied-mass scoped). The `Removal → GhgEntry` rename is tracked separately (`docs/plans/2026-06-10-isometric-ghg-entry-migration.md`) and is out of scope here.

## 5. Domain questions — answered by Dark Earth Carbon (2026-06-19)

1. **Month-end cross-month blending?** → *Occasionally / not sure.* Mostly single-month piles, but it can happen. **Implication:** keep one-product-one-run as the working invariant and do **not** build fractional (B2) attribution up front, but retain `attributionByRunId` as the seam so B2 can be added later. Phase 1/3 ship a **loud assertion** — any application resolving to >1 member run fails visibly rather than silently mis-crediting.
2. **What is checked before submitting?** → *Applied vs produced tonnage.* **Implication:** produced-vs-applied coverage is the **primary submit-readiness gate**, not just an indicator (Phase 5).
3. **Where should coverage surface?** → *On the batch itself.* **Implication:** Phase 5 builds a coverage panel on the credit-batch detail page; drop the separate-report alternative.
4. **Stockpiling near the 12-month limit?** → *Rarely — biochar is applied quickly.* **Implication:** the 12-month clock is a **warning indicator**, not a frequent constraint; the stockpiling safety declaration (`R-6E1D-0`, `G-TGR7-0/E5KW/1TFH/NFB6`) is a **deferred follow-up** recorded in `docs/open-questions.md`, not built in this work.

### 5a. Application timing vs the batch window (resolved design point)

The batch's `startDate/endDate` gates **member runs (production date), not applications**. Applications attach by **lineage**, regardless of their own date — June biochar applied in October belongs to the June cohort. An application "outside the batch range" is therefore the normal case, and is exactly the date-window mis-filing the old application-matched model got wrong.

Application date drives only two **derived** checks, never membership:

- **12-month eligibility (`G-6VWJ-0`):** `applicationDate − run.productionDate`. Biochar applied >12 months after production is **ineligible** — no credit, but its production carbon still burdens the boundary (`G-946V-0`). Coverage flags runs whose unapplied remainder nears the deadline.
- **Coverage / submit timing:** a cohort accrues applied mass over time (up to 12 months), so a batch is not "done" when production ends; submit when applied-vs-produced clears the gate (answer 2).

**Late-application edge — application lands after the cohort's removal was already submitted:** re-derive the cohort's applied mass and **amend the same removal** (ADR 0003's `supplier_reference_id` already versions the payload; aggregates are now derived per #285). Never a double-count, never a silent drop. The amend-vs-supplementary mechanics are a Phase 5 sub-task; default is in-place re-submit of the same removal.

## 6. Phased implementation

Cutover stance: **not live → reseed, not migrate-in-place** (no production data; prefer `db:reset` + reseed for the membership change). Schema-only DDL still goes through `pnpm db:generate` so the journal stays coherent.

### Phase 0 — Decision record & glossary
- Write **ADR 0014** (drafted alongside this plan) — the #201 decision and its reconciliation with ADR 0003/0011.
- Update **CONTEXT.md** "Credit batch" definition to the §2 cohort wording.
- Update **#201, #93, #113, #285** with the decision and a link to this plan.

### Phase 1 — Schema, membership, migration
- **`src/db/schema/credits.ts`**: introduce `credit_batch_production_runs` (`creditBatchId`, `productionRunId`, `createdAt`) as the membership table, with **`unique(productionRunId)`** (strict one-run-one-batch — #93) plus the composite PK. Add relations + type exports. Re-add the `productionRuns` import removed in #63.
- Keep `credit_batch_applications` **temporarily** as a derived/cache read path during migration, or drop it in favor of on-read derivation (decided in Phase 3); do not write to it as a source of truth.
- The batch's `startDate/endDate` semantics change to *production window*; add a `check` (or app-layer guard) that member runs' production dates fall within it and span ≤ 1 month.
- `pnpm db:generate`; review; reseed.
- **`src/lib/schema/catalog.ts`**: replace the `credit_batch_applications` catalog entry with `credit_batch_production_runs`.

### Phase 2 — Derive aggregates, drop the drift (#285)
- Replace stored-aggregate reads with a derived source of truth. Rewrite `refreshCreditBatchSummaries` (`src/data-access/applications.ts:135`) → `deriveCreditBatchTotals(batchId)` that computes `weightTons`, `totalCo2eStoredTons`, feedstock masses, and durability inputs from **member runs + their applied-mass-scoped applications** (reusing `buildMassAccounting` + `aggregateProductionRuns` + `computeApplicationCo2eStored`).
- Demote the stored columns on `credit_batches` (`totalCo2eStoredTons`, `…EmissionsTons`, `…CounterfactualTons`, `totalFeedstockMassKg`, `ineligibleFeedstockMassKg`, `weightTons`, `hToCorgRatio`, `fDurableCalculated`) to a **cache** refreshed by the derivation, or remove them and compute on read. Add a reconciliation check (assert stored == derived) for the cache option. (Per #285 recommendation: prefer deriving.)
- Recompute triggers shift from "application linked/unlinked" to "run added/removed from batch" and "member run's samples/output edited."

### Phase 3 — Forward resolver, roll-up, certify context
- **New `getApplicationsForRuns(userId, runIds)`** forward resolver: run → `biocharProducts` (`linkedProductionRunId`) → deliveries → orders/applications. This replaces the `batch.applicationIds` field everywhere it's read. Assert each resulting application resolves back to exactly one run (catches future blending).
- **`src/data-access/chain-of-custody-batch.ts:66`** (`resolveBatchScope`): source lineages from member runs (via the forward resolver) instead of `batch.applicationIds:77`. The downstream `buildBatchSankey` (`src/lib/chain-of-custody/sankey.ts`) and roll-up math are unchanged — they already consume deduped run lineages.
- **`src/fn/certification/certify-context-core.ts`** (`resolveScopeForCreditBatch`, the `applicationIds.flatMap` at ~`:680`) and **`src/fn/certification/sources.ts`** (`:191`): derive `applicationIds` from membership runs rather than reading the junction. The Removal's run set is unchanged in shape, so `payloadHash`/idempotency (ADR 0003) is preserved.
- **`src/data-access/credit-batches.ts`**: `getCreditBatchById` / `getCreditBatches` / `getCo2eStoredPreviews` return `productionRunIds` (membership) and `applicationIds` (derived); `buildCo2eStoredPreview` takes runs as input. Replace `validateApplicationIds` with `validateProductionRunIds` (existence, same-facility, in-window, not-already-in-another-batch).

### Phase 4 — Form & UX (run-cohort picker)
- **`src/components/credit-batches/credit-batch-form.tsx`**: replace application date-range auto-match (`:294–328`) with a **production-run cohort picker** — select a facility + production window → multi-select that window's **unassigned** runs (already-assigned runs disabled, showing their batch, per #93/#93's bin-picker convenience). Derived member applications shown read-only.
- **`src/schemas/credit-batches.ts`**: `applicationIds` → `productionRunIds` (`:58`, `:191`).
- **`src/fn/credit-batches.ts` / `src/hooks/use-credit-batches.ts`**: rename the options fetch to `getCreditBatchProductionRunOptionsFn` (unassigned runs for a facility/window); keep React Query keys/invalidation aligned.
- **Detail/list/card**: show produced-vs-applied coverage and member-run count instead of application count.

### Phase 5 — Produced-vs-applied coverage & 12-month clock (new, protocol-mandatory)
- Add a **batch coverage panel on the credit-batch detail page** (answer 3): produced dry mass (Σ member-run output), applied dry mass (Σ derived applications), % applied, unapplied remainder, and **days remaining to the 12-month-from-production deadline** (earliest member-run production date + 12 months). Applications are counted by lineage regardless of their date (§5a).
- **Submit-readiness gate (answer 2):** produced-vs-applied is the **primary gate**, not just a hint — block/warn the removal-readiness flow when the applied fraction is below threshold ("don't submit too early"); surface in the credit-batch health strip (`src/components/credit-batches/credit-batch-health-strip.tsx`).
- **Late-application handling (§5a):** when a derived application appears after the cohort's removal was submitted, re-derive applied mass and **amend the same removal** (supplier-ref versioning, ADR 0003). Default = in-place re-submit; supplementary-removal path is a flagged sub-decision.
- **12-month eligibility:** exclude (don't credit) biochar applied >12 months after its run's production date; flag runs whose unapplied remainder nears the deadline (`G-6VWJ-0`); expired/reversed stockpile still burdens the boundary (`G-946V-0`). Given DEC applies quickly (answer 4), this is a **warning indicator**, not a hard operational gate.
- **Deferred (answer 4):** stockpiling declaration/safety capture (`R-6E1D-0`, `G-TGR7-0/E5KW/1TFH/NFB6`) is **out of scope** for this work — record as a dated entry in `docs/open-questions.md`.

### Phase 6 — Tests, seed, docs
- **`tests/credit-batch-validation.test.ts`**: rewrite for `validateProductionRunIds` — missing run, cross-facility run, out-of-window run, **run already in another batch (the #93 guard)**, facility-change revalidation.
- New: derived-aggregate reconciliation test (#285) — edit a member run's output/samples → batch totals update; no drift.
- New: forward-resolver test — run → applications; assert one-run-one-application invariant.
- **`tests/e2e/credit-batches.spec.ts`** + **`src/db/seed-data.ts`**: seed via run membership, not application junction.
- Update `docs/traceability.md`, `docs/database.md`, `docs/schema-overview.md`, and the credit-batch sections of CLAUDE.md.

## 7. Blast radius (from exploration)

~40 touchpoints, concentrated. High-impact: `data-access/credit-batches.ts`, `data-access/applications.ts:135` (aggregate writer), `data-access/chain-of-custody-batch.ts:66/154`, `fn/certification/certify-context-core.ts`, `credit-batch-form.tsx`. Low/no impact: `certifier-removals.ts` (removal grouping is batch-atomic, doesn't read membership), `batch-health.ts` (pure), removal/ghg-statement breakdown (read batch aggregates as-is). The submission ledger/idempotency (ADR 0003/0008) is preserved because the run set feeding a Removal is unchanged.

## 8. Risks & non-goals

- **Risk:** a future schema change allowing a delivery/application to blend products from >1 run breaks the clean one-run-one-batch derivation → re-introduces fractional B2 complexity. Mitigation: Phase 1/3 assertion fails loudly if any application resolves to >1 run.
- **Risk:** demoting stored aggregates to derived changes read performance on list pages. Mitigation: keep a refreshed cache column (Phase 2 option) with a reconciliation assert, not pure on-read for hot lists.
- **Non-goal:** the `Removal → GhgEntry` rename (separate plan). The chain-of-custody *page* re-anchor (ADR 0011 keeps batch anchor; this plan only changes what "batch membership" resolves to, upstream of the page). Multi-tenancy `organizationId` columns (separate plan).

## 9. Sequencing

Phase 0 (decision) → Phase 1 (schema) → Phase 2 (derive) → Phase 3 (resolver + certify) are the spine and should land together behind the reseed. Phase 4 (UX) and Phase 5 (coverage/12-month) can follow as a second PR. Phase 6 tests accompany each.
