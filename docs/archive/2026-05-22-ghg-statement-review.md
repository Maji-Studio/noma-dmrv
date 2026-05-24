# GHG Statement review follow-ups — 2026-05-22

Post-delivery review fixes applied to the GHG Statements feature
immediately after its initial delivery (see
`docs/isometric/changes.md` for the live changelog and
`docs/adr/0004-ghg-statement-as-independent-artifact.md` for the
decision record). Archived from `docs/isometric/changes.md` because
this is an implementation log of one-off review fixes, not evergreen
documentation.

- **One statement per period — double-create dedup.** The local statement
  id is now stable per `(provider, facility, reporting-period end)`:
  `getOrCreateGhgStatementDraft` returns the existing row instead of
  minting a fresh one, so a double-click / two-tab race resolves through
  the submission-claim machinery (block in-flight, return the
  already-created external id, resume a failed draft) instead of POSTing a
  second Isometric registry artifact. Backed by the new
  `certifier_ghg_statements_facility_period_unique` constraint — migration
  `0025`, additive.
- **N+1 queries removed.** `loadGhgStatementsForFacility` and
  `loadGhgStatementState` now batch their per-row ledger lookups via
  `getLatestSubmissionsForEntities` (`DISTINCT ON`) and
  `countRemovalsByGhgStatementIds` (grouped count).
- **`finalizeGhgStatement` made atomic.** The post-create reconciliation —
  removal membership, server-derived reporting window and ledger state —
  commits in one transaction; `reconcileRemovalMembership` and the ledger
  write helpers accept an optional `tx`. The external id is still
  persisted standalone first so a failure can never lose the registry link.
- Deferred review findings (error boundary, report-URL host allowlist,
  shared-component a11y) logged to `docs/open-questions.md`.
