# Proposed lifecycle strategy and implementation plan

This is the reviewable remediation proposal from the 2026-09-08 audit, not an approved implementation or a broad rewrite. Read [findings](findings.md) for reproduced triggers and operator wording, and [coverage](coverage.md) for the entity/state inventory. Proposed delivery owner is the noma application team; product-policy decisions belong with the product owner. Status: proposed, not started. Last reviewed: 2026-09-08.

## One policy, distinct operation owners

Keep local operational records, accounting history, evidence, and registry claims distinct. They do not share the same valid mutations. A local save is not a registry submission, deleting a local document is not deleting its registry Source, and archiving a facility does not revoke its submitted history.

| Record class | Create / incomplete work | Edit | Retirement / correction |
|---|---|---|---|
| Master data: facility, party, reactor, material type, bin | Save minimum valid operational identity; readiness shows missing optional certification facts | Metadata may remain editable; identity/destination changes validate references and stock under the appropriate lock | Prefer archive when history exists; hard delete only when unreferenced and atomic. Provide correction for quick-added master data. |
| Operational events: intake, run, product, delivery, Application | Allow explicit incomplete states where the existing product supports them; never fabricate zero for missing measurement | Validate merged current state; derive masses centrally; stale-version conflict for full form saves | Refuse removal that invalidates stock/traceability/frozen evidence. Corrections must preserve real history. |
| Ledger entries: loss, allocation, certification claim | Persist command identity before acknowledging | Immutable once applied; exact replay returns same result | Constrained reversal/supersession referencing the original, reason, author, scope and allowed amount. No arbitrary positive stock adjustment. |
| Evidence | Allocate durable document/attempt ID, store bytes, verify, attach | Explicit metadata policy before/after review; immutable content versions when referenced | Retire inside owning DB transaction; object deletion outbox after commit. Pending or unknown upload is reconciled, not recreated blindly. |
| Registry mirrors/claims | Lock identity, journal intent, reconcile exact reference, then create if justified | Exact reuse, allowed provider update, new version, or review-required; never infer these from generic “drift” | Journal cleanup steps; delete only eligible owned/unshared records; preserve finalized history and uncertain outcomes. |

Keep existing implementation owners: data access owns authorization and effective-state invariants; the orchestration module owns external sequencing; hooks own draft/cache behavior; components display permitted actions and precise outcomes. A useful deep module hides that sequencing behind a small command/result interface. Do not add a universal CRUD framework or general workflow engine to achieve this.

## Mutation contract

1. Authenticate from the session at each public action, then enforce ownership/role in the canonical data-access operation. Quick-add calls the same operation. Internal context-taking cores remain internal.
2. Parse only client-owned values. In updates, omitted means unchanged, null means clear, and zero is an actual value. Reject keys that the client must not control.
3. Acquire the existing locks in a documented order. Re-read current rows, merge the patch, derive server-owned values, and validate all relevant invariants against that effective state. For full forms, compare the operator's expected version with the locked row.
4. Persist the local aggregate in one transaction. Do not split customer and child locations or supplier child/parent deletion across independently committed requests.
5. Separate durable commit outcome from enrichment, upload, audit and cache outcome. A known saved ID must not disappear because a follow-up read failed. For an unknown commit, provide a durable operation lookup rather than claiming rollback.
6. Retry a command using the same identity. Same key plus same payload returns the saved result; same key plus changed payload is a conflict. Auto-generated entity codes are not idempotency keys. Begin with losses, compound creation, uploads and other expensive/non-unique operations.
7. Invalidate the affected entity and relevant readiness/stock/dependency keys. Preserve an operator's unsaved draft after conflict; never rely on client invalidation to enforce correctness.

A result needs enough information for truthful copy: local state (`unchanged`, `saved`, `deleted`, `unknown`), external state (`not_started`, `confirmed`, `possible`), stable entity/operation identity, reason, blocker references, and available recovery action. Add fields narrowly to current ActionResult/domain results as workflows are fixed. Do not expose database jargon or keys to operators who do not need them.

## External state and recovery

| Known state | Permitted action | Required evidence |
|---|---|---|
| No external attempt | Validate/create | Current local facts, authorization, destination and readiness |
| Active attempt | Observe/wait | Current lease owner; do not overlap POST |
| Known remote ID | Read/reconcile that ID | Exact ownership, expected payload/reference and destination |
| Unknown POST outcome | Reconcile / review | Provider-supported lookup or replay contract; a failed GET is not proof of absence |
| Confirmed absent, safe replacement | Recover | Stable facts, exact references, dependency policy; existing Storage Location/Production Batch logic is precedent |
| Changed remote facts or conflicting claims | Review | Preserve original IDs/payload; identify actor and correction choice |
| Cleanup started | Finish cleanup | Durable step journal and lease/ownership checks; reject ordinary submit |
| Finalized history | Amendment/version workflow | Registry constraint and product approval; no in-place mutation or generic unlock |

All HTTP deadlines cover body consumption. Stream pings are transport health, not proof that an operation progresses. Disconnect must say the operation may continue; refresh must resolve the operation, not discard it.

Persist destination identity for an operation: provider/environment, project/facility, source identity, payload hash and credential/account identity reference. Do not store secrets in the operation journal. Decide whether credential rotation affects active attempts; never mix accounts silently across a single multi-stage operation.

## Operator recovery is a feature

For each error, the product must answer: what happened, what is saved/sent/deleted, whether retry is safe, who can resolve it, and the available route/button. [The finding ledger](findings.md) provides concrete copy per gap.

Return blocker codes/IDs from the guard so the UI can open the exact bin, order, Removal or document. An error pointing only to “support” is incomplete unless a maintainer has a reviewed procedure or tool that can resolve that state. The current stale-lock script is not a general dependency repair mechanism.

Prioritize these operator states:

- **Local validation/refusal:** unchanged; keep draft and show fields/blockers.
- **Known partial completion:** show saved record and incomplete attachments/children; retry only those steps.
- **Unknown completion:** show “could not confirm”; inspect/reconcile before another create.
- **Cleanup interrupted:** preserve the local record plus exact completed cleanup steps; offer Finish deletion using current Delete Removal semantics.
- **Registry review required:** name the specific mismatch and maintainer action. Do not offer an unsafe Retry that repeats the same dead end.
- **Archived history:** offer Restore where supported; do not instruct operators to delete history to regain a name or clear a reference.

## Ordered implementation slices

Each row is intended to be independently reviewable. Dependencies describe ordering, not a request to launch all work. Keep the existing tests and add only the crossing scenarios that failed this audit.

| Slice | Concrete change / result | Findings | Depends on | Acceptance evidence |
|---|---|---|---|---|
| 0. Invitation admission | Restore anonymous invitation landing admission with token/email/expiry guards retained | F28 | None | New invitee reaches bootstrap; existing user signs in; invalid token fails without creating account |
| 1. Canonical Feedstock Type creation | Quick-add delegates to Admin-gated canonical writer and retains selected registry ID | F14 | None | Member denied on both actions; Admin saves exact chosen ID; no unintended registry create |
| 2. Atomic supplier/customer aggregates | Supplier child/parent deletion in one transaction; complete FK blocker map; customer plus locations in one transaction | F08/F11 | None | Inject final delete and second child-create failure; all intended rows roll back; blocker remains actionable |
| 3. Bin and supply integrity | Serialize bin identity edits with stock mutations; reject unsafe stocked changes; validate resulting balances after supply reduction/move/delete | F01/F06 | None; agree historical-bin role policy | 25 kg role-change probe refused; reduction-after-loss probe refused; exact-zero succeeds; deterministic concurrent withdrawal/change test |
| 3b. Dependent operational invariants | Validate delivery status/date against existing Applications; guard shared-location derived transport changes against frozen lineage | F29/F30 | Existing lock/guard patterns | DB fixture refuses invalid status/date and frozen transport rewrite; unchanged and independent location edits remain valid |
| 4. Effective update validation | Preserve omission/null semantics, derive feedstock dry mass centrally, validate category/usage and route overrides against locked state | F02/F07/F10 | Coordinate with 3 | Populated→empty→null; omitted unchanged; zero retained; moisture-only correct dry mass; default-only location patch preserves city/state |
| 5. Application held evidence | Explicit held-file policy for existing Application edits; save once then flush against its ID | F09 | None | Rendered GIS upload/edit saves once and uploads once; injected failure retains ID/retryable file; cancel does not save |
| 6. Registry client and Source audit | Deadline/cancellation through response body; remove same-pool nested audit dependency | F05/F19 | None | 200/4xx/5xx body stalls time out; POST outcome stays possible; pool-size-one Source copy completes without losing audit |
| 7. Durable mutation outcomes | Separate known commit, enrichment failure and unknown acknowledgement; preserve ID; refresh context after actual org switch | F04/F25 | None; result vocabulary agreed | Failure after commit never says “not created”; unknown commit does not prompt blind create; organization UI reloads after completed switch |
| 8. Upload and loss idempotency | Retain upload attempt/document ID; idempotent confirm/reconcile; same loss command deduplicates; bounded reversal design | F12/F23 | 7; reversal policy decision | Response dropped after each upload/loss stage yields one logical result; changed replay conflicts; reversal cannot exceed original or cross org/bin |
| 9. Stale editor protection | Reuse production-run expected-version approach for other consequential full forms | F03 | 4/7 coordinate contracts | Two old snapshots cannot silently overwrite; unrelated metadata and mass edits tested; draft survives conflict |
| 10. Registry cleanup/repair | Durable cleanup-started/steps and submit gate; implement narrowly reviewed Biochar claim correction | F20/F21 | 6/7; provider-confirmed repair policy | Parent deleted/child failure/reload offers cleanup only; repeated cleanup converges; old claim history retained; finalized correction cannot delete history |
| 11. Child measurements and UX dead ends | Explicit timezone/quantity contracts; run-child delete blocker; searchable customers; accurate cancel/retire copy | F13/F15/F17/F24/F26 | None; child-retirement policy | UTC/Zurich/DST no-op round trips; malformed/negative rejected; parent rollback preserves all children; customer 101 selectable |
| 12. Telemetry hardening before exposure | Sensor identity lock and destination checks; step-3 unknown outcome policy | F16/F22 | Provider replay contract, 6/7 | Two misses one create; units/destination mismatch fails closed; lost ID cannot blind repost |
| 13. Provenance and master-data policy | Remaining-intake attribution and explicit correction/retirement for quick-add masters | F27 and policy gaps | Product decisions | Per-intake and per-bin conservation across intake/draw/intake/loss; correction keeps prior lineage explainable |

The action-file helper issue F18 is not a confirmed exposure in the audited build. Add a guard on the compiled manifest and split internal cores when changing these modules; do not divert the immediate defect queue into a claimed emergency security rewrite.

## Required product decisions, separate from proven bug fixes

1. May an empty bin with history change material role, or must it be archived and replaced? Current stock cannot be silently reclassified either way.
2. What correction is permitted for a mistaken loss, and who approves it? A named bounded reversal can preserve append-only audit without allowing arbitrary stock creation.
3. Which metadata may change on a used Feedstock Type, reactor, customer location or registry destination without reinterpreting history?
4. What is the supported amendment for finalized Biochar Application/site evidence? Provider constraints and product policy must be separated.
5. How does commingled feedstock allocate remaining provenance, and how is historical attribution repaired before certification?
6. Reconcile historical Method B timing/process epoch wording with the current creation-time eligibility check.
7. Should unused structured telemetry/import actions be retired or supported? Do not enable an unmounted flow merely because code exists.

These decisions do not block slices 1, 2, 4, 5, 6 or 7, and need no broad staging reset.

## Verification and rollout

Use isolated PostgreSQL fixtures and injected registry/storage adapters first. Browser verification should then exercise the changed flow through the repository's computer-use skill, including a second editor and interrupted upload where relevant. No shared staging mutation is needed to reproduce the confirmed defects.

Before each PR, run targeted tests, lint, typecheck and relevant scope/copy checks. For registry changes, review current primary contracts and current-head deletion/retry tests; preserve the successful staging records named in the handoff. Use an explicitly disposable registry fixture only if a remaining provider contract cannot be verified read-only, and make that exact proposal separately.

After fixes, convert the archived observation probes into regression expectations at the owning seams. A passing observation probe currently means the defect exists. Do not add those unchanged to normal CI.

There is no production database to backfill. Keep migrations valid for development/tests; avoid transitional production compatibility or destructive shared staging QA. No commit, PR or implementation was made as part of this audit.
