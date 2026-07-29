# Confirm & submit rework — implementation handoff (2026-07-28)

Fold prototype **variant A ("Receipt")** into the real confirm-&-submit step of
the New removal wizard, then delete the prototype.

Prototype (source of truth for markup and copy):
`src/components/certification/new-removal-dialog/prototype/` — read its
`NOTES.md` first, then `variant-a-receipt.tsx`, `submission-facts.ts`,
`prototype-parts.tsx`. The prototype is throwaway code (no tests, no error
handling); port the structure and the strings, not the shortcuts.

## Why

The shipped step makes the operator choose a mode (Review / Technical details)
before reading anything, prints the same tonnage three times, gives its loudest
element to a static footnote, and stacks three separate boxes that all say
"fine" when everything passes. Copy is compiler vocabulary ("Compilation
ready"), not operator language.

## Target shape

One vertical read, no tabs, no section eyebrows:

1. **Verdict line** — state icon + headline + one sentence, on a 2px left rule
   coloured by state.
2. **Blockers list** — only when no check already covers the fault (see rules).
3. **Sending panel** — "You are sending" → tonnage as `title-heading-2 font-mono`
   → caption "Biochar, dry mass. Isometric calculates stored and net CO₂e after
   submission." Then the fact rows: Destination · Crediting window · Credit
   batch(es) · Traced back to · Durability · Sampling · Supporting files (only
   when pending > 0).
4. **Checks** — collapsible, **rendered only when at least one check needs
   attention**, open by default, trigger "What to fix" with
   "N checks passed" on the right.
5. **Warnings** — "Recorded but not submitted", only when non-empty.
6. **`EnvBanner`** — production only.
7. **Debug drawer** — closed accordion wrapping `CompiledSubmissionReview`.
8. The existing submit row stays exactly as it is.

## Files

| Action | File |
| --- | --- |
| new | `new-removal-dialog/submission-facts.ts` — port from the prototype, minus `SubmitPrototypeProps` |
| new | `new-removal-dialog/submission-summary.tsx` — verdict line, blockers, sending panel, fact rows |
| new | `new-removal-dialog/debug-drawer.tsx` — accordion around `CompiledSubmissionReview` |
| edit | `new-removal-dialog/submit-step.tsx` — drop the `<h3>Confirm &amp; submit</h3>` block, render the new components, delete the prototype seam (3 marked spots) |
| edit | `new-removal-dialog/submission-checks.tsx` — adopt the prototype's `CheckRows` styling and the new trigger copy; caller decides whether it renders at all |
| keep | `new-removal-dialog/compiled-submission-review.tsx` — becomes the Debug body, unchanged |
| keep | `new-removal-dialog/compilation-notices.tsx` |
| delete | `new-removal-dialog/submission-review-tabs.tsx` (tabs + `CompilationStatus`) — move `isRemovalCompilationReady` into `submission-facts.ts`, it has two other callers |
| delete | `new-removal-dialog/submission-overview.tsx` |
| delete | `new-removal-dialog/prototype/` (whole folder) |

Watch the import of `isRemovalCompilationReady` in `submit-step.tsx` when
`submission-review-tabs.tsx` goes.

## Component reuse — checked, use the local ledger idiom

The fact rows read like a table, but no shared component fits:

- **`DetailField` / `DetailRow`** (`ui/detail-panel`) is a *stacked* label-over-
  value pair, two per row at `sm`+. It is the read-side-sheet mirror of
  `FormSection`; using it here turns seven one-line facts into a bulky
  two-column grid and mismatches the form it is supposed to mirror (there is no
  form behind this screen).
- **`DataTable`** is a framed panel with toolbar, sortable headers and
  pagination. Seven static rows with no column semantics do not earn it.

What *does* exist is a house ledger row, already used by the neighbouring
certification surfaces — `carbon-breakdown.tsx:148-165` is the reference:

```tsx
<div className="flex items-baseline justify-between gap-12">
  <span className="body-small text-[var(--color-text-secondary)]">{label}</span>
  <span className="body-small text-[var(--color-text-primary)]">{value}</span>
</div>
```

Match it (the prototype already does, plus a hairline `border-t` and
`px-20 py-8` since these rows sit inside a bordered panel). Keep the row
component local to `submission-summary.tsx`. Do **not** extract a shared
`LedgerRow` in this change: two call sites with different padding is not yet a
component, and `docs/organization.md` puts the seam at the third caller.

## Copy — exact strings

| Old | New |
| --- | --- |
| tab "Technical details" | **Debug** (accordion trigger, `label-micro`, with "Compiled registry payload" on the right) |
| "Compilation ready" / "The registry submission compiled successfully." | **Ready to submit** / **All {N} checks passed. Nothing left to fix.** |
| "Compilation blocked" / "Resolve every compiler blocker before submitting." | **Cannot submit yet** / **Clear the blockers below.** |
| (no equivalent) | **1 issue blocks submission** / **Review the issue below.** (pluralised for multiple issues) |
| "Compilation in progress" / "Preparing the Isometric submission for review." | **Preparing the submission** / **This takes a moment.** |
| "Compilation unavailable" | **Cannot submit yet** / **The submission did not build. Retry, then open Debug if it fails again.** |
| dark "Registry calculation authority" tile | caption under the tonnage: **Biochar, dry mass. Isometric calculates stored and net CO₂e after submission.** |
| "Submitted biochar (dry)" (×3) | **You are sending** + the figure, once |
| "1000-Year (R₀ Reflectance)" | **1000-year (R₀ reflectance)** |
| "Unsampled" | **Not sampled** |
| "N files will be mirrored automatically when you submit." | **N files upload on submit** |
| "Captured but not represented" | **Recorded but not submitted** |
| "Submission checks · N of M checks passed" | **What to fix** + **N checks passed** |
| heading "Confirm & submit" + "Review exactly what will be sent to the registry." | dropped — the step rail already says it (see Tests) |

Durability sentence case comes from a local map in `submission-facts.ts`
(`200_year` / `1000_year`); the shared `formatDurabilityOption` still returns
title case and is used elsewhere. Do not change the shared helper here.

## Behaviour rules

1. **Verdict precedence** (`buildSubmissionFacts`): loading → checks needing
   attention → compilation error/absent → compilation not ready → ready. Checks
   outrank compiler blockers because a check names the record and links the fix
   ("Production run PR-26-001 ends on 2028-01-02.") where the blocker says the
   same thing in compiler words
   ("Latest production run ends at 2028-01-02T15:00:00.000Z.").
2. **Blocker suppression** — render `compilation.blockers` only when
   `checksAttention === 0`. Otherwise the operator reads the same fault twice.
3. **Checks are conditional** — when every check passes, the list does not
   render at all; the verdict line carries "All N checks passed."
4. **Sandbox is demoted, production is not.** Sandbox appears only as
   "(Sandbox)" inside the Destination row; production still renders the full red
   `EnvBanner`. This is deliberate: the banner exists to stop an accidental real
   write, and sandbox cannot cause one.
5. **Submit gating is unchanged.** `requirementsMet` still comes from
   `deriveRemovalReadiness` + `isRemovalCompilationReady`; the summary is a
   read surface and must not gate anything itself.
6. `role="status"` on the verdict line, `role="alert"` when blocked. Debug and
   Checks triggers keep the Accordion's own `aria-expanded`.

## Data

Everything derives in `buildSubmissionFacts(ctx, compilation, checks)` — one
place, so the panel and the verdict can never disagree:

- tonnage `Σ memberBatches[].appliedDryWeightTons` via `formatTonnes(_, {digits: 1})`
- window: min `startDate` / max `endDate` across members, via `formatDateRange`
- destination `ctx.project?.name ?? ctx.mapping?.externalProjectId`
- `ctx.isProduction` → environment label
- pending files `compilation.review.pendingSourceCount`
- warnings `compilation.warnings` + `ctx.submissionWarnings`

## Tests

- **Delete** `submission-review-tabs.test.tsx` and `submission-overview.test.tsx`
  with their components.
- **Add** `submission-facts.test.ts` — pure, and the highest-value test here:
  verdict precedence (all five branches), blocker suppression when a check is
  unmet, plural/singular labels, multi-batch totals and window merge.
- **Add** `submission-summary.test.tsx` — renders the tonnage once (guard against
  the duplication this change removes), renders no checks list when everything
  passes, renders `EnvBanner` only in production.
- **Keep** `submission-checks.test.tsx` and `compiled-submission-review.test.tsx`,
  updating the trigger string.
- **E2E, must fix before merge:**
  `tests/e2e/certification-full-removal-submit.spec.ts:146` asserts
  `getByRole("heading", { name: "Confirm & submit" })`, which this change
  removes. Replace it with a body-resolved assertion that keeps the same intent
  ("the removal context resolved, not the loading/error fallback") — e.g.
  `dialog.getByText("You are sending")` — and leave the `[aria-current="step"]`
  assertion above it alone. `certification-new-removal-wizard.spec.ts` only
  asserts the step rail, so it is safe. Re-grep `tests/e2e/` for any other
  affected string before committing (`docs/design-system.md`, "Renaming a label
  is a test change").

## Out of scope, log as follow-ups

- `formatDateRange` emits an en dash ("Jan 2 – Jan 10, 2028"), which
  `docs/ux-writing.md` bans. Shared formatter, app-wide change, its own PR.
- Compiler blocker strings carry raw ISO timestamps and are operator-facing
  whenever compilation fails on its own. They need the treatment the readiness
  checks already got in Phase 0.

## Verification

`pnpm lint` · `pnpm typecheck` · `pnpm check:spacing-scale` · the new unit tests
· `pnpm test:e2e tests/e2e/certification-new-removal-wizard.spec.ts`. Then open
the wizard on a facility with a linked project and confirm both states: blocked
(local seed `QA 2026-07-25 Local Submission` facility reaches it) and ready
(**not reachable in local seed data** — its removal has 2028-dated runs; verify
against a facility whose records are in the past before calling this done).
