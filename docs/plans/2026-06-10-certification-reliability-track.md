# Certification reliability track

> **Status: all three phases implemented** (2026-06-10 — Phase 1 in PR
> #169, Phase 2 stacked on it, Phase 3 stacked on Phase 2; see
> `docs/isometric/changes.md`). Deepens three modules on the Isometric
> submission path: the submission-ledger claim choreography, the registry
> create-or-reconcile call, and a fake registry adapter for boundary tests.
> Line references in Phase 3 were re-anchored 2026-06-10 after the GHG
> entry API migration and Phase 1 landed — they will drift again; locate by
> symbol.
> Correctness work, not cleanup — motivated by real drift between the Removal
> and GHG Statement pipelines, reachable at today's scale. A future move to
> multiple users/operator groups (not yet committed — see
> `auth/facility-access-model` in `docs/open-questions.md`) would only raise
> the concurrency stakes on these same paths.
> **Phase 1 interface settled 2026-06-10** via a design-it-twice review
> (four independent designs — minimal / flexible / common-caller /
> ports-and-adapters — compared and hybridized; decisions recorded in
> Phase 1 below).

## Why now

The submission ledger (`certificationSubmissions`) and its claim policy
(`decideSubmissionClaim`, `src/lib/isometric/utils/submission-claim.ts`) are
deep, pure, and fully tested. But the **choreography around them is
copy-pasted with drift** across three pipelines, and the drift is a
correctness gap, not a style gap:

1. ~~**Removal re-decides the claim inside the mapping lock; GHG Statement
   does not.**~~ **Resolved by Phase 1.** The described drift — GHG
   inserting its draft from the unlocked tentative claim and a concurrent
   duplicate create dying on `SUBMISSION_ENTITY_VERSION_CONSTRAINT` with a
   raw DB error — no longer exists: both pipelines now claim through
   `claimSubmissionDraft` (`src/data-access/certification-submissions.ts`),
   which re-decides inside the mapping lock, and the
   `ExistingRemovalSubmission` throw/catch plumbing is deleted.
2. ~~**Removal's failure audit events lose the registry's response body; GHG's
   preserve it.**~~ **Resolved by Phase 2.** Every failed registry-create
   sync event now carries `{ mapping_revision, body? }` — the unified
   failure event recorded by `performRegistryCreate`
   (`src/fn/certification/registry-create.ts`).
3. **The supplier-reference orphan-claim behavior is untested as a boundary.**
   Existing tests mock individual functions
   (`tests/isometric-submit-removal.test.ts` mocks `createDatapoint`,
   `reconcileRemoval`, etc. separately), so the property that actually
   protects against double-submitting a Removal — *POST succeeds server-side,
   client sees a network error, the retry reconciles by supplier reference
   instead of POSTing again* — is asserted only against hand-wired mocks, never
   against a registry-shaped counterparty. → Phase 3.

All three are reachable at today's scale — two tabs, a double-click, or a
retry is enough. If multiple users/operator groups ever land (an open
product question, tracked as `auth/facility-access-model` in
`docs/open-questions.md`), the stakes only rise.

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

> **✅ Implemented** (2026-06-10, PR #169). The interface below landed as
> specified; the section is kept as the module's contract reference.
> Deltas from the sketch, for Phase 2/3 implementers:
>
> - `LOCK_TTL_MS` stayed in `src/lib/isometric/utils/lock.ts` (it also
>   feeds `isLockedInFlight`, and lib must not import from data-access);
>   the module imports it. The interface goal holds — callers never pass
>   `now`/`lockTtlMs`.
> - `getLatestSubmissionInTx` and the plain (guardless)
>   `insertDraftSubmission` / `resetSubmissionToDraft` variants had no
>   remaining callers and were **deleted**, not relocated.
> - `getLatestSubmission` moved to the new module as a **permanent public
>   read API** (status loaders, certify-context) — it is not under the
>   telemetry boundary.
> - Telemetry-boundary importers: `src/fn/certification/submit-telemetry.ts`
>   (the single permitted `src/` importer) plus
>   `tests/isometric-mapping-lock.test.ts` (the primitives' own unit test).
> - Pipeline tests stub the claim via shared
>   `tests/fixtures/fake-claim.ts` — the real pure core over an in-memory
>   store; the module-owned lock/CAS/`resolve` behavior is deliberately not
>   simulated there (DB-backed suite covers it).
> - DB-backed suite: `tests/certification-submissions.test.ts` (16 cases);
>   `tests/setup.ts` pins `DB_POOL_MAX=10` because the app default of one
>   connection starves the parked-claim concurrency orchestration.

**Goal:** one module owns the choreography *read latest → decide → lock →
re-resolve payload → re-decide → insert/reset draft*. The Removal path's
defensiveness becomes the only path; GHG Statements inherit it.

**New module:** `src/data-access/certification-submissions.ts` — a new file,
not a section of `certification.ts` (already ~940 lines, near the 1000-line
cap). The low-level ledger primitives move here; `decideSubmissionClaim`
stays in `lib/isometric/utils/` as the pure core.

**Interface (settled 2026-06-10 — single entry point):**

```ts
// src/data-access/certification-submissions.ts

type NewVersionReason =
  | "first" | "submitted-hash-changed" | "rejected-hash-changed" | "after-superseded";

type ClaimOutcome =
  | { kind: "claimed"; row: CertificationSubmissionRow;
      resumed: boolean;                       // true ⇒ reset prior draft; its STORED
                                              // payloadSnapshot is authoritative
      supersedePreviousId: string | null;     // forward to markSubmissionSubmitted
      reason: NewVersionReason | "resumed" }  // logging only (removal's warn case)
  | { kind: "existing"; externalId: string; version: number }
  | { kind: "blocked";
      reason: "in-flight" | "rejected-with-external"
            | "invalid-changed-hash" | "state-changed" };

claimSubmissionDraft<H>(userId: string, args: {
  key: SubmissionKey;                  // { provider, submissionType, localEntityType, localEntityId }
  guard: MappingClaimGuard;            // template arm by presence (GHG omits it)
  policy: SubmissionClaimPolicy;       // "supersede" | "invalid-changed-hash"
  tentativeInputs: H;                  // precomputed before any lock; drives the fast path
  hashOf: (inputs: H) => string;       // module computes tentative AND final hashes itself
  mirrorDocumentIds?: string[];        // v1's only extra locks: source mirror locks
                                       // (lib/isometric/utils/source-lock.ts); module
                                       // acquires them sorted, after the mapping lock
  resolve?: (tx: Tx, tentative: H) => Promise<H>;  // in-lock re-resolution; return
                                       // `tentative` unchanged when nothing shifted
  buildSnapshot: (args: {              // SYNCHRONOUS, receives no tx — structurally
    inputs: H;                         // no I/O between the decision and the insert
    nextVersion: number;               // exists ONLY here — version-embedded supplier
    supersedePreviousId: string | null;//   refs cannot be built pre-decision
    reason: NewVersionReason;
  }) => { payloadSnapshot: unknown; metadata?: Record<string, unknown> | null };
}): Promise<ClaimOutcome>
```

**Invariants** (part of the interface):

- Choreography, fixed internally: unlocked read → tentative decide
  (fast path for `blocked`/`existing`/resume) → tx → mapping lock `FOR
  UPDATE` + guard verify → mirror locks (sorted) → `resolve` → final hash via
  `hashOf` → in-lock re-read + authoritative re-decide → `buildSnapshot` →
  insert → commit. An insert is unreachable without the in-lock re-decision.
- Resume (`resumed: true`) goes through the CAS reset under the same mapping
  guard and **never** calls `resolve`/`buildSnapshot` — the stored
  `payloadSnapshot` is the truth.
- No network I/O anywhere inside; the module ends at a claimed draft row.
- Mapping-guard violations **throw `SafeError`** with module-owned wording
  (generic facility-config races, same prose for every pipeline). Everything
  that is a *claim decision* comes back as an outcome; callers translate
  `blocked.reason` to their own domain wording.
- In-lock divergence that can't be absorbed (re-decide says resume after we
  prepared a create) → `blocked: "state-changed"`; callers say
  "reload and retry". **No self-healing resume** — rejected in review: it
  makes resume semantics depend on payload-shape assumptions the module
  cannot verify.
- `LOCK_TTL_MS`, the version-race 23505 backstop (normalized to
  `blocked: "in-flight"`; any other constraint propagates raw), the resume
  CAS predicate, and the `ExistingRemovalSubmission` abort-tx trick all
  become module-internal. No `now`/`lockTtlMs` injection on the interface —
  TTL-boundary tests manipulate the seeded row's `lockedAt` directly.

**Decisions recorded** (2026-06-10 review):

- **Outcomes, not thrown domain states** for claim decisions — matches the
  pure core's contract; the throws-with-caller-supplied-messages alternative
  just passes the same translation table inward for no depth gain.
- **`hashOf` required** — the inserted hash is always `hashOf(final inputs)`
  computed by the module; a caller cannot smuggle a stale hash past the
  re-decision.
- **`mirrorDocumentIds`, not generic `lockKeys`** — the only extra locks
  today are source mirror locks; generalize only when a second lock consumer
  exists.
- **Rejected: ports & adapters** over the ledger. The load-bearing behavior
  is Postgres locking/visibility (`FOR UPDATE` queueing, READ COMMITTED
  visibility, advisory-lock semantics, cross-module interleaving with
  mirroring/owning-document-deletion/admin-repoint flows) — an in-memory adapter is more likely
  to lie than help. Internal seam; test against real Postgres. Recorded as
  [ADR 0008](../adr/0008-submission-ledger-internal-seam.md).
- **Deferred: telemetry.** The proven extension path (from the review's
  "flexible" design) is an opt-in `stepResume` config plus a return-type
  overload so only opted-in callers see `resume-poll-existing`/
  `resume-re-put`. Add it when telemetry migrates, not before. Until then
  `submit-telemetry.ts` keeps using the relocated primitives — with the
  boundary explicit in code, not convention: the primitives are **not
  re-exported from any barrel**, each carries a
  `// TODO(telemetry-migration): module-private once submit-telemetry adopts
  claimSubmissionDraft — do not add importers` comment, and
  `submit-telemetry.ts` stays their only importer (verify with a grep in the
  migration PRs).

**Implementation order:**

1. **Extract** the low-level ledger primitives from `certification.ts` into
   `certification-submissions.ts` (`getLatestSubmission[InTx]`,
   `insertDraftSubmission*`, `resetSubmissionToDraft*`,
   `lockAndVerifyMapping`, the unique-violation guard, `LOCK_TTL_MS`), then
   implement `claimSubmissionDraft` on top. Primitives become module-private;
   the ones telemetry still needs stay exported under the explicit boundary
   described in the telemetry-deferral decision above (no barrel re-export,
   `TODO(telemetry-migration)` comment, single permitted importer).
2. **DB-backed tests** for `claimSubmissionDraft` using the existing
   Postgres test harness (vitest + `.env.test` `DATABASE_URL` via
   `tests/setup.ts`; per-run fixture style of
   `tests/applications-mutations.test.ts` /
   `tests/isometric-mapping-lock.test.ts`) — **no new fake DB**. Cases:
   two concurrent claims on one key → exactly one `claimed`, one
   `blocked: "in-flight"`, one row (the GHG drift regression test);
   `resolve` returning shifted inputs → row carries the recomputed hash and
   the locked decision's version; latest flipped to submitted-with-same-hash
   while the claimant is parked on the mapping lock → `existing`, no orphan
   draft, tx rolled back; resume CAS won (TTL-stale `lockedAt`) and lost
   (fresh `lockedAt`); guard repoint mid-claim → thrown `SafeError`.
3. **Migrate GHG first** — replace the outside-lock decision path at
   `ghg-statements.ts:244–313`. Smallest consumer, and it lands the
   correctness fix exactly where the drift is.
4. **Migrate Removal second** — replace `submit-removal.ts:508–765`,
   deleting the custom in-lock re-decision block (`:627–668`) and the
   `ExistingRemovalSubmission` throw/catch plumbing.

**Explicit behavior change (the point of the phase):** a concurrent duplicate
GHG Statement create now resolves to `existing` / `blocked: "in-flight"`
instead of a unique-constraint error.

**Tests staying green:** `tests/isometric-submission-claim.test.ts` (pure
core) unchanged; `tests/isometric-submit-removal.test.ts` and
`tests/isometric-ghg-statement-submit.test.ts` keep their assertions on
versions, supersede links, and idempotent returns — their mock surface moved
from the primitives to `claimSubmissionDraft` (one function, via
`tests/fixtures/fake-claim.ts`), replacing the hand-rolled in-memory ledger
fakes (including the `undefined as never` tx handle).

## Phase 2 — Registry create-or-reconcile module

> **✅ Implemented** (2026-06-10, stacked on PR #169; see
> `docs/isometric/changes.md`). The interface below landed as specified;
> deltas for the Phase 3 implementer:
>
> - The module is entered as `performRegistryCreate` with two small
>   additions over the sketch: `supplierRefId?` (echoed into the success
>   event for audit parity with the old removal path) and `log?` (an
>   attempt-scoped logger; the module logs the
>   "create failed; attempting reconciliation" warn itself).
> - `ReconcileLookup`'s `"single"` arm carries `externalId`; the exported
>   `supplierRefLookup` helper adapts the two-way supplier-ref
>   reconciliation shape. The GHG three-way adapter is inlined at its one
>   call site in `createGhgStatementRemote`.
> - An ambiguous (`"multiple"`) lookup rejects the row + throws WITHOUT a
>   failed sync event — parity with the pre-module GHG behavior.
> - All module events go through `appendSyncEventBestEffort`; GHG create
>   events moved from raw `appendSyncEvent` (which could unwind a
>   successful create) onto the best-effort path.
> - `finalizeGhgStatement` lost its `operation`/`source` params and its
>   success sync event (the module records it, before
>   `markSubmissionSubmitted`, not after).
> - `resolveTemplateInputs` extraction skipped — `submit-removal.ts` landed
>   at ~830 lines, comfortably under the cap.
> - Found during migration: the resume path now reads `fixed` bindings from
>   the stored snapshot (`readRemovalFixedInputs`) and the claim module's
>   `resumeDraft` re-decides under the mapping lock before the CAS reset.
> - Tests: `tests/registry-create.test.ts` (9 cases, mocked data-access +
>   spy thunks). The registry-shaped counterparty tests remain Phase 3.

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
(`submit-removal.ts:787`, post-Phase-1), extending its reconcile result to
cover GHG's three-way outcome. Wire vocabulary is post-GHG-entry-migration:
the create wrappers are `createDatapoint` / `createGhgEntry`
(`src/lib/isometric/submissions.ts`), the reconcile lookups are
`reconcileDatapoint` / `reconcileRemoval` / `reconcileGhgStatement`
(`src/lib/isometric/utils/reconciliation.ts`):

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
  `finalizeGhgStatement` continuations (`ghg-statements.ts:346` and `:375`)
  collapse into one call site.
- **Unify on the better failure event:** preserve `IsometricApiError.body` in
  the failed sync event's `responsePayload` for *all* callers (GHG behavior
  today, `createGhgStatementRemote`'s catch arm, `ghg-statements.ts:358–371`),
  keeping `mapping_revision` (removal behavior today, `createOrReconcile`'s
  failure event, `submit-removal.ts:845–861`). This is a deliberate audit
  improvement for the removal path, not an accident of unification.
- Keep the `:reconciled` sync-event convention from the removal path
  (`recordReconciled`, `submit-removal.ts:794–810`) for every reconciled
  claim, GHG included.

**Migrate:** the two `createOrReconcile` call sites in
`runRemovalSubmission` (`submit-removal.ts:695` and `:718`) and
`createGhgStatementRemote` (`ghg-statements.ts:301–383`). Delete the local
`createOrReconcile`. Phase 1 already brought `submit-removal.ts` to ~880
lines; this drops it further. If Phases 1+2 leave `resolveTemplateInputs` as
the file's main bulk, extract it to
`src/lib/isometric/transformers/template-inputs.ts` (it is already pure) —
optional, do only if the file is still unwieldy.

**Interaction with Phase 1 (landed):** `claimSubmissionDraft` returns
`resumed` and `supersedePreviousId` on a `claimed` outcome — `resumed` feeds
`performRegistryCreate`'s reconcile-first switch, and `supersedePreviousId`
still flows to `markSubmissionSubmitted` after the registry call succeeds.
Both pipelines already pass these through; Phase 2 only replaces the
POST-side plumbing between the claim and the mark-submitted transition.

**Tests:** new `tests/registry-create.test.ts` covering: fresh create
success; resumed → reconcile-first hit (no POST); POST fails + reconcile
finds orphan (claimed, `:reconciled` event); POST fails + reconcile misses
(failed event carries response body, row rejected, SafeError); ambiguous
(`multiple` → reject + message). Existing flow tests stay green.

## Phase 3 — Fake registry adapter

> **✅ Implemented** (2026-06-10, stacked on Phase 2; see
> `docs/isometric/changes.md`). Landed as specified; deltas from the sketch:
>
> - The fake's client-module replacement lives IN the fixture
>   (`createFakeClientModule(actual)`, called from each test file's
>   `vi.mock` factory) rather than a separate shared helper — the factory
>   passes the actual module through so `IsometricApiError` stays the real
>   class for `instanceof` checks. Per-test state via
>   `installFakeRegistry()` in `beforeEach`.
> - Tests split per pipeline: `tests/registry-boundary-removal.test.ts`
>   (boundary tests 1, 2, 4, 5 + a same-attempt recovery case where the
>   post-failure lookup works immediately) and
>   `tests/registry-boundary-ghg-statement.test.ts` (test 3, both arms).
> - "Submit fails" in tests 1/2/3 is produced by pairing the POST's
>   `drop-after-commit` with a `reject-before-commit` 503 on the lookup
>   route — otherwise `performRegistryCreate` reconciles the orphan within
>   the same attempt and nothing is left to resume. The resume is then
>   reached by back-dating `lockedAt` past the TTL, like the claim module's
>   own DB suite.
> - Besides the client: the removal tests mock the context loader and
>   sources resolver (per the out-of-scope decisions); the GHG tests mock
>   only the auth session (`withAction`). Everything else — claim module,
>   ledger + sync-event writes, statement get-or-create, finalize
>   reconciliation — runs real against Postgres.
> - The fake enforces unique `supplier_reference_id` on POST (422 + body)
>   and additionally exposes a request log, so "never re-POSTed" is
>   asserted both ways (registry state + POST counts).

**Goal:** make the registry seam real (two adapters) so the recovery paths
Phases 1–2 concentrated can be tested as a boundary — the registry as a
stateful counterparty, not a pile of per-function mocks.

**Placement:** fake the client, not the wrappers. The seam is the `isometric`
client object (`src/lib/isometric/client.ts:308` — `get/post/patch/delete/
paginate`). The function-level wrappers — post-GHG-entry-migration names:
`createDatapoint` / `createGhgEntry` (`submissions.ts`),
`createGhgStatement` (`ghg-statements.ts`), `findGhgEntryBySupplierRef` /
`findDatapointBySupplierRef` (`submissions.ts`) — are thin and stay real in
tests, so supplier-reference query semantics and pagination are exercised,
not simulated.

**New module:** `tests/fixtures/fake-registry.ts` — an in-memory registry
that:

- stores ghg entries (removals), datapoints, and GHG statements with
  server-assigned IDs;
- honors `?supplier_reference_id=` filtering on `/ghg_entries` and
  `/datapoints` (the post-rename route family — the deprecated
  removal-named routes need no fake), and draft-statement lookup by
  `(project_id, end_on)`;
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

**Interaction with Phase 1 (landed):** the boundary tests should run the
REAL `claimSubmissionDraft` against the DB-backed test harness
(`tests/setup.ts` + `.env.test`, fixture style of
`tests/certification-submissions.test.ts`) with only the client faked — that
is what makes them end-to-end. The value-shaped
`tests/fixtures/fake-claim.ts` is for pure-mock pipeline tests only; do not
stack it under the fake registry.

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

| Phase | Depends on | Size | Status |
|---|---|---|---|
| 1 — ledger claim module | — | ~2–3 days incl. tests | ✅ Done (PR #169) |
| 2 — registry create module | 1 merged (same files) | ~1–2 days | ✅ Done (stacked on #169) |
| 3 — fake registry + boundary tests | 1+2 landed | ~2 days | ✅ Done (stacked on Phase 2) |

One PR per phase, each leaving every existing test green. Behavior changes
are limited to the two named improvements (GHG race resolution — **shipped
in Phase 1**; removal failure-event body — **shipped in Phase 2**) — call
each out in its PR description.

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
