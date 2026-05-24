# The GHG Statement is an independent, period-anchored artifact

> Delivers the "future, independent GHG-statement feature" deferred by
> ADR 0003 (`docs/adr/0003-removal-as-submission-unit.md`).

## Context

ADR 0003 established that the Isometric **Removal** is the submission unit
and decoupled GHG Statements from the submit path, leaving
`src/fn/certification/ghg-statements.ts` dormant "for a future, independent
GHG-statement feature." This ADR records delivering that feature
(integration-plan Phase 4.5).

A GHG Statement is an arbitrary, supplier-chosen reporting period that rolls
up multiple Removals. Isometric's create API shapes the whole feature: a
statement is created from **only `{ project_id, end_on }`**. Isometric links
Removals to it **server-side, by reporting-period date range** —
`GhgStatement.removal_ids` is read-only and `reporting_period_start_at` is
server-derived. There is no way to pass an explicit removal list.

## Decision

- A GHG Statement is held locally by a new facility-scoped
  `certifierGhgStatements` row — `reportingPeriodEndOn` chosen by the
  operator, `reportingPeriodStartOn` server-derived (null until reconciled).
- `certifierRemovals` gains a nullable `ghgStatementId` FK — set by
  reconciliation from the statement's `removal_ids`, **never user-assigned**.
- Creation is **period-first**: the operator picks an `end_on`; the UI
  *predicts* which local Removals will be linked (by `completedOn`); after
  the POST the actual `removal_ids` are reconciled back onto local rows.
- The ledger row is keyed
  `(provider, 'ghg_statement', 'ghgStatement', certifierGhgStatements.id)`.
  The local statement id is **stable per `(provider, facility,
  reporting-period end)`** — `getOrCreateGhgStatementDraft` returns the
  existing row rather than minting a new one — so a repeat create finds the
  prior ledger row and the submission-claim machinery resolves the race:
  an in-flight create blocks, an already-created one returns its external
  id, a stale or failed draft resumes. The mapping-lock ledger variants
  (which guard a removal template) are still not used — a GHG Statement
  has no template.
- **One GHG Statement per period.** Two statements for the same
  `(provider, facility, reporting-period end)` are blocked by the
  `certifier_ghg_statements_facility_period_unique` constraint, so a
  double-click or two-tab race cannot mint a second Isometric registry
  artifact. Membership reconciliation and the final-create state writes
  commit in a single transaction.
- Membership reconciliation **never steals**: a removal already linked to a
  different statement is left unchanged and a warning is surfaced. The
  decision is a pure function (`decideRemovalMembership`); the data-access
  layer applies it under a `SELECT … FOR UPDATE` + `IS NULL` guard.
- The surface is a provider-neutral `src/app/(app)/certification/` route
  group (tile hub + `removals/` + `ghg-statements/`). The section name is
  provider-neutral; the artifacts stay Isometric-specific this iteration.
- Full lifecycle: create draft → submit to verifier (report URL →
  `AWAITING_VERIFICATION`) → status refresh.

## Why

Modelling the GHG Statement as its own period-anchored artifact removes the
false equivalence "statement ≡ credit batch" (the superseded ADR 0002
model). It matches Isometric's actual data model, where a statement is a
reporting period and a Removal is the creditable unit. Period-first
creation is the only design the create API permits.

## Consequences

- Migrations `0023`–`0025` are additive — `0023` the
  `certifier_ghg_statements` table + `certifier_removals.ghg_statement_id`
  column, `0024` the FK index, `0025` the
  `certifier_ghg_statements_facility_period_unique` constraint on
  `(provider, facility_id, reporting_period_end_on)`.
- The period preview is a *prediction*: `reporting_period_start_at` is
  unknown pre-create, so the stepper partitions only by `completedOn`.
  Post-create reconciliation is the source of truth; drift is surfaced in
  a result panel and in `certifier_sync_events`.
- One GHG Statement per `(provider, facility, reporting-period end)` is
  enforced by the `certifier_ghg_statements_facility_period_unique`
  constraint (migration `0025`). Isometric itself permits multiple drafts
  per period, but noma deliberately does not — a second statement for a
  period would be a duplicate registry artifact with no operator intent
  behind it. `getOrCreateGhgStatementDraft` makes the create idempotent
  per period rather than surfacing the constraint as an error.
- `findDraftGhgStatementsByPeriod` paginates all `/ghg_statements` on the
  reconcile-on-error path — acceptable at current scale; a future
  optimization.
