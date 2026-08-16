# Production emissions front-load once per credit batch

Status: accepted (2026-07-03) · Issue #349 · Partially supersedes
[ADR 0003](./0003-removal-as-submission-unit.md) (narrows its
"applied-biochar scoping" clause)

> **Amended 2026-07-24 — version-citation correction.** The v1.3 labels in the
> historical Context below do not match noma's Biochar Protocol v1.2
> interpretation pin. The Certify project was separately observed on v1.1 on
> this date. The §8.6.2 allocation decision remains in force, but its
> applicability to the configured project version must be confirmed when the
> operator resolves the project discrepancy with Isometric.

> **Amended 2026-08-15: application-slice follow-up Removals.** A credit
> batch may now contribute newly applied mass to more than one Removal. The
> first successful Removal still claims production emissions in full; later
> Removals omit production components and retain delivery and stored inputs.

> **Amended 2026-08-16: pre-POST reservation.** A Removal submission now
> reserves every production-contributing credit batch atomically before its
> first registry mutation. Mutation-free failures release the reservation;
> possible or confirmed external mutations retain it for reconciliation.

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
3. **Foreign claims produce delivery-only follow-up entries.** Removal
   membership is frozen at the application-slice grain on
   `credit_batch_applications`. When a member batch was claimed by a different
   Removal, compilation excludes its production runs from production-bucket
   totals and omits production-only template components when the whole Removal
   is delivery-only. Delivery and stored inputs remain application-scoped.
   Immediately after the submission draft is claimed, a fresh database read
   verifies that membership, run lineage, and claim ownership still match the
   reviewed snapshot. Contenders are ordered by their effective reporting
   quarter (the quarter containing the latest member Application date), then
   draft creation and ID. The winner atomically reserves every unclaimed member
   batch before any registry POST. The exact submission may resume; another
   draft may take over only when the owner is safely reclaimable under the
   shared lock TTL and has no possible external mutation. Successful submission
   converts the reservation to the permanent Removal claim in the ledger
   transaction.
4. **Uniform delivery fraction.** Biochar transport scales by one
   removal-wide fraction (`appliedDryKg / deliveryBiocharOutputKg`, the shared
   `appliedBiocharFraction` definition). The denominator includes only member
   runs represented by this Removal's Applications; unapplied runs pulled in
   for whole-batch production front-loading cannot dilute delivery. The legs are already
   lineage-scoped to the removal's applications; scaling each leg by the
   same fraction is an honest, documented approximation. The transport
   evidence-ledger PDF derives its biochar subtotal from the same fraction
   and renders the "leg sum × applied share" arithmetic explicitly, so the
   Source-mirrored ledger always reconciles to the submitted scalar.
   Exact per-delivery transport allocation remains separate work. The
   application-by-batch junction now freezes the applied mass used by each
   Removal, but the current registry input remains one removal-wide transport
   scalar.
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
- A second Removal can submit newly applied mass from an already-claimed batch
  without repeating that batch's production emissions.
- Removal membership and wet/dry applied mass are immutable application slices,
  so later Applications can join later Removals without changing prior ones.
- The Removal review and credit-batch detail expose the estimate, submitted
  inputs, source links, and prior production claim.
- Noma submits the frozen production, delivery, and stored inputs. Isometric
  remains authoritative for project emissions and the resulting net removal.
- Deferred: reporting-quarter grain and the blueprint-attribute alternative
  (#291).
- Migrations `0068` and `0111` are additive — the permanent claim FK and the
  pre-POST reservation pointer, each with an index.
