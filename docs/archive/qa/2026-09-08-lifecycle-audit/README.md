# CRUD and Isometric lifecycle audit

This audit examines create, edit, delete, synchronization and recovery behavior across noma's routes and entities at staging `ef857545b11fa298f0f08e128868ed14e37fbf5f` on 2026-09-08. Use it to prioritize fixes, understand operator recovery, and distinguish proven defects from untested scenarios. It contains analysis and isolated simulations only; application source and shared staging/Isometric records were preserved.

## Overall assessment

The brittleness is real, but uneven. Production-run concurrency, stock withdrawal guards, immutable certification snapshots, registry deletion fences and the recent Storage Location recovery have substantial tested protection. Adjacent mutation paths bypass some of those protections or misreport partial success. The main strategy should be consistent enforcement at existing write operations plus explicit recovery states, rather than a broad CRUD rewrite.

The most urgent reproduced problems are:

1. **Stock integrity:** a stocked bin can change material role and hide its balance; an intake reduction can commit negative stock.
2. **Partial deletion:** supplier locations can be removed before a failed supplier delete.
3. **Authorization consistency:** Feedstock Type quick-add permits a Member write that the canonical Admin-only operation refuses.
4. **Registry liveness:** the request timeout stops at response headers and leaves body reads unbounded.
5. **Onboarding:** anonymous invitees are redirected to login before the account-bootstrap page can run.

Other confirmed problems include inconsistent partial-update/null handling, stale form overwrites, blocked GIS edits, uncertain upload retry identity, and “not saved” messages after known partial success. Two further high-priority **static** findings need dedicated DB regression fixtures: delivery status/date edits can invalidate existing Applications, and shared customer-location changes can recalculate transport protected by direct-edit certification guards.

Registry recovery is intentionally conservative. A confirmed missing Storage Location can be recovered; ambiguous reads and existing conflicting Biochar claims should not be recreated blindly. Some review-required states still have no implemented repair procedure. Calling them “contact support” does not complete the lifecycle.

## Status (2026-09-16)

Findings are tracked against the ledger in [findings.md](findings.md). Verified against staging `af9f2703` on 2026-09-16.

| Finding | Status | Where |
|---|---|---|
| F14a, F14b, F28, F08, F05 | Fixed | PR #758 |
| F09, F20, F21, F27 | Closed or superseded | PRs #749 to #753, #759 |
| F29 | Fixed by field allowlisting in the delivery writer | PR #759; status-field residue in #775 |
| F23 (output lanes) | Fixed: idempotent posts and bounded reversal | PR #759 |
| F23 (feedstock loss lane) | Open, product decision pending on reversal | Issue #773 |
| F06, F01 | Open | Issue #767 |
| F03 | Open | Issue #768 |
| F04, F25 | Open (credit-batch update half fixed) | Issue #769 |
| F02, F07, F10 | Open | Issue #770 |
| F11 | Open | Issue #771 |
| F19 | Open | Issue #772 |
| F13, F17 | Open | Issue #774 |
| F12, F15, F16, F22, F24, F26, F30 | Not yet scheduled | See findings.md |
| F18 | Negative result, no action | findings.md |

## Read the deliverables

| Artifact | What it answers |
|---|---|
| [Coverage matrix](coverage.md) | Every route/entity family × create/edit/delete × lifecycle state, with actual inspection/test depth |
| [Exact inventory](inventory.md) | All 54 page/handler routes, all 280 exported async server actions, and database table inventory |
| [Prioritized findings and recovery copy](findings.md) | Reproductions, expected behavior, certainty about saved/sent/deleted state, safe retry, resolver role, and actual route/button |
| [Lifecycle strategy and implementation plan](strategy-and-plan.md) | Consistent mutation contracts, distinct local/evidence/registry policies, ordered reviewable slices, dependencies and acceptance tests |
| [Verification and rerun instructions](verification.md) | Exact tests, limits, public contract evidence, build-manifest result and disposable simulation runner |
| [Production investigation](production.md) | Detailed production, stock, formulation, batch and provenance evidence |
| [Distribution/evidence investigation](distribution-evidence.md) | Detailed party, logistics, Application, Sample, document and upload evidence |
| [Registry investigation](registry.md) | Detailed Isometric journals, locks, deletion, reports, telemetry and recovery evidence |

Independent supplemental reports are also retained: [foundation](supplement-foundation-review.md), [operations](supplement-operations-review.md), [certification](supplement-certification-review.md). Their preliminary severity/proof labels are subordinate to the parent [finding ledger](findings.md). In particular, a suspected public Server Action exposure was **not demonstrated**: the isolated build registered none of the flagged helpers.

## What was verified

- Clean isolated checkout matched the remote staging SHA and handoff baseline.
- Three primary **gpt-6-astra, low** read-only Codex CLI investigators ran in parallel while the parent verified findings and synthesized coverage. A coordinated second task supplied independent corroboration without further expansion.
- **386 existing tests passed across 30 suites**, including real stock/claim/deletion/auth transactions on a disposable PostgreSQL 18 database and mocked external adapters.
- **14 isolated observations reproduced baseline defects**. Passing here means the expected defect occurred, not that the feature is correct. Eight observations used real PostgreSQL; the remainder used actual modules/actions with mocks.
- Organization-scope checker, typecheck and isolated production build passed. The complete migration chain worked on the empty audit database.
- Public Isometric OpenAPI was retrieved and fingerprinted. Isometric MCP `how_to` was unavailable; provider consistency, replay and project-specific amendment contracts remain qualified.

No browser end-to-end walkthrough or new live registry transaction was performed. Static findings are labeled; no claim of exhaustive failure-state completeness is made. Earlier successful staging submission evidence was retrieved from the linked PR comments, not repeated destructively.

## Recommended first implementation batch

Restore invitation admission with its token/email guards intact; unify Feedstock Type creation; make supplier/customer aggregate writes atomic; close bin/supply invariant gaps; and fix the registry body deadline. In parallel, add the two static dependency/freeze fixtures before implementing those findings. Then address partial update semantics, GIS/upload recovery, stable mutation identities and durable cleanup state.

These changes have concrete triggers and meaningful regression tests. Product decisions about historical bin role changes, loss reversal, provenance allocation and finalized registry amendment should be resolved separately, without delaying the straightforward correctness fixes.

## Preservation

Only this archived audit bundle was added to the checkout. No application code, migration, credential, original dirty checkout, commit, PR or shared staging/Isometric record was changed. The disposable parent database container was stopped and removed after verification. The successful Removal and linked registry records named in the handoff remain untouched by this task.
