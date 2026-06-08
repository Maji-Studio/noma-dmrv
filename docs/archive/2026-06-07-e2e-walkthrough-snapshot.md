# E2E walkthrough snapshot — 2026-06-07

Run-specific snapshot captured during the manual browser walkthrough of every
entity + certification. The evergreen open questions this surfaced live in
`docs/open-questions.md` (§ "E2E walkthrough follow-ups"); this file preserves
the dated run context and registry counts that prompted them so the open
questions can stay decision-focused.

## Walkthrough context

- Source: manual browser walkthrough of every entity + certification, planned
  in `docs/archive/2026-06-07-e2e-findings-fix-plan.md`.
- Outcome: the P0/P1/P2 items and two P3s (D2 Method-B gate, C4 code-prefix
  alignment) were fixed in that pass. Two items were deferred by product
  decision and remain tracked as open questions.

## Registry state observed (sandbox)

- Sandbox project: `prj_1K9YJ33RKSBX9FFF`.
- The in-app cert view showed **0 removals / 0 GHG statements** for the open
  period, while the live sandbox registry held **7 draft GHG statements** and
  **12 removals**. Period math aligned (the app preview's "0 removals" for the
  open period matched the registry draft), supporting the conclusion that the
  app surfaces only what *it* created, not the full registry state.
- The sandbox project had accumulated roughly **12 draft removals across test
  cycles**, consistent with the reseed-idempotency gap (local row UUIDs change
  on `pnpm db:reset`, so re-submission can't match the prior registry entity
  and creates a duplicate).
