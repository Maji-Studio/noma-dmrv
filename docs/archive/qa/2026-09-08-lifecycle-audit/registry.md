# Independent registry investigation

Consult [the parent audit](README.md) for verified rankings, later tests/build evidence, and contract verification. This report records one Astra low read-only CLI run; its test/access limitations do not apply to subsequent parent verification.

**Isometric and certification lifecycle audit**

**Baseline:** `ef857545b11fa298f0f08e128868ed14e37fbf5f`  
**Date:** 2026-09-08  
**Scope:** Removal orchestration, GHG Statements and reports, Sources, telemetry and sensors, registry Production Batches, Storage Locations, Biochar Applications, journals, locks, deletion and configuration effects.

The most consequential findings are unsafe caller-context exports in Server Action modules, an HTTP timeout that stops covering the request after headers arrive, and incomplete handling of unknown telemetry outcomes. The recent Storage Location recovery and Removal deletion work provides substantial protection, but it does not provide a general correction workflow for existing registry dependencies.

This report separates executed isolated simulations, static proof, documented policy and unresolved runtime questions.

**Audit conditions and evidence limits**

- Read the repository guidance, domain glossary, handoff, Isometric README, version pins, integration plan, OpenAPI index, relevant architecture/forms/security/testing guidance, ADRs 0003, 0004, 0006, 0020 and 0023, and current Isometric open questions.
- Confirmed the requested HEAD. Initial `git status --short` was empty.
- Made no repository changes, database calls, registry mutations, commits or communications to others.
- A final status check showed an untracked `docs/archive/qa/2026-09-08-lifecycle-audit/` directory appearing during the audit. This investigator did not create or inspect it.
- No Isometric MCP or `how_to` tool was available in the exposed tool inventory. Therefore, calling it first was impossible.
- Public Isometric documentation was accessed read-only. It is supporting contract evidence, not proof of deployed sandbox behavior.
- PR #751 and #740 comment retrieval failed because GitHub access was unavailable. Their successful staging verification remains **handoff evidence**, not independently repeated evidence.
- Dependencies were available. The inspected hermetic Storage Location Vitest suite failed before collection because Vitest could not create its temporary SSR directory in the read-only sandbox. **Zero Vitest tests executed.**
- Instead, isolated in-memory simulations executed the actual transpiled sensor, submission-policy and HTTP-client modules. Every external dependency was mocked; unexpected imports threw. No files, database or network resources were written.

References below are relative to the audited repository and identify the baseline code.

---

**Route/entity × operation × state coverage**

| Route or surface | Create | Edit/update | Delete | State and recovery coverage |
|---|---|---|---|---|
| `/certification/removals` → New Removal | Local grouping after server health validation | No ordinary Removal form; review recompiles current permitted facts | Delete Removal before any finalized version | Empty selection, missing batch, wrong facility/org, concurrent grouping, frozen slices |
| Removal detail → **Review & submit** | Creates registry artifacts after review | Same hash reuses version; changed permitted inputs supersede | Finalized history blocks deletion | Draft, active, interrupted, submitted, accepted, rejected, superseded |
| `/certification/removals?resume=<id>&facility=<id>` | Resumes existing local Removal | Compiled review hash checked server-side | Delete Removal available when eligible | Stale review, changed mappings/evidence, unknown external outcomes |
| Legacy `/certification/removals/[id]/review` | Redirect to current wizard | No separate editing implementation | None independently | Reviewed as a routing compatibility surface |
| `/certification/ghg-statements` | Period-based remote create or exact draft adoption | Explicit registry synchronization and verifier resubmission | No application delete action found | Missing remote ID, overlap, empty membership, shared project, concurrent reconciliation |
| GHG Statement detail | Report preparation | Refresh, report approval, Submit/Resubmit | No statement/report deletion affordance found | DRAFT, awaiting verification, verified, failed verification, stale report |
| Removal Sources panel | Automatic transfer during submission | Frozen operator evidence; narrowly controlled interrupted-evidence refresh | No remote Source delete; local mirrors may be released by Removal cleanup | Missing bytes, size/type mismatch, signed upload failure, orphan adoption |
| Application detail → registry site synchronization | **Sync application site** | **Check for drift**, **Check again**, **Retry sync** | No independent remote Storage Location deletion | Missing coordinates, 404 recovery, true drift, duplicates, 403/5xx, dependency replacement |
| Registry Production Batch | Implicit during Removal submission | Existing identity reuse; confirmed absence recovery | Exact unshared batch cleanup within Removal deletion | Missing inputs, remote-only/local-only, duplicate reference, replacement CAS |
| Registry Biochar Application | One claim per immutable application/batch/submission slice | Reconciliation; no ordinary correction action | Within eligible Removal deletion | Null association, remote absence, payload drift, replaced dependencies, unknown POST |
| Telemetry/sensors | Server pipeline exists | Journal-based retry/status refresh | No operator delete/recovery workflow found | Dark UI; sensor race, stale mappings, lost submission response, expired URL |
| Facility registry mapping | Admin mapping action | Validated project/template; locked mapping changes | Guarded unlink | Stale mapping, null template, facility-ID changes, established registry dependencies |
| Organization credentials | Parent-owned CRUD | Effects inspected only | Effects inspected only | No operation-wide credential snapshot; removal does not remove registry history |

**Actual layer evidence**

| Lifecycle | UI → hook → action/core → persistence → schema |
|---|---|
| Local Removal grouping | `components/certification/new-removal-dialog/index.tsx:150` → `hooks/use-certification.ts:689` → `fn/certification/create-removal-with-batches.ts:30` → `data-access/certifier-removals.ts:367` → `db/schema/certification.ts:376`; input `schemas/certification.ts:127` |
| Removal submission | `components/certification/new-removal-dialog/submit-step.tsx:170` → `hooks/use-certification.ts:662` → `app/api/certification/submissions/route.ts:50` → `fn/certification/submit-removal.ts:145` → `data-access/certification-submissions.ts` → `db/schema/certification.ts:435`; input `schemas/certification.ts:113` |
| Removal deletion | `components/certification/removal-detail-sheet.tsx:345` → `hooks/use-certification.ts:703` → `fn/certification/delete-removal-action.ts` → `fn/certification/delete-removal.ts:89` → `data-access/certifier-removal-deletion.ts:180` → Removal/submission/slice schemas; input `schemas/certification.ts:140` |
| GHG Statement create | `components/certification/ghg-statement-create-dialog.tsx` → `hooks/use-certification.ts:891` → `fn/certification/ghg-statements.ts:201` → `data-access/certifier-ghg-statements.ts` → `db/schema/certification.ts:225` |
| GHG Statement sync | `components/certification/ghg-statements-list.tsx:363` → `hooks/use-certification.ts:777` → `fn/certification/ghg-statement-sync.ts:17` → `fn/certification/ghg-statement-reconciliation.ts:93` → `data-access/certifier-ghg-remote-state.ts` |
| GHG Statement submit | `components/certification/ghg-statement-detail-sheet.tsx:269` → `hooks/use-certification.ts:905` → stream route → `fn/certification/submit-ghg-statement.ts:254` → statement/report persistence; input `schemas/certification.ts:147` |
| Reports | Submit dialog → `hooks/use-certification.ts:845,859` → `fn/certification/ghg-statement-reports.ts:352,448` → `data-access/ghg-statement-reports.ts:299` → `db/schema/certification.ts:290` |
| Sources | `components/certification/sources-panel.tsx:40` → `hooks/use-certification-sources.ts` → `fn/certification/sources.ts:269` → `data-access/certifier-document-uploads.ts` → `db/schema/certification.ts:501` |
| Storage Location | `components/applications/application-storage-location-sync.tsx:28` → `hooks/use-storage-location-sync.ts:26` → `fn/certification/storage-location-actions.ts:62` → `fn/certification/storage-locations.ts:88` → `data-access/certifier-storage-locations.ts:332` → `db/schema/certifier-storage-locations.ts:29` |
| Production Batch | Removal submission → `fn/certification/production-batches.ts:180` → `data-access/certifier-production-batches.ts:258,316` → `db/schema/certifier-production-batches.ts:44` |
| Biochar Application | Removal finalization → `fn/certification/biochar-applications.ts:43,133` → `data-access/certifier-biochar-applications.ts:242` → `db/schema/certifier-biochar-applications.ts:31` |
| Telemetry | Unrendered `components/certification/telemetry-panel.tsx:36` → `hooks/use-telemetry-submission.ts` → `fn/certification/submit-telemetry.ts:104,120` → submission/readings/sensor data access → `db/schema/certification.ts:178,435` |

---

**Ranked confirmed defects**

**F1. P1: Caller-context helpers are exported from `"use server"` modules**

**Proof:** Static authorization-boundary defect. Deployed endpoint reachability was not executed.

Affected examples:

- `fn/certification/sources.ts:1,281`: `mirrorDocumentToSourceForUser(orgCtx, parsed, options)` is exported from a Server Action module.
- `fn/certification/sources.ts:184`: `mirrorCandidateSourcesForSubmission` is likewise exported.
- `fn/certification/submit-telemetry.ts:1,120`: `submitTelemetry(orgCtx, args)` is exported alongside the authenticated wrapper.
- `fn/certification/ghg-statement-reports.ts:1,330`: `issueVerifierReportUrl(orgCtx, reportId)` accepts caller context and returns a report capability URL.

The normal wrapper derives context through `withAction` at `fn/with-action.ts:62`. These helpers do not.

`requireOrgScope` merely checks nonempty caller-provided strings (`data-access/utils.ts:20`). `requireOrgRole` trusts the supplied role/platform-admin fields (`lib/auth/server.ts:217`). Neither authenticates a supplied context.

The Source helper also accepts:

- `enforceRemovalLifecycle`, defaulting to disabled;
- a supplied `submissionCandidate`, which skips live candidate derivation at `sources.ts:308`.

The report helper stages a verifier capability through `data-access/ghg-statement-reports.ts:356`; that seam calls `requireOrgScope`, not session authentication.

Next.js explicitly treats exported Server Actions as public HTTP endpoints requiring authorization. Unused actions may be removed during compilation, so the parent must inspect the actual build manifest before claiming a demonstrated deployed exploit. [Next.js data-security guidance](https://nextjs.org/docs/app/guides/data-security)

**Reproduction for parent, using mocks only:**

1. Compile the baseline in an isolated checkout.
2. Inspect its server-reference manifest for these exports.
3. For any registered helper, invoke its action through a hermetic request harness with fabricated context and mocked persistence/registry clients.
4. Assert that session resolution happens before any credential lookup, token staging or Source operation.

**Observed:** The source-level helpers trust their context argument; the Source helper permits bypassing lifecycle and candidate checks.

**Expected:** Caller-context cores reside in modules without `"use server"`. Public actions derive context from the session, validate input and expose no internal bypass options.

**Existing defense:** The normal wrappers and streaming route authenticate correctly. `delete-removal.ts:53` explicitly uses the safer core/action split.

**Operator copy:** This is an engineering/security correction, not an operator recovery workflow. For rejected requests:

> “You do not have permission to perform this action. No changes were made.”

Do not apply “No changes were made” retroactively to a suspected invocation. The Platform Admin must review available records; ordinary users should use existing **Review & submit** or GHG Statement **Submit** actions. There is no operator repair button for this boundary.

---

**F2. P1: Registry request timeout ends at response headers, leaving body reads unbounded**

**Proof:** Executed isolated simulation of the actual HTTP client.

At `lib/isometric/client.ts:196`, the timeout is cleared and the external abort listener removed. Only afterward does the function call `response.text()` at lines 205 or 219.

**Reproduction:**

1. Mock `fetch` to return HTTP 200 headers immediately.
2. Make `response.text()` return a pending promise.
3. Execute `getIsometricClientFromEnv().get("/mock")` with fake credentials and fake timers.

**Observed output:**

```json
{
  "case": "headers-received-body-stalls",
  "bodyRead": true,
  "activeTimeouts": 0,
  "settled": false,
  "signalAborted": false
}
```

**Expected:** The 30-second request deadline covers headers and the complete body. External cancellation remains connected until reading finishes.

**Impact:**

- Registry reads/writes can hang until platform termination.
- Locks held around the call remain occupied.
- Submission stream pings continue independently (`app/api/certification/submissions/route.ts:118`), so the client’s inactivity timeout does not necessarily identify the stalled registry operation.
- A POST body stall is an unknown outcome, not proof of failure.

**Existing defense:** Network errors and status-based retries distinguish idempotent methods; POST/PATCH are not blindly retried by default (`client.ts:178`). Client stream errors already use appropriately uncertain wording.

**Operator copy:**

> “Isometric’s response did not finish. The submission may have been received. Close this dialog and refresh the page before trying again.”

An Admin can reopen the Removal’s **Review & submit** workflow, or use **Refresh** on the GHG Statement. Do not promise that closing cancels server work.

**Meaningful regression:** Return headers immediately and stall both successful and error bodies. Advance fake time past the deadline; verify rejection, resource cleanup and preservation of unknown-write state.

---

**F3. P2: Concurrent sensor creation can issue duplicate POSTs; local reuse ignores changed connection facts**

**Proof:** Executed isolated simulation of actual `ensureSensorForReactor`.

`data-access/certifier-sensors.ts:62` checks local existence, then performs reference lookup and POST at lines 93–106 without a shared creation lock. The eventual conflict update writes the losing caller’s `excluded.external_sensor_id` at line 131.

Sensor creation runs **before** the telemetry submission claim (`submit-telemetry.ts:171`), so that later claim does not serialize it.

**Reproduction:**

1. Start with no local sensor.
2. Run two `ensureSensorForReactor` calls concurrently for the same reactor/property.
3. Both mocked registry lookups return no match.
4. Let both POSTs succeed with distinct IDs.

**Observed output:**

```json
{
  "case": "concurrent-first-create",
  "posts": 2,
  "lookups": 2,
  "returnedIds": ["sensor-1", "sensor-2"],
  "storedId": "sensor-2"
}
```

This proves duplicate POST attempts and conflicting returned identities under the simulated provider behavior. It does not independently prove current Isometric accepts duplicate references.

A second simulation reused the saved sensor with changed requested units and facility:

```json
{
  "case": "changed-units-and-facility",
  "requestedUnits": "bar",
  "returnedUnits": "degC",
  "additionalPosts": 0,
  "additionalLookups": 0
}
```

The early return at `certifier-sensors.ts:74` does not validate either fact. The remote-only adoption path validates units but not facility; `lib/isometric/sensors.ts:66` selects the first match rather than refusing duplicates.

**Expected:** Serialize lookup/create/persist at the sensor identity grain. Validate the existing sensor’s property, units and destination. Refuse multiple matching remote identities.

**Existing defense:** Organization-scoped local queries and reactor ownership checks exist. Remote lookup before POST recovers a single ordinary orphan.

**Operator copy:**

> “Telemetry is blocked because its sensor mapping needs review. Sensor records may already exist in Isometric. Do not retry until an Admin has checked the matching sensors.”

The telemetry panel is not rendered, so there is **no current operator route/button** for this recovery. Do not direct users to a fictitious Sensors settings page. Engineering must provide a guarded correction path before enabling this workflow.

---

**F4. P2: Lost telemetry submission responses are reported as definitely unsent and enter another POST path**

**Proof:** Executed actual pure claim-policy simulation plus static orchestration trace.

`submit-telemetry.ts:458` POSTs a DataUploadSubmission, then journals its ID at line 462. A response loss, or failure persisting that ID, leaves the local record unable to distinguish “POST never landed” from “POST succeeded.”

`failTelemetryAttempt` marks the attempt rejected and says:

> “Telemetry was not submitted. … Try again.”

Evidence: `submit-telemetry.ts:619–647`.

**Executed policy outcomes:**

| Saved journal | Actual decision |
|---|---|
| FileUpload ID, no submission ID, fresh URL | `resume-re-put` |
| FileUpload ID, no submission ID, expired URL | `create-new-version`, `dataupload-orphan-restart` |
| Journaled submission ID | `resume-poll-existing` |

The first two branches eventually POST another DataUploadSubmission.

**Expected:** Record an unknown step-3 outcome explicitly. Do not claim non-submission. Reconcile or require an explicit reviewed restart according to a verified provider contract.

**Contract limit:** Public documentation exposes the DataUploadSubmission create operation and its upload/destination fields; it does not establish a supplier-reference recovery contract or a repeat-POST guarantee. This audit does **not** claim confirmed duplicate processing at Isometric. [Isometric DataUploadSubmission reference](https://docs.isometric.com/api-reference/certify/post-data-upload-submission)

**Existing defense:** If the submission ID was journaled, retry polls it. Terminal remote `failed` has a deliberate new-version path. Changed readings invalidate the semantic hash. These do not resolve the response-loss window before journaling.

ADR 0006 explicitly accepts orphan FileUploads, but its consequences understate the distinct possibility of an already-created DataUploadSubmission.

**Operator copy:**

> “Telemetry submission could not be confirmed. Isometric may already be processing the file. Do not submit it again until an Admin has checked the registry outcome.”

There is no rendered telemetry recovery button or implemented discovery mechanism that justifies “safe retry” for this particular state.

---

**F5. P2: Source mirroring awaits an audit write through the same pool whose connection it holds**

**Proof:** Static resource-dependency proof; no real database test run.

- Source mirroring enters `db.transaction` at `fn/certification/sources.ts:402`.
- Before returning, it awaits `appendSyncEventBestEffort` at line 563.
- That helper awaits `appendSyncEvent` (`fn/certification/shared.ts:80`).
- The event writer uses global `db`, not the held transaction (`data-access/certifier-sync-events.ts:30`).
- The application pool defaults to one connection and a 10-second acquisition timeout (`db/index.ts:13`).

**Reproduction:**

Use a hermetic single-slot pool mock:

1. The mirror transaction acquires the only slot.
2. Registry lookup/create/upload succeeds.
3. The success audit requests a second slot.
4. It cannot acquire one until the transaction returns, but the transaction awaits the audit.
5. Acquisition times out; best-effort handling swallows it; the mirror can then commit.

**Observed from code:** Under the default single-connection configuration, an ordinary successful mirror incurs a pool wait and loses its success event. Multiple concurrent mirrors can produce the same dependency under larger pools.

**Expected:** Write through the transaction where appropriate, or append the event after the transaction releases its slot. Independent failure auditing must not wait on a slot retained by its caller.

**Existing defense:** The acquisition timeout bounds the wait; best-effort auditing prevents the timeout alone from unwinding successful registry work. This is not an infinite database deadlock.

**Operator copy:**

> “The file was copied to Isometric, but its activity entry could not be saved. No retry is needed for this file.”

Only use that copy once the mirror mapping is committed. If commit outcome is unknown, say confirmation is unavailable instead. Engineering resolves this; operators have no audit-repair button.

---

**F6. P2: Partial deletion does not persist a deletion-only recovery state**

**Proof:** Static trace; also recorded in current open questions.

`delete-removal.ts:218` deletes GHG Entries before Biochar Applications. A later failure releases the deletion claim (`delete-removal.ts:117–143`), restoring the earlier attempt state. The retained ledger can still contain the now-deleted GHG Entry ID.

Normal submission later reuses `row.externalId` (`submit-removal.ts:914`) and reconciles dependent artifacts. It does not recognize “cleanup started, must finish deletion.”

**Reproduction:**

1. Create a never-finalized fixture with a confirmed draft GHG Entry and Biochar Application.
2. Make GHG Entry DELETE succeed.
3. Make Biochar Application DELETE return 503.
4. Reload the Removal.
5. Choose **Review & submit** rather than **Delete Removal**.

**Observed:** Local state remains available, but the wrong workflow attempts to reuse partially deleted registry history.

**Expected:** Persist cleanup-started/outcome facts independently of final deletion. While cleanup is incomplete, expose **Delete Removal** as the recovery action and reject ordinary submit.

**Existing defense:** The immediate error already says:

> “Some registry records were already deleted. Run Delete Removal again to finish the cleanup.”

Repeated deletion tolerates confirmed absence and converges. The gap is durable state/action selection after refresh, not the deletion retry itself.

**Operator copy:**

> “Removal deletion is incomplete. Some registry records were deleted, and the local Removal is still saved. Use Delete Removal again to finish cleanup.”

Current route: `/certification/removals`, Removal detail → **Delete Removal**. Under current policy, any authorized organization member may delete; this is explicitly documented in code as issue #746, not an accidental missing Admin check.

---

**F7. P3: Storage Location drift copy describes changed facts even when the actual condition is absence**

**Proof:** Static rendering trace.

`application-storage-location-sync.tsx:106` renders the same explanation for every `drifted` state:

> “The current Application site differs … Review the name and coordinates.”

However, Storage Location recovery preserves confirmed absence as drift when recovery cannot finish. Missing remote identity and changed coordinates are different conditions.

**Expected:** Render the recorded drift reason, not a generic inference.

**Operator copy for confirmed absence with incomplete recovery:**

> “The saved Storage Location no longer exists in Isometric. The Application is still saved. Use Check again to retry the registry check and recovery.”

Current action: Application detail → **Check again**. Admin required for synchronization. If the last read was 403/5xx, use “could not be checked,” not “no longer exists.”

---

**Confirmed recovery gaps and intentional policy boundaries**

These should inform implementation planning, but should not be presented as newly discovered data-corruption bugs.

| Condition | Current behavior | Actual recovery and limitation |
|---|---|---|
| Storage Location 404, unchanged local facts | Locked recheck, stable-reference reconciliation, adopt/create replacement | **Check again** or Removal submission; implemented |
| Existing Biochar Application references replaced Storage Location | Marks dependent claims `review_required`; preserves original IDs/payload | Submission stops at `biochar-applications.ts:192`; no correction action found |
| Confirmed Biochar Application returns 404 | Marks `remote_record_missing`, refuses reuse | `biochar-applications.ts:319`; no general recreate/adopt action |
| Biochar Application payload/dependency drift | Refuses rather than silently rewriting | Exact journal correction/supersession workflow missing |
| Submitted Removal needs new operator evidence | Retains frozen operator evidence even on supersession | No general evidence amendment workflow; new documents are not automatically included |
| Existing Source disappears remotely | Local mirror short-circuit does not validate its continued existence | Automatic Source recreation from an existing mapping not found |
| Remote GHG Statement disappears | Refresh fails; no statement deletion/rebinding workflow | **Sync from registry** imports discoverable records, not a general missing-identity repair |
| Shared project across facilities | GHG Statement creation explicitly refused | Dedicated-project policy; mapping freezes may make “relink first” impractical after submissions |
| Remote-only duplicate/reference ambiguity | Fails closed | Requires registry investigation; no universal local “adopt this ID” control |
| Lookup exceeds configured page bound | Fails closed rather than assuming absence | Capacity/support limitation, not evidence that POST is safe |

For replaced Storage Location dependencies, accurate copy is:

> “The Storage Location was recovered. This Biochar Application still refers to the previous registry site, so the Removal could not finish. Ask support to review the saved claim and registry records before retrying.”

This is a **support dependency without a completed support recovery mechanism**. Repository search found a stale-lock script, but no script/action that safely repairs these dependency claims. The stale-lock script only changes submission lock/status; it does not reconcile the Biochar Application or replace its dependency and must not be advertised as that repair.

For eligible never-finalized Removals, **Delete Removal** is a separate existing cleanup option. It is not a non-destructive dependency repair, and finalized Removals cannot use it.

---

**Simulation and failure matrix**

Legend: **Executed** means the actual module ran with isolated mocks. **Static** means traced in baseline code. **Existing test** means inspected test evidence, not a passing run in this audit.

| Scenario | Evidence | Result |
|---|---|---|
| Concurrent sensor first-create | Executed | Two lookup/POST paths; conflicting returned IDs |
| Existing sensor, changed units/facility | Executed | Old row returned without registry validation |
| Telemetry lost response, fresh URL | Executed policy | Re-PUT path followed by another submit POST |
| Telemetry lost response, expired URL | Executed policy | New version/restart |
| Telemetry ID journaled | Executed policy | Poll existing ID |
| HTTP headers arrive, body stalls | Executed | Timeout removed; request remains pending |
| Empty Removal selection | Static | Schema/server reject |
| Selected batch deleted or cross-org | Static | Scoped count mismatch rejects before grouping |
| Two grouping attempts | Static | Ordered batch/slice row locks; second cannot claim consumed slices |
| Stale Removal review | Static | Compilation hash mismatch blocks outbound compiled submission |
| New evidence after immutable claim | Static | Frozen candidate tuple retained |
| Active submission/expired lock | Static | Ten-minute TTL plus interrupted-attempt policy and guarded reclaim |
| Old deletion caller after lease takeover | Static | Exact timestamp ownership checked before mutation/finalization |
| Membership changes during batch deletion | Static | Batch locks and final shared-ownership recheck |
| GHG Entry deletion refused | Existing test | Child cleanup stops |
| GHG Entry deleted, later child DELETE fails | Static/existing test | Partial-cleanup message; local state retained |
| DELETE returns 404 | Existing test | Counts as already absent |
| Generic 400, 403, 429 or 5xx during deletion | Existing test | Not broadly treated as absence |
| Storage Location first sync race | Existing test | Shared locks serialize POST |
| Storage Location missing, replacement already exists | Existing test | Adopts exact replacement |
| Storage Location lookup unavailable/contradictory | Existing test | Does not POST based on failed lookup |
| Storage Location local facts changed before recovery | Static/existing test | Refuses recovery against stale review |
| Storage Location replacement with old Biochar claim | Static/existing test | Old dependency preserved; submission blocked |
| Biochar Application association null | Existing test | Accepted; previous non-null observation retained |
| Biochar Application association points elsewhere | Existing test | Refused |
| Biochar Application Source IDs omitted | Static | Accepted request retained; no REST readback proof |
| GHG Statement duplicate/overlapping period | Static | Refuse or exact draft adoption |
| Empty GHG Statement | Static | Predictive create guard and linked-count submit guard |
| Stale generated report | Static | Fingerprint rebuild refuses approval/submission |
| Report POST response lost | Static | Remote state/report matching attempts reconciliation |
| Credential removal during operation | Static hypothesis | Later client construction may fail; previously created clients remain usable |
| Single-slot Source mirror | Static | Audit waits for a connection held by its own caller |

No live staging, real database transaction, browser, registry-delete or destructive simulation was performed.

---

**Existing defensive behavior worth preserving**

- **Local grouping is atomic and scoped.** The action re-derives health; data access validates facility, batch existence and available slices under locks. The 1,000-year one-batch limit is enforced server-side, not only in the wizard.
- **Review is meaningful.** `submitRemovalSchema` requires a compilation hash. Source IDs materializing during transfer do not invalidate the intended semantic review, while genuine reviewed changes do.
- **Unknown Removal outcomes retain reservations.** `removal-submission-failure.ts:79` releases claims only for mutation-free failures; possible/confirmed external work remains interrupted for reconciliation.
- **Deletion is not local-row deletion followed by best-effort cleanup.** It claims first, removes registry parents first, checks shared ownership, then finalizes local cleanup.
- **Lease expiry alone does not authorize an old deleter.** `certifier-removal-deletion.ts:468` rechecks exact ownership and holds mutation locks across destructive requests.
- **Storage Location recovery is conservative.** 403/network/5xx are not absence; unchanged snapshots and exact references govern replacement.
- **Biochar Application history is versioned.** New Removal submission versions use new claims rather than rewriting old records.
- **Report approval is version-sensitive.** `ghg-statement-reports.ts:325` requires the latest prepared version. Submit rebuilds freshness and uses pending/active verifier capability handling.
- **Read and sync are distinguished.** Loading GHG Statement state overlays live status without silently persisting reconciliation. **Refresh** and **Sync from registry** are explicit mutations.
- **Managed Source transfer is constrained.** Storage existence/size/type checks, upload-host allowlisting and redirect refusal exist.
- **Normal stream admission is authenticated, Admin-gated, validated and rate-limited.**
- **Submitted history protects downstream records.** Application and credit-batch lock readers follow certification lineage; credit-batch membership also considers telemetry submissions.

Relevant existing suites include:

- `src/fn/certification/storage-locations.test.ts`
- `src/fn/certification/production-batches.test.ts`
- `src/fn/certification/biochar-applications.test.ts`
- `src/fn/certification/delete-removal.test.ts`
- `tests/isometric-submit-telemetry-retry.test.ts`
- `tests/isometric-submission-claim.test.ts`
- `tests/registry-create.test.ts`
- `tests/ghg-statement-report-token-lifecycle.test.ts`
- `tests/ghg-statement-report-superseded-approval.test.ts`
- `src/components/certification/ghg-statement-refresh.test.tsx`

The test names and assertions provide useful intent, but their existence is not a substitute for executed concurrency or deployed-contract verification.

---

**Null clearing, missing data and stale-form assessment**

- Removal grouping is an identity-selection operation, not a nullable edit form. Missing IDs, empty selection and unavailable slices are explicitly rejected.
- Missing Storage Location coordinates block first creation. Incomplete facts on an already registered site become drift rather than an invented replacement payload.
- Production Batch first creation rejects missing dry mass, open runs and invalid production windows. Existing registered payload reuse deliberately records local drift; it does not automatically update remote production history.
- GHG Statement report source selection requires exactly a generated report or external HTTPS URL. Resubmission requires a nonblank summary.
- Mapping input normalizes absent/null template to `null`; `saveFacilityCertifierMapping` behaves as a full-save contract, not a partial PATCH.
- Facility emission configuration also coalesces omitted values to `null`. The parent should ensure callers consistently submit complete forms; this audit did not establish a UI clearing defect.
- Stale generated reports and stale Removal compilation are checked server-side.
- Missing remote Statement reads are collapsed to `remote: null` in `ghg-statements.ts:753`, losing the distinction between absence, permission failure and transient failure in that view. This is a diagnostic limitation; it is not evidence that the UI proceeds with unsafe generated reports.
- Creation response loss can leave a committed local Removal while the wizard still shows an error. There is no request idempotency key for grouping; slice locking prevents duplicate grouping, but a retry may report no unassigned mass rather than returning the existing Removal. Treat this as an operator-discovery improvement, not proven duplicate creation.

---

**Hypotheses requiring parent verification**

1. **Actual deployed reachability of F1 helpers.** Inspect the build manifest and use a hermetic request harness. Do not claim an exploited cross-org route from source inspection alone.
2. **Provider behavior for repeated telemetry POSTs.** Determine whether the same FileUpload can create multiple submissions, is rejected, or returns an existing result. Current code does not establish this.
3. **Operation-wide credentials consistency.** The Removal pipeline constructs clients at several stages, while credential writes do not use its operation locks. Rotating to another account mid-operation may mix registry authority or strand later steps. This was not executed.
4. **Existing Source remote absence or project mismatch.** Local mappings are keyed by document/provider and reused without remote readback. Whether specific mapping changes can reach an invalid cross-project reuse requires an isolated full-path fixture.
5. **Registry cascade behavior.** The current code deletes owned MeasurementSamples and unshared Production Batches. The open-question text saying these are all left behind is stale. Remaining Datapoint/Source retention must be assessed against actual provider cascades.
6. **Shared-project recovery wording.** “Link each facility to a dedicated project” is a policy instruction, but may be blocked by existing submission history. Confirm an achievable migration path before presenting it as routine operator recovery.
7. **Supplier-reference visibility delay.** Reconciliation-first is safer than blind retry, but a list miss after a lost POST does not establish strong uniqueness unless the provider guarantees visibility or uniqueness.

---

**Prioritized implementation plan**

| Priority | Change | Meaningful verification |
|---|---|---|
| 1 | Move caller-context helpers out of `"use server"` modules; retain small authenticated actions | Build-manifest check; unauthenticated, Member and fabricated-context request tests; no credential/token/registry calls before auth |
| 1 | Keep registry timeout and cancellation active through body consumption | Headers-only stalls for 200/4xx/5xx; cancellation during body read; POST remains unknown rather than rejected |
| 2 | Persist deletion-started/partial outcomes independently of final cleanup | Delete parent successfully, fail child, reload; submit blocked; Delete Removal safely converges |
| 2 | Remove Source mirror’s same-pool audit dependency | Single-slot mock; mirror completes without timeout and event is recorded after release |
| 2 | Serialize sensor creation and validate destination/property/units | Two concurrent misses produce one POST; duplicate references refused; changed destination cannot silently reuse old sensor |
| 2 | Add telemetry step-3 unknown state before enabling UI | Provider accepts POST then response/journal write fails; retry does not silently restart without verified policy |
| 3 | Provide a registry-confirmed Biochar dependency correction workflow | Old claim preserved; confirmed absence, ambiguous POST, replacement and finalized-history cases separately exercised |
| 3 | Expose structured registry observation/recovery reasons | 404 differs from 403/5xx; exact route/action and resolver role rendered |
| 3 | Reconcile docs with implemented deletion and recovery boundaries | Remove obsolete MeasurementSample/Production Batch orphan claims; clarify telemetry ambiguity |
| 3 | Improve response-loss discovery for local grouping | Successful local commit with lost response leads operator to existing Removal without duplicate grouping |

Do not begin with a universal lifecycle framework. The existing create/reconcile core, deletion mutation fence and report capability state each solve different problems. The smallest useful common result is structured outcome data such as:

```ts
{
  localOutcome: "saved" | "unchanged" | "deleted" | "unknown",
  registryOutcome: "none" | "confirmed" | "possible",
  recovery: "retry" | "refresh" | "finish-deletion" | "support-review",
  reason: string
}
```

Each workflow should own which outcomes are valid and which action can resolve them. In particular, a generic retry button must not turn “unknown” into permission to recreate.

---

**Reproducible verification handoff**

The attempted command was:

```sh
pnpm exec vitest run src/fn/certification/storage-locations.test.ts --no-cache
```

It failed before test collection with an `EPERM` creating Vitest’s temporary SSR directory. The parent can rerun that inspected, mocked suite in an isolated writable environment. Do not run the entire test collection: global setup loads `.env.test`, and many certification suites use real database fixtures.

The executed in-memory harnesses used this pattern:

1. Read the baseline TypeScript file.
2. Transpile with installed `typescript.transpileModule`.
3. Evaluate in `vm.runInNewContext`.
4. Supply an explicit import map; throw for every unknown import.
5. Mock all database, credential, logger, registry and timer surfaces.
6. Invoke exported functions and inspect deterministic results.

Modules successfully exercised:

- `src/data-access/certifier-sensors.ts`
- `src/lib/isometric/utils/submission-claim.ts`
- `src/lib/isometric/client.ts`

The exact scenarios and observed outputs are recorded under F2–F4. These simulations establish local control flow, not PostgreSQL isolation or Isometric runtime semantics.

**Untested:** deployed Server Action manifest/HTTP invocation, real database locking and rollback, live browser behavior, registry consistency delay, provider duplicate acceptance, remote deletion cascades, credential rotation during a running operation, report PDF rendering, and the complete staged submission chain. No conclusion above treats those cases as executed or verified.