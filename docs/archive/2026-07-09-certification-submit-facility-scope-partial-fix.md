# Certification submit surface — resolved-facility scope seam (partial fix, 2026-07-09)

Dated implementation log for the `fix/certification-submit-facility-scope` slice
of issue #277. The evergreen, still-open summary lives in
[`docs/open-questions.md`](../open-questions.md) under
`security/certification-submit-authz`; this file records exactly what shipped so
the open-questions entry stays evergreen.

## What shipped (PR "fix: facility-scope the certification submit surface")

- Added a resolved-facility scope **seam** in `data-access/certification.ts`:
  `facilityIdsForLocalEntities`, `resolveSubmissionFacilityId`, and
  `assertSubmissionInFacility` resolve a submission's owning facility from its
  anchor row (Removal / GHG Statement, both carry `facilityId`) — never a
  client-supplied field — and throw `SafeError` on a mismatch or unresolvable
  anchor (fail-closed).
- The id/key-addressed reads `getSubmissionById`, `getLatestSubmission`, and
  `getLatestSubmissionsForEntities` gained an optional `expectedFacilityId`
  parameter that applies the seam when supplied.
- `submitGhgStatementToVerifier`, `refreshGhgStatementStatus`, and
  `submitTelemetry` thread the facility they resolve from the anchor row into
  those reads; `createGhgStatementDraft` asserts its get-or-created statement
  lives in the requested facility.
- Added `tests/certification-facility-scope.test.ts` (DB-backed) covering the
  seam contract: correct-facility pass, wrong-facility reject, unscoped-passthrough,
  and dangling-anchor fail-closed.

## Honest characterisation of the guarantee (read before extending)

This slice is a **defence-in-depth seam plus fail-closed-on-dangling-anchor**,
**not** cross-facility (IDOR) authorization. Every wired caller derives its
`expectedFacilityId` from the *same* anchor id it is operating on (the GHG
statement / removal id the client supplied), so the live comparison is
lineage-consistency: its only reachable rejection today is a dangling /
unresolvable anchor. A genuine cross-facility id swap cannot be rejected until an
**independent** facility value exists to compare against — a real membership
check or a session-level active-facility context. That is deferred to **#372 /
ADR 0010**. The seam is left wired so the guard activates the instant such a
value lands, without re-touching every call site.

## Explicitly NOT touched by this slice

- `submitRemovalAction` (`fn/certification/submit-removal.ts`) and
  `createRemovalWithBatchesAction` (`fn/certification/create-removal-with-batches.ts`)
  — still resolve their target by client-supplied id under `requireAuth` only;
  no facility seam wired (they already server-derive facility from the row, and
  `createRemovalWithBatchesAction` blocks cross-facility *mixing*).
- The three admin mapping/emission actions (`saveFacilityCertifierMapping`,
  `deleteFacilityCertifierMapping`, `saveFacilityEmissionConfig`) — remain gated
  by the **global** `requireAdminAction()` only.

All of the above depend on the membership model (#372) to gain real per-user /
per-facility authorization; do not close #277's parent concern until it lands.
