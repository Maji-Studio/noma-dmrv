# Mobile Design QA Pass — 2026-06-14

Follow-up to the mobile/operator responsive pass (phases 0–4, see the
`tests/e2e/mobile-responsive.spec.ts` regression guard). Focus this round:
hunt and fix **bad mobile layouts** — overlapping, two-column-where-one-fits,
cramped navigation, side sheets not going full-screen. Verified in **Chromium**
at the iPhone-12/13/14 viewport (390×844) via a throwaway screenshot harness
driven by the existing `adminPage` + `seededData` fixtures (Better Auth API
sign-in, real dev server on :3100).

## Method

- Throwaway spec `tests/e2e/_mobile-audit.spec.ts` (removed after the pass)
  captured **viewport-only** screenshots (`fullPage:false` — `fullPage`
  distorts `position:fixed h-full` sheets because `h-full` resolves against the
  expanded capture height) of: create side sheets (facilities, customers,
  production-runs), the read-only view sheet (reactor row), the nav drawer, and
  dense pages (dashboard, energy, certification, chain-of-custody).
- Each fix re-verified at 390×844 **and** at 1280×900 (desktop regression).

## Audited & already good (no change)

- **Side sheets are already full-screen on phones.** `SlideOverPanel.Content`
  is `w-full` below `sm` (full width + `h-full`); the size token only applies at
  `sm`+. The "N" badge / red "1 Issue" pill overlapping the footer CTA in
  screenshots is the **Next.js dev indicator** (dev-only, bottom-left fixed),
  not a layout bug.
- **Modal** is already mobile-first (`w-full sm:w-[Npx]` + `max-w-[calc(100vw-32px)]`).
- **Nav drawer** (right-anchored Base UI dialog, ~80% width + scrim), **create
  forms** (single-column, FormSpine), **dashboard** (stacked KPI cards; the
  pipeline/custody-flow `grid-cols-2` are compact stat tiles, intentionally not
  stacked), **energy**, **certification settings** (tab bar `overflow-x-auto`) —
  all render cleanly with no horizontal overflow.

## Fixed

1. **Read-only `DetailRow` cramped at two columns on phones**
   (`src/components/ui/detail-panel/index.tsx`).
   The shared `DetailRow` was a hard `flex gap-16` two-column row. At 390px each
   field got a ~170px half-column, so long values wrapped badly ("Method A
   (Every Batch)", "E2E Seed Facility …", entity codes/names). Changed to
   `flex flex-col gap-16 sm:flex-row` — stacks to one column below `sm`,
   side-by-side at `sm`+ (**desktop unchanged**). Fixes every entity **view
   sheet** at once, plus `EntityDetailPanel`, `credit-batch-detail`, and the
   chain-of-custody `chain-node-sheet`.
   Verified: reactor view sheet single-column on mobile, two-column on desktop.

2. **Credit-batch registry grid two columns on phones**
   (`src/components/credit-batches/credit-batch-form.tsx`).
   Read-only "Registry & accounting" `<dl>` was `grid-cols-2 md:grid-cols-3`.
   Added a phone breakpoint: `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`
   (matches the codebase responsive ladder). Low-risk CSS-only change; verified
   by pattern (the edit form's registry section needs an existing credit batch
   in edit mode, not reachable from the empty seeded list).

3. **Mobile nav drawer made full-width on phones** (follow-up, on user
   request — `src/components/navigation/mobile-nav.tsx`). The drawer was
   `w-[304px] max-w-[88vw]` (~84% of a phone, leaving a page sliver behind the
   scrim). Now `w-full sm:w-[360px]` — full-screen on phones, locked to a 360px
   drawer at `sm`+ so it isn't a full-bleed sheet on a small tablet (still shown
   up to `md`). Dropped the `max-w` cap (it would have clipped `w-full`).
   Verified in Chromium: drawer width = 390 at a 390px viewport, 360 at a 700px
   viewport. Regression assertion added to the `mobile-responsive.spec.ts` nav
   drawer test.

4. **Production-run energy fields cramped at two columns on phones** (follow-up,
   on user report — `src/components/production-runs/production-run-form.tsx`).
   The energy block (`grid-cols-2 md:grid-cols-4`: Startup/Plant Diesel, Genset
   Diesel, Preprocess Fuel, Electricity) stayed two-column on phones; a parallel
   rename to longer labels ("Startup / Plant Diesel (L)") made each one wrap to
   three lines with the `CERT` badge + info icon floating. Changed to
   `grid-cols-1 sm:grid-cols-2 md:grid-cols-4` — one column on phones (label +
   badge + icon on one line, full-width input), unchanged at `sm`+. This was the
   only non-stacking grid left in the form (every other section already used
   `grid-cols-1 md:grid-cols-2`). The single-column fields and the FormSpine
   rail are fine width-wise, so no further change. Verified in Chromium at
   390×844.

   _(Originally deferred during the first pass because this file was under active
   parallel edits; applied once that work landed and the file was clean.)_

## Deferred (actionable later)

- None outstanding from this pass.

## Verified

- `pnpm exec eslint` on the two touched files — clean.
- `pnpm typecheck` — 0 errors.
- `pnpm exec playwright test tests/e2e/mobile-responsive.spec.ts` — **26 passed**,
  including a new regression test, *"entity view sheet stacks paired detail
  fields to one column on mobile"*, asserting the Identifier field renders below
  (not beside) the Code field at 390×844.
- Browser (Chromium): reactor view sheet re-shot at 390×844 (stacked) and
  1280×900 (two-column, identical to before).
