# Supplemental independent investigation

This secondary Astra low report is evidence, not the final finding severity or proof grade. Read [the parent ledger](findings.md), which verifies, qualifies and deduplicates its claims. No new production behavior was implemented.

# Certification audit

Baseline: `ef857545b11fa298f0f08e128868ed14e37fbf5f`. Checkout clean. No files, databases, registry records, or external records modified. No tests or simulations executed.

Isometric MCP `how_to` was unavailable. Registry conclusions below concern local implementation only. Current upstream guarantees remain for the parent to verify.

**Three code findings:** one authorization boundary defect requiring a compiled-action reachability check, one HTTP timeout defect, and one reproducible pool-starvation path. No claim of observed staging failure.

## Coverage and state exceptions

Paths below are repository-relative. C/U/D means create/update/delete; “internal” means orchestrated rather than an operator CRUD form.

| Assigned route/entity | C/U/D coverage and traced path | State exceptions and limits |
|---|---|---|
| `/certification` | Redirect through `certificationRemovalsHref` | Preserves facility scope; no independent mutations. |
| `/certification/removals` | `NewRemovalDialog` → `useCreateRemovalWithBatches` → `createRemovalWithBatchesAction` → `createRemovalWithCreditBatches` → `certifier_removals`, application slices | No empty draft before **Continue**. Requires selected batches; server recalculates health. Atomic membership assignment. Closing after creation preserves a draft. |
| Removal submission/update | Wizard `SubmitStep` → `useSubmitRemoval` → `/api/certification/submissions` → `submitRemoval` → submission ledger, claims, nested registry artifacts | Required compilation hash on HTTP entry; stored snapshots on resume; superseding versions rather than ordinary editing. |
| Removal deletion | Detail sheet/wizard → `useDeleteRemoval` → `deleteRemovalAction` → `deleteRemoval` → deletion claim, remote cleanup, transactional finalization | Submitted/statement-linked Removals refused. Partial cleanup preserves local state for another **Delete Removal** attempt. Any-member deletion is explicitly documented policy, not flagged. |
| `/removals/[removalId]` and `/review` | Both redirect to `/certification/removals?resume=<id>` | Preserve `facility`; neither is an independent detail/review implementation. |
| `/certification/ghg-statements` | Create dialog → hook → `createGhgStatementDraft` → local draft/ledger → remote create/reconcile → membership reconciliation | Period-based identity, empty-period guard, overlap guard, dedicated-project check. No ordinary delete/edit form found. |
| GHG Statement submission/update | Submit dialog → streaming hook/API → `submitGhgStatementToVerifierCore` → report token staging, remote submit/resubmit, local status | Admin floor; report required; resubmission summary required; awaiting/verified gates; generated and external reports mutually exclusive. |
| GHG Statement refresh/discovery | List/detail hooks → `ghg-statement-sync.ts`, `ghg-statements.ts` → reconciliation → local periods/membership/status | Registry-only statements can be discovered. Missing periods represented explicitly. Multi-facility ambiguity blocks adoption. |
| Nested generated reports | Submit dialog → prepare/approve hooks → `ghg-statement-reports.ts` → report/document rows and storage | Preparation-key deduplication; versions retained; approval/freshness checks. Token helper exposure is finding 1. |
| `/certification/settings`: credentials | Credential form/hooks → `setOrgCertifierCredentialsFn` → `upsertCertifierCredentials` | Omitted secret retains existing value; first save requires both. Saves precede connection verification intentionally. No current credential-delete action/button. |
| Settings: project/facility/template | Mapping form/hooks → `facility-mapping.ts` → `certification.ts` and mapping locks → `certifier_projects` | Project/template readback validation; facility-ID shape check; blocking submissions and registered storage sites constrain remapping/unlinking. |
| Settings: emissions and Source visibility | Forms/hooks → schema-validated actions → project/settings rows | Empty optional emissions values normalize to null. Source visibility affects new Sources; existing remote visibility is retained. |
| Production Batch | Internal Removal orchestration → `production-batches.ts` → registry inputs/journal → HTTP client | Always reference-reconciles before create; live identity/mapping checked; confirmed absence permits replacement. Ordinary drift is logged and reused by explicit policy. Delete retains shared batches. |
| Storage Location | Removal orchestration and application sync action → `storage-locations.ts` → registration locks/journal → HTTP | Project-scoped site identity; null coordinates block fresh registration; drift blocks dependent submission. Confirmed-missing recovery preserves dependency history. |
| Biochar Application | Frozen intent → `biochar-applications.ts` → registration/dependency locks → journal and HTTP | Per application/batch/submission identity; missing confirmed remote record blocks rather than silently recreates. Changed Storage Location marks review required. Nullable registry association is deliberately accepted. |
| Measurements/datapoints/GHG Entry | Submission snapshot → create/reconcile → measurement journal/source binding → GHG Entry identity/finalization | Journal identity checks, missing/mismatching measurements refused; partial external success retained for reconciliation. |
| Evidence copies | Candidate loader → `sources.ts` → document checks, mirror transaction, storage transfer, registry Source, upload mapping | Upload completion/size/type/storage checks; stable reference recovery. Pool contention is finding 3; caller-supplied internal seam is finding 1. |
| Quick-add | Searched certification components and quick-add schema | No certification-specific `EntitySelect` quick-add entry found. Operational storage-bin quick-add is a different entity from registry Storage Location. |
| Legacy telemetry | `submitTelemetryAction` → exported `submitTelemetry` → journaled upload pipeline | Inspected the action boundary; did not fully audit all telemetry transformation/recovery branches. Its context-taking export repeats finding 1’s pattern. |

This is static coverage, not a claim that every UI interaction, downstream operational mutation, or concurrency interleaving was exercised.

## Findings

### 1. P1: context-taking helpers are exported as Server Actions

**Classification:** CONFIRMED CODE DEFECT. High confidence in the missing authentication boundary; deployed HTTP reachability remains untested.

**References**

- `src/fn/certification/ghg-statement-reports.ts:1`, `304–347`, particularly `330–337`.
- `src/data-access/ghg-statement-reports.ts:356–382`.
- `src/data-access/utils.ts:21–25`.
- `src/lib/auth/server.ts:205–224`.
- `src/app/api/ghg-statement-reports/[reportId]/route.ts:25–51`.
- Additional affected seam: `src/fn/certification/sources.ts:1`, `184–224`, `281–316`.
- Similar export: `src/fn/certification/submit-telemetry.ts:1`, `104–128`.

`ghg-statement-reports.ts` has file-level `"use server"`, but exports `issueVerifierReportUrl(orgCtx, reportId)` without resolving the authenticated session. It passes the supplied context directly into `stageVerifierReportToken`.

The data-access guard checks only that context IDs are nonempty. It does not verify that those IDs belong to the session. The report update uses the supplied organization and report ID, stages a pending capability, and returns its plaintext URL. The public report route accepts that pending capability.

The same boundary mistake exposes Source helpers. `mirrorDocumentToSourceForUser` checks an admin role from the supplied object, and a supplied `submissionCandidate` skips the normal live candidate lookup. The comment saying this candidate is “never accepted from an action” contradicts the file-level directive and exported signature.

**Minimal isolated reproduction**

1. Provision two isolated organizations and an approved report with no pending token.
2. Authenticate as an ordinary member of organization A.
3. Inspect the isolated build’s Server Action manifest for `issueVerifierReportUrl`.
4. Invoke that action with a context naming organization B and B’s known report ID.
5. Verify whether a pending digest is saved and the returned URL serves B’s report.

First test the same-org member case if cross-org fixture identifiers are unavailable. Neither legitimate session membership nor an admin role is resolved by this function.

**Saved/external state**

- Pending report token digest can change.
- Returned capability can authorize report access.
- No Isometric request is needed for this report-token path.
- Source helper misuse can additionally invoke registry/storage work using the supplied organization’s credentials.

**Counterevidence considered**

Normal prepare/approve actions use `withAction` and admin checks. Middleware verifies a session on protected routes. Neither protection authenticates arguments to the separate exported helper. Report lifecycle and organization predicates restrict which row is targeted, but trust the caller’s organization value.

No `.next` directory existed, so I could not establish which helpers survive the actual deployment’s action registration/tree shaking. Do not describe this as a demonstrated staging exploit.

**Minimal correction**

Move context-taking internal helpers into a module without `"use server"`. Keep only session-resolving action wrappers exported from action modules. Apply the same separation to Source and telemetry helpers.

**Operator handling**

- Current response: potentially a successful capability URL, with no permission failure.
- Proposed failure: “You do not have permission to prepare this report for submission.”
- Actor: engineering must fix the boundary; legitimate Owners/Admins continue through `/certification/ghg-statements` and **Approve and submit**.
- Retry safety: retries do not correct an authorization defect.

### 2. P2: HTTP timeout stops at headers, leaving response bodies unbounded

**Classification:** CONFIRMED CODE DEFECT. High confidence. Failure injection proposed, not executed.

**References**

- `src/lib/isometric/client.ts:153–164`, `168–205`, `219–234`.
- `src/app/api/certification/submissions/route.ts:117–119`.
- `src/lib/certification/submission-progress-client.ts:readWithTimeout`, `streamCertificationSubmission`.
- `src/components/certification/new-removal-dialog/index.tsx: submissionPending/closeIfIdle`.

The client clears its 30-second timer and removes the external abort listener immediately after `fetch` returns headers. It then awaits `response.text()` without a deadline. This affects both successful and error responses.

A provider or intermediary can return headers and leave the body incomplete. The request then never reaches retry, reconciliation, or failure recording. Meanwhile, submission-route pings continue, so the browser’s inactivity timeout does not detect the stalled orchestration. The wizard remains pending and disallows dismissal.

**Minimal reproduction**

Stub `fetch` to return a response immediately whose body never completes. Advance fake timers beyond 30 seconds. The request remains pending and the request signal remains unaborted.

Repeat with a 503 response: the retryable status is known, but retries never begin because body consumption precedes the retry decision.

**Saved/external state**

Depends on the checkpoint:

- During a create, the registry mutation may already have happened.
- Local submission may remain a locked draft without the returned identity.
- During a protected deletion, dedicated database locks can remain held until runtime termination or another lower-level timeout.

**Counterevidence considered**

The fetch/header phase is bounded. POST/PATCH retries are disabled by default. Browser stream reads are bounded. These protections do not bound response-body consumption, and pings defeat inactivity detection for this case.

**Minimal correction**

Keep timeout and external-abort wiring active through body consumption, with cleanup in `finally`. Classify body-read failures consistently with ambiguous network failures.

**Operator handling**

- Current display: a pending progress step; potentially no error at all.
- Proposed message: “Isometric stopped responding. This submission may have reached the registry. Reload the page to check its status before retrying.”
- Actor: Owner/Admin.
- Available recovery: reload `/certification/removals`, open the existing Removal, use **Retry** when available; GHG Statement detail has **Refresh**.
- Do not create a replacement Removal merely because the response stalled. Retry is conditional on reconciled state.

### 3. P2: Source copying consumes the only pool connection while awaiting another

**Classification:** CONFIRMED CODE DEFECT. High confidence for the default pool configuration; runtime reproduction not executed.

**References**

- `src/db/index.ts:13–20`: default pool maximum 1, acquisition timeout 10 seconds.
- `src/fn/certification/sources.ts:402–403`, `563–586`.
- `src/fn/certification/shared.ts:74–94`.
- `src/data-access/certifier-sync-events.ts:29–46`.
- `src/fn/certification/source-sync-events.ts:20–54`.
- `tests/isometric-sources-mirror-flow.test.ts:49–65`.
- `tests/setup.ts:14–19`.

The mirror transaction holds a main-pool connection across registry copying and local upload-mapping insertion. Before returning and releasing that connection, it awaits `appendSyncEventBestEffort`, whose implementation inserts through the global `db`, not `tx`.

With `DB_POOL_MAX=1`, the audit insert cannot acquire a connection until the transaction ends, while the transaction waits for that insert. The configured acquisition timeout eventually breaks the wait; the best-effort helper swallows the failure.

**Minimal reproduction**

In parent-provisioned isolated Postgres:

1. Set `DB_POOL_MAX=1`.
2. Stub all registry/storage calls with immediate successful responses.
3. Mirror one valid, previously unmirrored document.
4. Observe an acquisition-timeout delay before completion and no corresponding Source success event.
5. Inject a Source lookup/upload failure to exercise the two failure-audit writes inside the same transaction.

**Saved/external state**

On the success path, the remote Source and local mapping can ultimately persist, but the Source audit event is lost. Each sequential new copy incurs approximately the configured acquisition timeout, excluding other work. Larger pools remain vulnerable under saturation.

**Counterevidence considered**

The timeout prevents a permanent deadlock under the default settings. Best-effort audit failure protects eventual submission success. Existing mirror-flow tests stub both the transaction and data access, so they do not model pool acquisition. Global test setup defaults to a pool of 10.

The recent deletion fix moves deletion auditing outside dedicated locks. This finding concerns the separate Source-copy implementation and does not re-report that fixed deletion defect.

**Minimal correction**

Return captured audit information from the mirror transaction and append it after the connection is released. Preserve failure auditing outside rollback, rather than making diagnostics disappear with the failed transaction.

**Operator handling**

- Current behavior: prolonged evidence preparation, then success; audit loss is logged server-side.
- Proposed degraded-success message, only if surfaced deliberately: “Evidence was copied to Isometric, but its history entry could not be saved. Contact support with the Removal ID.”
- Actor: engineering/support; no operator configuration change resolves pool contention.
- Retry safety: do not recopy solely to repair missing history. An existing local mapping short-circuits copying and will not reconstruct the missed event.

## Protections and policy choices retained

- Normal streaming admission authenticates, enforces Admin, validates the complete body, and rate-limits before starting.
- Removal creation rejects empty selection, checks facility ownership, locks selected batches/slices, and verifies assignment counts transactionally.
- Submission claims re-decide under locks; exact lock timestamps protect several failure/identity transitions.
- Stable supplier references reconcile ambiguous creates before retrying.
- Production Batch missing-resource classification distinguishes recognized absence from network/authorization failures.
- Storage Location recovery compares the saved identity and marks dependent Biochar Applications for review.
- Deletion checks ownership and eligibility, deletes registry dependencies before local finalization, retains shared batches, and fences destructive requests.
- GHG Statement reconciliation uses live membership and handles moves between statements.
- Generated reports retain versions, preparation keys, approval fingerprints, and staged/active token hashes.
- Credential rotation updates only supplied secret columns. Failed connection verification after saving is explicitly reported as “Keys saved”.
- Accepting nullable Biochar Application associations, logging Production Batch drift without overwriting it, and allowing member deletion are explicit local policies. Their external suitability is not established here.
- No broad rewrite is recommended.

## Remaining hypotheses requiring isolated tests

1. **Submission lease expiry versus ongoing external writes.** The ten-minute ledger TTL is not visibly renewed throughout Removal orchestration. Production Batch creation does not itself hold a per-batch lock across lookup and POST. Test an old worker continuing after takeover, including a remotely deleted shared batch. Existing claim reservations and supplier-reference reconciliation are substantial counterevidence; duplicate remote creation is not confirmed.
2. **Credential/destination changes mid-attempt.** Nested helpers obtain fresh clients independently, while credentials can be rotated independently of submission locks. Test credential rotation between checkpoints. Cross-account visibility and absence semantics require parent contract verification.
3. **Failed-delete UI refresh.** `useDeleteRemoval` invalidates on success only. Test whether partial cleanup is discoverable immediately and whether the same dialog can safely retry. The backend retains recovery state, so stale UI alone does not establish lost data.
4. **Remote Source disappearance.** Existing local Source mappings short-circuit copying. Test subsequent binding verification and the available evidence-refresh path before claiming that remote deletion creates an unrecoverable state.

## Relevant tests for the parent

These files were inspected or located; **none were run**.

Hermetic orchestration/HTTP/UI tests, with parent-controlled environment:

```bash
pnpm exec vitest run \
  tests/registry-create.test.ts \
  tests/isometric-sources-mirror-flow.test.ts \
  src/fn/certification/source-sync-events.test.ts \
  src/fn/certification/production-batches.test.ts \
  src/fn/certification/storage-locations.test.ts \
  src/fn/certification/biochar-applications.test.ts \
  src/fn/certification/durability-measurement-recovery.test.ts \
  src/fn/certification/delete-removal.test.ts \
  src/app/api/certification/submissions/route.test.ts \
  src/lib/certification/submission-progress-client.test.ts
```

Additional targeted coverage:

```bash
pnpm exec vitest run \
  tests/isometric-ghg-statement-submit-verifier.test.ts \
  tests/isometric-ghg-statement-submit.test.ts \
  src/components/certification/ghg-statement-submit-retry.test.tsx \
  src/components/certification/new-removal-dialog/submit-step.test.tsx \
  src/components/certification/certification-settings.test.tsx
```

Database-backed tests require isolated runtime provisioning and are **not** safe to point at staging:

- `tests/removal-deletion-pool.test.ts`
- `tests/removal-deletion-mutation.test.ts`
- `tests/certification-submissions.test.ts`
- `tests/registry-boundary-ghg-statement-finalization.test.ts`
- `tests/registry-boundary-ghg-statement-orphan-reconciliation.test.ts`
- `tests/ghg-statement-report-token-lifecycle.test.ts`

Do not use `pnpm test:integration` for this audit: it enables the Isometric sandbox suite.

### Minimal new timeout regression

Suggested new file: `src/lib/isometric/client-timeout.test.ts`. This is proposed source, not an executed test:

```ts
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    ISOMETRIC_ENVIRONMENT: "sandbox",
    ISOMETRIC_CLIENT_SECRET: "test-only",
    ISOMETRIC_ACCESS_TOKEN: "test-only",
  },
}));

vi.mock("@/lib/log", () => {
  const logger = {
    debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: () => logger,
  };
  return { logger };
});

import { getIsometricClientFromEnv } from "./client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("bounds body consumption after headers arrive", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => ({
    ok: true,
    status: 200,
    text: () => new Promise<string>((_resolve, reject) => {
      init.signal.addEventListener(
        "abort", () => reject(init.signal.reason), { once: true },
      );
    }),
  })));

  let outcome = "pending";
  const request = getIsometricClientFromEnv().post("/test", {}).then(
    () => { outcome = "resolved"; },
    () => { outcome = "rejected"; },
  );

  await vi.advanceTimersByTimeAsync(30_001);
  expect(outcome).toBe("rejected"); // Baseline remains pending.
  await request;
});
```

Also add an isolated compiled-action test for finding 1 and a real single-connection pool test for finding 3. The current mocked orchestration tests cannot establish either property.

## Untested cases

No browser walkthrough, compiled Server Action invocation, database concurrency test, failure-injection simulation, report rendering, registry contract verification, or live integration test was performed. Full downstream operational CRUD, all telemetry branches, and every nested measurement/source-binding permutation remain outside the demonstrated coverage.