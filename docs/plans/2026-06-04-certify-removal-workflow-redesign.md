# Certify-Removal Workflow Redesign

**Date:** 2026-06-04
**Branch:** `chore/refactor-certify-flow`
**Status:** Design — awaiting approval (no code yet)

> Design doc for reshaping the "submit a removal to Isometric" flow. Decisions in
> this doc were locked with the product owner; see **Locked decisions**. All
> Isometric protocol/URL claims are **non-authoritative** until verified against
> the registry (per CLAUDE.md) — see **Open questions**.

---

## 1. Why

The current "add a removal" flow is confusing:

- Removals are created **eagerly and 1:1** with a single credit batch via a
  "Group into… → ＋ New removal" dropdown (`removals-list.tsx:250-305`). There's
  no clear primary "start here" action.
- Assembling multiple batches means juggling a per-batch dropdown.
- Whether a removal is *ready* and *what's still missing* is only discoverable
  by walking a 5-step review route
  (`/certification/removals/[removalId]/review` — Assemble → Review → Evidence →
  Pre-flight → Submit).
- "Completeness" is judged at the **removal** level, after grouping — so you
  group first, then discover a batch's data was never complete.

**Goal:** a single, obvious workflow — *start → pick complete batches → confirm
removal-level requirements → submit → jump to the removal on Isometric* — with
data completeness pushed **down onto the credit batch** so you only ever group
batches that are actually ready.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | When is the removal created? | **Deferred** — created only when the batch selection is confirmed (not eagerly per-batch). |
| 2 | Wizard presentation | **Large modal/dialog** over the removals overview. Close / "Resolve later" returns to the dimmed overview underneath. |
| 3 | Where does batch completeness live? | A **health check on a new credit-batch detail page** (`/credit-batches/[id]`). Batches are fixed there, not in the wizard. |
| 4 | What can be selected into a removal? | **Only "complete" batches.** Incomplete batches still appear in the selection list but are non-selectable, each with a "jump to batch" link to its health check. |
| 5 | Completeness split | **Two levels.** Batch-data completeness = batch health check. Facility/registry-level requirements = wizard "requirements" step. |
| 6 | Unmet-requirement fix links | **Smart per-blocker** — each links to wherever it's actually fixed (in-app page or external Isometric). |
| 7 | Post-submission | Show the external removal id **and a "View on Isometric ↗" link**. |

---

## 3. The two-level completeness model

The single most important idea. Completeness splits cleanly by *grain* and by
*where it's fixed*:

```
┌─ BATCH HEALTH ─ per credit batch ─ fixed on /credit-batches/[id] ──────────┐
│  • Durability inputs (conditional on durabilityOption)                     │
│  • Feedstock eligibility (mass present, ineligible ≤ 25%)                   │
│  • Carbon accounting (CO₂e stored / emissions / counterfactual resolved)   │
│  • Reversal-risk / buffer pool                                             │
│  • Production data linked (this batch's lineage resolves ≥1 run)           │
│  • Transport legs present for required categories (this batch's lineage)    │
│  • Evidence documents (COA / lab report / photos) attached                 │
│  • Third-party-sale fields (only when applicable)                          │
└────────────────────────────────────────────────────────────────────────────┘
        ↓ only "healthy" batches are selectable
┌─ REMOVAL / FACILITY REQUIREMENTS ─ in the wizard ─ smart fix links ────────┐
│  • Facility linked to an Isometric project        → /certification/settings │
│  • Default removal template resolved              → /certification/settings │
│  • Template blueprints resolve                    → Isometric ↗             │
│  • Transport legs aggregate cleanly across the    (cross-batch uniformity,  │
│    selected batches                                only checkable post-select)│
└────────────────────────────────────────────────────────────────────────────┘
```

This maps directly onto the existing readiness facts
(`src/lib/certification/readiness.ts`), just **re-graining** some of them:

| Existing `RemovalReadinessFacts` field | New home |
|---|---|
| `hasMapping` | Removal requirements (facility-level) |
| `hasDefaultTemplate` / `missingDefaultTemplateId` / `unresolvedBlueprintKeys` | Removal requirements (facility-level) |
| `hasSubmittableRuns` | **Batch health** (per-batch lineage) |
| `requiredTransport[].count` (legs present) | **Batch health** (per-batch lineage) |
| `requiredTransport[].hasAggregationWarning` (cross-batch uniformity) | Removal requirements (only meaningful across the selected set) |

> **Dependency to handle:** *which* transport categories are required comes from
> the facility's **default template**. So batch transport-health can only be
> judged once the facility is set up (mapping + template). See **§8 Facility
> setup gate**.

---

## 4. User flow (the modal wizard)

Primary CTA: a **"New removal"** button on `/certification/removals` (top-right
of `removals-list.tsx` header, `:55-65`). The old "Group into…" ungrouped
dropdown is retired in favor of this.

### Step 1 — Select credit batches
```
overview (dimmed)
  ┌─ New removal ──────────────────────[1●][2][3]──── ✕ ─┐
  │  Select the credit batches for this removal           │
  │                                                       │
  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │
  │  │ CB-043 ☑ │ │ CB-044 ☑ │ │ CB-045            ⚠   │  │
  │  │ Jan–Mar  │ │ Jan–Mar  │ │ 2 issues             │  │
  │  │ 12.4 t   │ │ 9.1 t    │ │ Fix on batch page ↗  │  │
  │  │ 200yr    │ │ 200yr    │ │ (not selectable)     │  │
  │  └──────────┘ └──────────┘ └──────────────────────┘  │
  │                                                       │
  │  3 of 4 batches ready · 2 selected                    │
  │                          [ Cancel ]  [ Confirm → ]    │
  └───────────────────────────────────────────────────────┘
```
- Lists **ungrouped** batches for the active facility (already-grouped batches
  excluded).
- Each card shows at-a-glance info (`credit-batch-card.tsx` already renders code,
  status, date range, weight tons, CO₂e stored, durability — reuse a compact
  variant).
- **Healthy** batch → selectable checkbox.
- **Unhealthy** batch → disabled, shows issue count + **"Fix on batch page ↗"**
  → opens `/credit-batches/[id]` (new tab) to its health check.
- **"Confirm →"** is the deferred-create moment: calls the new
  `createRemovalWithBatchesAction` → creates the removal, assigns the selected
  batches, advances to Step 2. (Server re-validates health — never trusts client.)

### Step 2 — Requirements (facility / registry level)
```
  ┌─ New removal ──────────────────────[✓][2●][3]──── ✕ ─┐
  │  Registry requirements                                │
  │  ✓ Facility linked to an Isometric project            │
  │  ✓ Removal template resolved                          │
  │  ✗ Template references 1 unresolved blueprint   Fix ↗ │ → Isometric
  │  ✗ Biochar transport legs aren't uniform        Fix ↗ │ → /deliveries
  │                                                       │
  │              [ Resolve later ]      [ Submit → ]      │
  └───────────────────────────────────────────────────────┘
```
- Built from `buildRemovalPreflightChecklist(facts)` **filtered to the
  facility-level checks** (mapping, template, blueprints + cross-batch transport
  uniformity).
- Each unmet row → a **smart Fix link** (§6).
- **All met →** "Submit →" enabled.
- **Not met →** "Resolve later" closes the modal and returns to the overview;
  the draft removal **persists** (visible in the overview list as a draft to
  resume). The batches stay grouped.

### Step 3 — Submit
```
  ┌─ New removal ──────────────────────[✓][✓][3●]──── ✕ ─┐
  │  Ready to submit 2 batches · 21.5 tCO₂e               │
  │  ⚠ Production environment — this is a real submission. │  (prod only)
  │                                      [ Submit removal ]│
  └───────────────────────────────────────────────────────┘
        │ success
        ▼
  ┌───────────────────────────────────────────────────────┐
  │ ✓ Removal submitted to the registry.                   │
  │   rmv_abc123 · v1                                       │
  │   [ View on Isometric ↗ ]   [ Done ]                   │
  └───────────────────────────────────────────────────────┘
```
- Reuses the existing `submitRemovalAction` + `SubmitConfirmDialog`
  (production gate). Logic in `submit-step.tsx` is largely reusable.
- **New:** on success, render **"View on Isometric ↗"** built from the external
  removal id (§7).

### Resume / edit path
Opening a **draft** removal from the overview re-opens the same modal at the
right step (membership still editable while not submitted — `canRegroupRemoval`
gates this, `readiness.ts:237`). This replaces the standalone
`/[removalId]/review` route (redirect it to the overview + open the modal).

---

## 5. Credit-batch health check (`/credit-batches/[id]`)

New detail route. Top of the page = the **health check** panel; batch details +
edit below.

```
/credit-batches/CB-2025-045
┌─ Health check ── 2 of 7 issues ───────────────────────────┐
│ ✓ Durability inputs (200-year: H:Corg present)            │
│ ✓ Feedstock eligibility (ineligible 8% ≤ 25%)             │
│ ✓ Carbon accounting resolved                              │
│ ✓ Reversal-risk buffer set                                │
│ ✗ Production data not linked              [ Link runs ]    │
│ ✗ Biochar transport leg missing          [ Add transport ]│
│ ✓ Evidence: COA attached                                  │
└────────────────────────────────────────────────────────────┘
  …existing batch detail / edit form below…
```

### Health-check item definitions

Grounded in the schema constraints (`db/schema/credits.ts:162-185`), the zod
schema (`schemas/credit-batches.ts`), the existing readiness facts, and the
CO₂e preview "pending inputs" signal (`credit-batch-card.tsx:106-115`).
**The exact Isometric-required set must be confirmed via `protocols_analyze`
on the biochar protocol at build time** (§ Open questions).

| Check | Met when | Fix link |
|---|---|---|
| **Durability inputs** | `durabilityOption='200_year'` → `hToCorgRatio` set · `='1000_year'` → reflectance mean/std + non-reactive-carbon mean/std set | batch edit (this page) |
| **Feedstock eligibility** | `totalFeedstockMassKg` set AND `ineligibleFeedstockMassKg ≤ 25%` of total | batch edit (this page) |
| **Carbon accounting** | `totalCo2eStoredTons`, `totalCo2eEmissionsTons`, `totalCo2eCounterfactualTons`, `fDurableCalculated` resolved (CO₂e preview has no `missingInputs`) | depends on lab + production; batch edit |
| **Reversal-risk / buffer** | `bufferPoolPercent` set / `reversalRiskAssessmentId` present | reversal-risk assessment |
| **Production data linked** | batch lineage resolves ≥ 1 production run (per-batch `hasSubmittableRuns`) | applications / production runs |
| **Transport legs** | for each template-required category, this batch's lineage has complete legs | `/deliveries` (transport legs) |
| **Evidence documents** | required docs (COA / lab report) attached — *subsumes the old Evidence step* | batch detail / documents |
| **Third-party-sale fields** *(conditional)* | only if batch is a third-party sale → `affidavitReference`, `intendedUseConfirmation`, `companyVerificationRef`, `mixingTimelineDays` set | batch edit (this page) |

> **The old "Evidence" step is dissolved** into the "Evidence documents" health
> item (per batch) — exactly per the decision that evidence is resolved on the
> batch page, not in the wizard.

---

## 6. Smart fix-link routing

Corrects the earlier rough guess — each blocker links to *where it's actually
fixed in this codebase*:

| Blocker | Level | Fix target | Internal/External |
|---|---|---|---|
| Facility not linked to Isometric project | Removal | `/certification/settings?tab=connection` | **In-app** (the settings section links out to Isometric to find/create the project) |
| No / missing default removal template | Removal | `/certification/settings?tab=connection` | In-app |
| Unresolved template blueprints | Removal | Isometric registry (template) ↗ | External |
| Cross-batch transport not uniform | Removal | `/deliveries` | In-app |
| Production data not linked | Batch | applications / production-runs | In-app |
| Transport leg missing | Batch | `/deliveries` (`?transportLeg=create`) | In-app |
| Durability / feedstock / sale fields | Batch | batch edit (this page) | In-app |
| Carbon accounting unresolved | Batch | batch edit + lab data | In-app |

Settings route + tab confirmed at
`src/app/(app)/certification/settings/page.tsx` → `?tab=connection`
(`facility-certifier-section.tsx:106-204`). Deliveries at
`src/app/(app)/deliveries/page.tsx`; transport legs opened via
`?transportLeg=create` (`transport-legs-panel.tsx:25-30`).

---

## 7. "View on Isometric" link

`src/lib/isometric/links.ts` already exposes `isometricRegistry.project(id)` →
`https://registry.isometric.com/project/{id}` (known-working, used in settings).
We need an analogous `removal(externalId)` builder, plus the success-state link
in the submit step.

**⚠ URL is unverified.** Two conflicting candidates:
- existing code convention → `https://registry.isometric.com/removal/{id}`
- MCP `how_to` → `https://app.isometric.com/removals/{id}` (prod) /
  `sandbox.isometric.com` (sandbox)

These disagree on domain *and* path. **Do not ship a guess.** Confirm the real
URL before wiring (inspect a real submitted removal, or `isometric_docs_*`), and
respect sandbox vs production (`ISOMETRIC_ENVIRONMENT`, `env.ts:64-67`). Tracked
in `docs/open-questions.md`.

---

## 8. Edge cases & decisions

- **Facility setup gate.** If the facility has no mapping/template, batch
  transport-health can't be judged. The wizard's Step 1 shows a top banner —
  *"Finish facility setup to certify"* → settings link — and transport health on
  the batch page reads *"Can't evaluate yet — facility setup incomplete."* Other
  batch-data checks still evaluate.
- **Server is authoritative.** `createRemovalWithBatchesAction` re-computes batch
  health server-side and rejects any non-healthy or cross-facility / already-
  grouped batch. Client gating is UX only.
- **Cross-batch transport uniformity** (`hasAggregationWarning`) is genuinely
  cross-batch → lives in Step 2, not batch health.
- **Regroup locking** unchanged: a removal with a live/blocking submission is
  frozen (`canRegroupRemoval`, server `removalHasBlockingSubmission`). The modal
  hides membership edits when frozen.
- **Abandoned drafts.** "Resolve later" leaves a real draft removal. Existing
  orphan GC (`gcRemovalIfOrphaned`) handles removals that end up empty; a
  confirmed removal with members simply shows as a resumable draft.
- **Accessibility / design system.** Modal + cards follow existing dialog
  conventions (Esc to close, focus trap, brutalist square corners, 1px spacing
  scale, design tokens — never hardcoded values).

---

## 9. Architecture — files to create / modify

Layered per CLAUDE.md (component → hooks → fn → data-access → db).

### New
- `src/lib/certification/batch-health.ts` — pure per-batch health classifier
  (mirrors `readiness.ts` at batch grain) + `BatchHealthFacts` / `BatchHealth`
  types and the fix-link descriptors.
- `src/fn/certification/batch-health-context.ts` — server loader: gather per-
  batch facts (lineage runs, transport legs, field completeness) for a facility's
  ungrouped batches and for a single batch.
- `src/fn/certification/create-removal-with-batches.ts` — `"use server"` bulk
  create (deferred-create), server-authoritative health re-validation, returns
  `ActionResult<{ removalId }>`.
- `src/hooks/use-batch-health.ts` — query hook(s) for batch health (list + single).
- `src/app/(app)/credit-batches/[id]/page.tsx` — batch detail route (async params).
- `src/components/credit-batches/credit-batch-health-panel.tsx` — health check UI.
- `src/components/certification/new-removal-dialog/` — the modal wizard
  (`index.tsx`, `select-batches-step.tsx`, `requirements-step.tsx`,
  `submit-step.tsx`).

### Modify
- `src/lib/certification/links.ts` (isometric) — add `removal(externalId)`
  builder *(after URL verified)*.
- `src/lib/certification/readiness.ts` — split helper so the wizard can request
  the **facility-level subset** of the checklist (batch-level rows move to
  batch-health).
- `src/data-access/certifier-removals.ts` — add bulk assign used by the new
  action; extend `listUngroupedCreditBatches` to return display fields +
  health verdict.
- `src/data-access/credit-batches.ts` — `getCreditBatchById` already exists;
  ensure it returns lineage needed for health.
- `src/components/certification/removals-list.tsx` — add "New removal" primary
  CTA; retire the "Group into…" dropdown.
- `src/components/certification/submission-status-badge.tsx` / overview — surface
  resumable drafts.
- `src/app/(app)/certification/removals/[removalId]/review/page.tsx` — redirect
  to overview + open modal (consolidate the 5-step route).

### Reused largely as-is
- `submitRemovalAction`, `submit-removal.ts`, `SubmitConfirmDialog`,
  `useSubmitRemoval`, `deriveRemovalReadiness`, `buildRemovalPreflightChecklist`,
  `useCertificationOverview`, `EnvBanner`, `StatusBadge`.

### Retired / dissolved
- Eager 1:1 "Group into…" creation UI.
- Standalone `Evidence` step (→ batch-health "Evidence documents").
- `Review` + `Assemble` steps (→ the modal's select step + summary).

---

## 10. Build sequencing (when approved)

1. **Batch health foundation** — `batch-health.ts` classifier (+ unit tests),
   `batch-health-context.ts` loader, `use-batch-health.ts`.
2. **Batch detail page** — `/credit-batches/[id]` + health panel; wire fix links.
3. **Deferred-create action** — `create-removal-with-batches.ts` + data-access
   bulk assign + extend ungrouped listing.
4. **Modal wizard** — select → requirements → submit; "New removal" CTA;
   "Resolve later"; consolidate/redirect the old review route.
5. **Isometric link** — verify URL, add `removal()` builder, success-state link.
6. **E2E** — Playwright spec for create → resolve-later → resume → submit
   (`adminPage` + `seededData`).

---

## 11. Open questions / to verify

1. **Isometric "view removal" URL** — verify domain + path + sandbox/prod
   before wiring (§7). → `docs/open-questions.md`.
2. **Authoritative biochar required-input set** — run `protocols_analyze` on the
   biochar protocol (+ ghg-accounting, biomass-feedstock-accounting,
   biochar-storage-soil-environments modules) to confirm the health-check item
   list in §5 is complete and correctly conditional.
3. **"Evidence documents" required set** — which docs are strictly required per
   batch (COA? lab report? photos?) vs recommended.
4. **Facility-setup gate UX** — confirm the banner-in-Step-1 approach vs a hard
   pre-gate before the modal opens.
```

