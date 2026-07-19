# Restore dashboard structural certification gaps

## Goal

Prevent a false `All clear` dashboard state by restoring the structural certification gaps removed with the Flow Hero redesign.

## Tracker

- Issue: [#470](https://github.com/Maji-Studio/noma-dmrv/issues/470)
- Branch: `fix/restore-dashboard-certification-gaps`
- Base: `origin/staging` at `2fcb8ff7`
- Blockers: none

## Acceptance criteria

- The dashboard surfaces facility GPS, feedstock GPS, transport endpoint GPS, and non-document-backed transport-distance gaps.
- Counts are organization- and facility-scoped and exclude archived parent records where applicable.
- Missing or non-`document` distance provenance remains a fail-closed gap.
- Structural gaps contribute to exact open and blocking totals, so any nonzero gap prevents `All clear`.
- Facility, feedstock, and cross-cutting transport gaps link to the appropriate remediation surface without changing station badge semantics.
- Regression coverage proves all four gap types surface and prevent false green; a zero-gap state remains `All clear`.

## Scope

In scope: restore the former `loadGpsGapCounts` and `loadTransportGapTotals` semantics in the current dashboard model; add the smallest dedicated structural-gap presentation and tests.

Out of scope: new certification rules, sampling cadence, Credit batch Roll-up refactors, production-run state transitions (#254), or document-parent deletion cleanup.

## Verification

- Targeted data-access tests for scoped structural-gap counts and totals.
- Dashboard E2E coverage for nonzero structural gaps and zero-gap `All clear`.
- `pnpm lint`
- `pnpm typecheck`
