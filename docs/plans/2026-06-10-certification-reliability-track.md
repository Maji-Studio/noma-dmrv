# Certification reliability track

> **Status: Planned** (2026-06-10). Deepens three modules on the Isometric
> submission path: the submission-ledger claim choreography, the registry
> create-or-reconcile call, and a fake registry adapter for boundary tests.
> Correctness work, not cleanup — motivated by real drift between the Removal
> and GHG Statement pipelines, and by the planned move to multiple
> users/operator groups (more concurrency on exactly these paths).

## Why now

The submission ledger (`certificationSubmissions`) and its claim policy
(`decideSubmissionClaim`, `src/lib/isometric/utils/submission-claim.ts`) are
deep, pure, and fully tested. But the **choreography around them is
copy-pasted with drift** across three pipelines, and the drift is a
correctness gap, not a style gap:

1. **Removal re-decides the claim inside the mapping lock; GHG Statement does
   not.** `submitRemoval` re-reads the latest ledger row and re-runs
   `decideSubmissionClaim` inside the locked transaction
   (`src/fn/certification/submit-removal.ts:627–668`), so a concurrent
   duplicate submit resolves gracefully (`return-existing` via
   `ExistingRemovalSubmission`). `createGhgStatementDraft` inserts its draft
   using the **unlocked, tentative** claim
   (`src/fn/certification/ghg-statements.ts:290–303`) — a concurrent
   duplicate create races to the same `(entity, version)` and the loser dies
   on the unique constraint
   (`SUBMISSION_ENTITY_VERSION_CONSTRAINT`,
   `src/data-access/certification.ts:546`) with a raw DB error instead of an
   idempotent result.
2. **Removal's failure audit events lose the registry's response body; GHG's
   preserve it.** `createOrReconcile` records only `errorMessage` +
   `mapping_revision` on failure (`submit-removal.ts:962–973`);
   `createGhgStatementRemote` preserves `IsometricApiError.body`
   (`ghg-statements.ts:384–398`), which carries the actionable 4xx detail.
3. **The supplier-reference orphan-claim behavior is untested as a boundary.**
   Existing tests mock individual functions
   (`tests/isometric-submit-removal.test.ts:42–62` mocks `createDatapoint`,
   `reconcileRemoval`, etc. separately), so the property that actually
   protects against double-submitting a Removal — *POST succeeds server-side,
   client sees a network error, the retry reconciles by supplier reference
   instead of POSTing again* — is asserted only against hand-wired mocks, never
   against a registry-shaped counterparty.

Multi-tenancy raises the stakes on all three: more users means concurrent
submits stop being a two-tabs edge case.

## Vocabulary

Terms per `CONTEXT.md` (domain) and the architecture glossary:

- **Submission ledger** — the local `certificationSubmissions` journal; one
  row per (entity, version), status `draft → submitted → accepted / rejected
  / superseded`.
- **Claim** — the decision of what a submission attempt may do against the
  ledger: create a new version, resume a stale draft, return the existing
  result, or block.
- The **registry seam** is the interface to Isometric (`src/lib/isometric/`).
  Today it has one adapter (live HTTP). Phase 3 adds a second (the fake),
  which is what makes it a real seam.

---

## Phase 1 — Submission-ledger claim module

**Goal:** one module owns the choreography *read latest → decide → lock →
re-resolve payload → re-decide → insert/reset draft*. The Removal path's
defensiveness becomes the only path; GHG Statements inherit it.

**New module:** `src/data-access/submission-ledger.ts` (data-access layer —
it owns the transaction; `decideSubmissionClaim` stays in
`lib/isometric/utils/` as its pure core). Keeps `certification.ts` under the
1000-line cap rather than growing it.

**Interface (sketch — refine during implementation):**

```ts
type ClaimOutcome =
  | { kind: "claimed-new"; row: CertificationSubmissionRow; supersedePreviousId: string | null }
  | { kind: "claimed-resume"; row: CertificationSubmissionRow }
  | { kind: "existing"; externalId: string; version: number }
  | { kind: "blocked-in-flight" }
  | { kind: "blocked-rejected-with-external" }
  | { kind: "invalid-changed-hash" };

claimSubmissionDraft(userId, {
  key: { provider, submissionType, localEntityType, localEntityId },
  policy: SubmissionClaimPolicy,
  mappingGuard: MappingGuard,
  lockTtlMs: number,
  // Runs INSIDE the lock. May acquire extra locks (mirror locks) and
  // re-resolve inputs; returns the authoritative snapshot + hash the
  // in-lock re-decision uses. Trivial (return precomputed) for GHG.
  resolvePayload: (tx: Tx) => Promise<{ payloadSnapshot: unknown; payloadHash: string }>,
}): Promise<ClaimOutcome>
```

Design points:

- **Outcomes, not throws.** `decideSubmissionClaim`'s contract says callers
  translate decisions into domain messages — keep that. The module returns
  typed outcomes; each pipeline maps `blocked-in-flight` etc. onto its own
  `SafeError` copy. (The removal-specific `ExistingRemovalSubmission`
  throw-to-escape-transaction trick becomes internal to the module.)
- **The double-decide is implementation.** Callers can no longer skip it.
  The in-lock re-decision uses the hash returned by `resolvePayload`, which
  is how the Removal's sources-changed → recompute-hash path
  (`submit-removal.ts:593–625`) fits: its `resolvePayload` acquires mirror
  locks, re-resolves source IDs, and rebuilds template inputs when they
  shifted. GHG's `resolvePayload` just returns the precomputed payload.
- **Resume goes through the same interface.** `claimed-resume` wraps
  `resetSubmissionToDraftWithMappingLock`; callers stop calling the
  data-access primitives directly. The primitives
  (`insertDraftSubmissionWithMappingLock*`, `resetSubmissionToDraft*`) become
  internal to the ledger module — exported only for the telemetry path until
  it migrates (see below).

**Migrate:** `submitRemoval` (`submit-removal.ts:508–765`) and
`createGhgStatementDraft` (`ghg-statements.ts:237–313`).

**Explicit behavior change (the point of the phase):** a concurrent duplicate
GHG Statement create now resolves to `existing`/`blocked-in-flight` instead
of a unique-constraint error.

**Deferred consumer:** `submitTelemetry` (`submit-telemetry.ts:234–356`) uses
the same primitives but its claim outcomes (`resume-poll-existing`,
`resume-re-put`) drive step-journaled recovery per ADR 0006, not a simple
draft claim. Migrate it only if the interface absorbs those kinds without
contortion; otherwise leave it on the exported primitives and record the
follow-up in `docs/open-questions.md`. Do **not** force it into the first
abstraction.

**Tests:**
- Existing `tests/isometric-submission-claim.test.ts` (pure core) unchanged.
- New `tests/submission-ledger.test.ts`: choreography against an in-memory
  tx fake in the style of `tests/isometric-mapping-lock.test.ts` — including
  the race case: latest changes between the unlocked read and the in-lock
  re-read → outcome flips to `existing` / `blocked-in-flight`; and the
  sources-changed case: `resolvePayload` returns a different hash → insert
  uses the recomputed hash and re-decided version.
- `tests/isometric-submit-removal.test.ts` and
  `tests/isometric-ghg-statement-flow.test.ts` stay green (mock surface moves
  from the primitives to `claimSubmissionDraft` — keep assertions on
  versions, supersede links, and idempotent returns identical).

## Phase 2 — Registry create-or-reconcile module

**Goal:** one implementation of *POST → on failure, reconcile by lookup →
record sync event → mark rejected or claim the orphan*, shared by removal
creates, datapoint creates, and GHG Statement creates. **Narrow scope by
decision:** Sources mirroring (`src/fn/certification/sources.ts`) stays out —
its reconcile path refreshes signed upload URLs, a different shape. Telemetry
stays out — ADR 0006 deliberately uses journaled-step recovery, not
supplier-reference reconciliation.

**New module:** `src/fn/certification/registry-create.ts` (fn layer — it
composes the isometric client with data-access sync-event/ledger writes,
which data-access must not import).

**Interface (sketch):** generalize the existing `createOrReconcile`
(`submit-removal.ts:884–979`), extending its reconcile result to cover GHG's
three-way outcome:

```ts
type ReconcileLookup =
  | { found: "single"; externalId: string }
  | { found: "none" }
  | { found: "multiple" };   // GHG: ambiguous drafts for (project, end_on)

performRegistryCreate({
  userId,
  entityType, entityId, submissionRowId,
  operation,                  // sync-event operation key
  requestPayload,
  resumed: boolean,           // reconcile-first before POSTing
  create: () => Promise<string>,
  reconcile: () => Promise<ReconcileLookup>,
  ambiguousMessage?: string,  // "multiple" → reject + SafeError(this)
  failureMessagePrefix: string,
}): Promise<{ externalId: string; source: "create" | "reconciliation" }>
```

Design points:

- **Returns `source`** so `createGhgStatementRemote`'s two
  `finalizeGhgStatement` continuations (`ghg-statements.ts:373–410`) collapse
  into one call site.
- **Unify on the better failure event:** preserve `IsometricApiError.body` in
  the failed sync event's `responsePayload` for *all* callers (GHG behavior
  today, `ghg-statements.ts:387–397`), keeping `mapping_revision` (removal
  behavior today, `submit-removal.ts:958–969`). This is a deliberate audit
  improvement for the removal path, not an accident of unification.
- Keep the `:reconciled` sync-event convention from the removal path
  (`submit-removal.ts:906–922`) for every reconciled claim, GHG included.

**Migrate:** the two `createOrReconcile` call sites in
`runRemovalSubmission` (`submit-removal.ts:805–842`) and
`createGhgStatementRemote` (`ghg-statements.ts:329–411`). Delete the local
`createOrReconcile`. `submit-removal.ts` drops well below 900 lines as a side
effect; if Phases 1+2 leave `resolveTemplateInputs` as the file's main bulk,
extract it to `src/lib/isometric/transformers/template-inputs.ts` (it is
already pure) — optional, do only if the file is still unwieldy.

**Tests:** new `tests/registry-create.test.ts` covering: fresh create
success; resumed → reconcile-first hit (no POST); POST fails + reconcile
finds orphan (claimed, `:reconciled` event); POST fails + reconcile misses
(failed event carries response body, row rejected, SafeError); ambiguous
(`multiple` → reject + message). Existing flow tests stay green.

## Phase 3 — Fake registry adapter

**Goal:** make the registry seam real (two adapters) so the recovery paths
Phases 1–2 concentrated can be tested as a boundary — the registry as a
stateful counterparty, not a pile of per-function mocks.

**Placement:** fake the client, not the wrappers. The seam is the `isometric`
client object (`src/lib/isometric/client.ts:308` — `get/post/patch/delete/
paginate`). The function-level wrappers (`createDatapoint`,
`createRemoval`, `createGhgStatement`, `findRemovalBySupplierRef`, …) are
thin and stay real in tests, so supplier-reference query semantics and
pagination are exercised, not simulated.

**New module:** `tests/fixtures/fake-registry.ts` — an in-memory registry
that:

- stores removals, datapoints, and GHG statements with server-assigned IDs;
- honors `?supplier_reference_id=` filtering on `/removals` and
  `/datapoints`, and draft-statement lookup by `(project_id, end_on)`;
- enforces the registry-shaped invariants the recovery code depends on:
  duplicate `supplier_reference_id` POSTs, multiple draft statements for one
  period;
- supports **failure injection per request**: `failNext(route, mode)` where
  `mode` is `"reject-before-commit"` (server never created it) or
  `"drop-after-commit"` (created server-side, client sees a network error) —
  the second mode is the one no current test can express;
- returns `IsometricApiError` with a body for 4xx injections, so the Phase 2
  audit-event behavior is assertable.

Wire it via `vi.mock("@/lib/isometric/client")` in a shared helper. Keep it
deliberately small — only the routes the certification pipelines touch; grow
it per-test, never speculatively.

**New boundary tests** (the payoff):

1. Datapoint POST `drop-after-commit` → submit fails → resubmit (resume path)
   reconciles the orphan by supplier ref, POSTs only the remaining
   datapoints, and the registry holds **exactly one** of each — the
   double-submit guard asserted end-to-end.
2. Removal POST `drop-after-commit` → same property at the removal level.
3. GHG create `drop-after-commit` → reconcile by `(project, end_on)` finds
   the single draft → finalize proceeds; with a second injected draft →
   rejected with the ambiguity message.
4. `reject-before-commit` with a 4xx body → row rejected, failed sync event
   carries the response body.
5. Hash-supersede across versions: v1 submitted, payload changes, v2
   supersedes — registry holds two removals with distinct versioned supplier
   refs (the supplier-ref-carries-version property,
   `src/lib/isometric/utils/supplier-ref.ts`).

The sandbox integration test (`tests/isometric-sandbox.integration.test.ts`)
remains the live-adapter check; the fake does not replace it.

---

## Sequencing & estimates

| Phase | Depends on | Size |
|---|---|---|
| 1 — ledger claim module | — | ~2–3 days incl. tests |
| 2 — registry create module | independent of 1 (touches different lines); land after 1 to avoid rebasing the same files | ~1–2 days |
| 3 — fake registry + boundary tests | smaller surface once 1+2 land | ~2 days |

One PR per phase, each leaving every existing test green. Behavior changes
are limited to the two named improvements (GHG race resolution; removal
failure-event body) — call both out in the PR descriptions.

## Risks

- **The ledger module's interface fights the telemetry path.** Mitigated by
  explicitly deferring telemetry (see Phase 1); the module must not grow
  speculative branches for it.
- **Mock-surface churn breaks existing tests misleadingly.** Migrate test
  mocks file-by-file in the same PR as the code they cover; assertions
  (versions, supersede links, sync-event operations) must not weaken.
- **Fake-registry drift from the real API.** Contained by keeping the fake
  minimal and keeping the daily sandbox health check
  (`isometric-health.yml`) + sandbox integration test as the live-truth
  anchor.

## Out of scope (decided 2026-06-10)

- **Sources mirroring** stays on its own create/reconcile shape; revisit only
  after Phase 2 settles, if a second look shows it genuinely fits.
- **Auth scoping (`requireAccess` seam).** Deferred: a no-op seam over
  today's documented shared-data model (`docs/auth.md`, `docs/security.md`)
  would be churn and false confidence. Becomes P0 as a **real
  facility-access model** when multi-tenancy work starts — tracked in
  `docs/open-questions.md` (`auth/facility-access-model`).
- The `fn/` CRUD `defineAction` factory and lineage-walk consolidation
  (candidates 3 and 5 from the 2026-06-10 architecture review) — separate
  tracks if picked up.
