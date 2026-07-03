# Production emissions front-load once per credit batch

Status: accepted (2026-07-03) · Issue #349 · Partially supersedes
[ADR 0003](./0003-removal-as-submission-unit.md) (narrows its
"applied-biochar scoping" clause)

## Context

ADR 0003 scoped **every** run-derived quantity in a Removal submission by the
per-run applied-biochar fraction (`appliedDryKg / runTotalBiocharOutput`).
That is correct for the stored quantity — the registry credits biochar that
reached soil — but it prorates **production-side emission inputs** (feedstock
mass, startup + genset diesel, grid electricity, feedstock/sample transport)
by the same fraction. Under proration, a batch whose output is applied across
several removals would submit each production emission only partially per
entry, and the un-applied remainder's emissions would never be claimed at
all — an under-count of project emissions, which is over-crediting.

Biochar Protocol v1.3 **§8.6.2** requires project emissions to be accounted
in the reporting period in which the emitting activity occurs. Production
emissions occur when the batch is produced — not when its biochar is later
applied — so they belong, in full, on the first GHG entry that reports the
batch, regardless of how much of the batch's output that entry's
applications cover.

**Authority.** The basis for this decision is Biochar Protocol v1.3 §8.6.2
**only**. GHGAM §7 is **not** the authority here — it covers Establishment
and End-of-Life phases only; GHGAM §4.1 keeps operational emissions
per-period, and the front-load is §8.6.2-clean because all of a credit
batch's production operations occur within the batch's reporting period
(the batch is ≤ 1 month by ADR 0016, and the entry's window spans production
start → latest application).

## Decision

1. **Three emission-input buckets** classify every submitted quantity
   (`SOURCE_BUCKETS` in `src/lib/isometric/utils/aggregation.ts`, mirrored
   as a required `bucket` attribute on every `INPUT_MAPPING` entry in
   `src/lib/isometric/transformers/datapoint.ts`; a weld test keeps the two
   classifications from drifting):
   - **production** — feedstock dry mass, startup + genset diesel, grid
     electricity, feedstock transport, sample transport. Submit **full run
     totals**, no applied-mass weighting.
   - **delivery** — biochar transport (mass·distance and its mass input).
     Scales with the applied share of this removal.
   - **stored** — sequestered product mass and carbon content. Ex-post
     applied-scoped, unchanged from ADR 0003.
2. **Front-load on the claiming entry.** The removal that first submits a
   credit batch successfully claims the batch's production-bucket emissions
   in full. The claim is a nullable FK on the batch —
   `credit_batches.production_emissions_claimed_by_removal_id` — written
   transactionally with the submission ledger's `submitted` flip
   (`markSubmissionSubmitted`), with an unclaimed-or-self guard so
   resubmit/supersede by the same removal is idempotent. An FK (not a
   boolean) because the predicate is identity — "claimed by ME vs ANOTHER" —
   which enables the guarded UPDATE, answers the audit question directly,
   and stays forward-compatible with issue #353's earliest-entry semantics.
3. **Foreign claim fails closed.** `submitRemoval` asserts, before any
   registry POST, that no member batch is claimed by a *different* removal.
   The correct follow-up — a delivery-only entry that suppresses the
   production bucket — is deferred behind issue #353; until then the
   condition is a loud error, never silent suppression.
4. **Uniform delivery fraction.** Biochar transport scales by one
   removal-wide fraction (`appliedDryKg / totalBiocharOutputKg`). The legs
   are already lineage-scoped to the removal's applications; scaling each
   leg by the same fraction is an honest, documented approximation.
   Per-delivery scoping needs the application→batch junction and is
   deferred alongside #353.
5. **`bucket` lives on `INPUT_MAPPING`, not the blueprint.** A deliberate
   deviation from "attribute on the blueprint": the remote OpenAPI blueprint
   types have no attribute mechanism, so the classification rides noma's
   mapping table. Ties into the template-mirroring work tracked in
   issue #291.

Chemistry weighting (weighted means, `weightedBatchChemistry` overlays) and
durability `productMassKg` are stored-bucket concerns and stay
applied-scoped, untouched.

## Consequences

- The datapoint magnitudes submitted to Isometric change for
  partially-applied removals (production inputs grow to full totals; biochar
  transport shrinks to the applied share). noma computes no emission CO₂e
  locally (ADR 0018), so previews and readiness are unaffected.
- The semantic payload hash changes for partially-applied removals, so a
  resubmit supersedes the prior version — correct, and inert while nothing
  is live in production.
- A second removal touching an already-claimed batch cannot submit until
  #353 lands the delivery-only follow-up entry (batch×quarter grain +
  suppression arithmetic).
- Deferred, tracked with #353 unless noted: reporting-quarter grain and
  suppression arithmetic; adoption of the application→batch junction;
  a carbon-ledger UI for claim state; per-delivery transport scoping;
  the blueprint-attribute alternative (#291).
- Migration `0068` is additive — the claim FK column + its index.
