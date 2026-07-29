# 2026-07-22 — Feedstock Types page; retire Production Processes UI & Method-B unlock ceremony

Decided in a grilling session against live Isometric protocol research (Biochar
Protocol v1.3 §8.3.1/§8.3.1.2). See ADR 0022 for the decision record; CONTEXT.md
entries **Production process**, **Method A / Method B**, **Method-B baseline**,
**Method-B prerequisites** already updated on this branch.

## Motivation

The `/certification/production-processes` page and the Method-B unlock ceremony
(stored `samplingMethod`, `methodBUnlockedAt`, DB trigger backstops, advisory
locks, operational-start editing, persistent drift surface) are over-built.
Research against the registry confirmed:

- The Certify API has **no sampling-method field**; Method A/B surfaces only as
  per-batch blueprint routing (`_c_org` vs `_unsampled`) in
  `src/lib/isometric/transformers/measurement-sample.ts`.
- Method-B permissibility can be **computed live** (eligible samples since the
  process epoch ≥ agreed baseline); no stored unlock is protocol-required.
- Only three things are irreducible: a per-(facility, feedstock type) **process
  epoch** (reset marker), the three **Method-B prerequisites** (agreed baseline
  size ≥30, random-sampling-plan/PDD ref, moisture pathway), and per-batch
  sampled/unsampled determination fixed at batch creation.
- Drift/compliance monitoring is an operator duty; we deliberately ship **no
  in-app drift warnings** (registry is the detector of record, ADR 0017 D6).

## Decisions

1. **Remove** the `/certification/production-processes` page, its nav entry,
   and the unlock apparatus: `UnlockMethodBDialog`, `SetOperationalStartDialog`,
   `StartNewProcessDialog`'s current surface, method pill/process detail panel,
   drift-warning components, `evaluateProcessComplianceDrift`, the unlock/
   operational-start server actions, and the DB triggers/advisory-lock
   machinery guarding the flip.
2. **Slim `production_processes`** to a per-(facility, feedstock type) marker:
   keep `establishedAt` (epoch), `agreedBaselineSize`,
   `randomSamplingPlanRef`, `moisturePathway`, `notes`; drop `samplingMethod`
   and `methodBUnlockedAt` (and the `method_b_prereqs` check tied to them; add
   an all-three-or-none prerequisites check instead). Existing FKs from
   `credit_batches` and durability reads stay.
3. **Credit batch stores its choice**: a batch is **sampled or unsampled**,
   chosen at creation and fixed (regime-boundary rule, ADR 0017 amendment).
   "Unsampled" is selectable only when, for the batch's (facility, feedstock
   type) current process: live eligible-sample count ≥ `agreedBaselineSize`
   (floor 30) AND the three prerequisites are recorded. First-time
   prerequisites capture happens **inline in the credit-batch form, owner/
   admin only** — recording them IS the admin "unlock"; there is no stored
   flag. Blueprint selection keys off the batch's stored choice.
4. **New Feedstock Types page** under the **Infrastructure** nav section
   (org-wide catalogue, both `pyrolysis` and `blend` usage):
   - List: name, code, category, usage, Isometric-linked badge, archived state.
     Create/edit via the existing `feedstock-type-form` in a side sheet.
   - **Delete if unused, else archive**: hard delete only when nothing
     references the type; otherwise the action archives (`archivedAt`).
     Archived types disappear from pickers, stay in history.
   - **Isometric import on demand** (only when the org has a registry
     connection; manage rights = owner/admin, server-computed): browse the
     registry catalogue, "Import" creates a local type prefilled from the
     entry with the Isometric ID stored in a new
     `isometricFeedstockTypeId` column. Retire the
     `isometric:feedstock_type:<id>` string convention in `registryUrl`
     (`feedstock-type-form-logic.ts`); `registryUrl` returns to a plain
     optional URL.
   - Detail panel, **Isometric-connected orgs only**, scoped to the active
     facility context: a modest "Sampling" section — eligible-sample count vs
     agreed baseline, Method-B availability, recorded prerequisites, and the
     **Start new process** epoch reset (confirmation required; zeroes the
     count). No drift warnings.
5. **Whole sampling surface is Isometric-gated**: non-connected orgs see a
   plain catalogue page and no sampled/unsampled control on credit batches.

## Consequences / migration

- No production system: regenerate migrations; local `pnpm db:reset` is fine;
  **staging DB must be reset by the user when this lands**.
- Durability gates and Method-B eligibility counting move from
  `methodBUnlockedAt`/`samplingMethod` reads to computed eligibility + the
  batch's stored sampled/unsampled choice.
- The baseline-floor sample-deletion invariant goes away: the count is live;
  dropping below the threshold greys "unsampled" for NEW batches only.
- ADR 0017 Track 2 (unlock ceremony) superseded by ADR 0022; Track 1
  (registry computes, noma previews) stands. ADR 0016 stands (process still
  scopes sampling; it is just lighter).
