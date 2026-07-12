# Final 12-month GHG + Method A/B QA follow-up — 2026-07-12

## Scope and evidence basis

This follow-up audits the reset-database, 1000-year workflow requested for 12
monthly credit batches, final GHG entries, and reporting periods. It builds on
the completed operator run in
[`2026-07-11-e2e-12-month-methods.md`](2026-07-11-e2e-12-month-methods.md),
which already created 12 monthly credit batches, submitted 12 sandbox Removals,
linked all 12 into one annual GHG Statement, attached 63/63 sample laboratory
reports and 63/63 sample-to-lab transport evidence sets locally, and exercised
the Method-A → Method-B → new-Method-A lifecycle. Only month eight's 11-document
set was mirrored remotely in that pass.

The follow-up starts from another `pnpm db:reset`, rechecks the current
post-organization-scoping `staging` baseline, and focuses on unresolved
correctness and operator-experience gaps. Synthetic QA records are not evidence
of real operational activity or protocol compliance.

## Outcome and domain interpretation

The implemented domain shape is **12 monthly credit batches → 12 GHG
Entries/Removals → one annual GHG Statement**. Twelve separate GHG Statements
would mean twelve independent reporting periods and is a different workflow.

This result deliberately combines two evidence passes without pretending they
were one dataset:

- The 2026-07-11 reset-to-registry pass created 12 monthly 1000-year batches,
  submitted 12 sandbox GHG Entries/Removals, and linked them to annual statement
  `ggs_1KX9BFSBSSBX4RGS`.
- The 2026-07-12 current-base pass reset again and exercised realistic
  every-two-day production, six-to-seven-day laboratory delays, the repaired
  source-attachment surfaces, a local ready Removal, and the Method A/B
  lifecycle. It did **not** create another set of remote sandbox entries.

A read-only Isometric readback on 2026-07-12 confirmed the annual statement is
still `DRAFT`, covers `2026-11-22` through `2027-11-30`, and contains exactly 12
GHG Entries. All 12 entries returned successfully, use `credit_type=REMOVAL`,
link to that statement, and form monthly windows from December 2026 through
November 2027.

## Branch and issue reconciliation

- The tested base is `07f9101`. It already contains PRs #427–#430, including
  the 1000-year payload fixes, organization scoping/per-org credentials, and the
  Method-B as-of timing fix. Their source branches must not be merged again.
- `origin/staging` is one unrelated migration-gate commit (#431) ahead. There
  are no open PRs requiring a merge for this flow.
- Open #417 partially overlaps the unsampled Method-B failure, but does not
  cover the full 1000-year blueprint gap, Removal-scoped cadence, retroactive
  method interpretation, or baseline provenance.
- Open #246 covers badge/final-gate parity; #420 covers adjacent transport-leg
  integrity; #278 tracks protocol v1.2→v1.3 migration; #380 tracks the broader
  operator-guidance problem. #200/#391 remain relevant to lock/audit history.

## Findings ledger

| Area | Severity | Type | Repro | Expected vs. actual | Root cause / evidence | Decision or suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Unsampled Method-B grouping | P0 | Certification / Engineering | Unlock a 1000-year process, create an otherwise complete unsampled Method-B batch, then try to create its monthly Removal. | Method B should permit the declared reduced-frequency path when process-level gates are satisfied. Actual: batch health blocks on three missing 1000-year replicates before the batch can enter a Removal. | Batch health requires three replicates, and the 1000-year measurement builder requires three total-carbon/`s_fraction` replicates before method routing. Only the 200-year branch has an `_unsampled` blueprint. #417 only partially overlaps. | Reuse the authoritative Method-B gate at batch-health time and add an agreed 1000-year unsampled representation; do not weaken Method-A sampling. Until then remain fail-closed. | Prior browser-reproduced and current-base code-confirmed; not expanded without protocol agreement. |
| Method-B cadence scope | P0 | Certification / Engineering | After one sampled Method-B batch satisfies the process plan, create a normal one-batch monthly Removal for the next unsampled batch. | Cadence should be evaluated over the production process history/window. Actual: the submit gate sees only the current Removal, computes 0 sampled of 1 required, and blocks. | `src/lib/certification/durability-submission-gates.ts` derives cadence from Removal members; #417 is only adjacent. | Load an explicit process-level cadence fact or eligible process batch window before enabling the unsampled route. | Code-confirmed; deliberately left fail-closed. |
| Method regime is retroactive | P0 | Protocol integrity / Product decision | Create historical Method-A batches, unlock their process, then re-evaluate an earlier batch. | The sampling obligation that applied when a batch was produced should remain auditable. Actual: readiness reads the process's current method, so unlock may reinterpret historical batches as Method B. | Method is stored only on `production_processes` and read live for member batches; no per-batch regime snapshot/effective interval. | Confirm intended temporal model with the protocol owner before changing storage; likely needs an effective-at boundary rather than a UI patch. | Newly code-confirmed; decision required. |
| Method-B baseline accepts non-representative rows | P0 | Protocol integrity | Add 30 complete samples clustered on one day and dated before the process/run, then unlock. | Baseline samples should fall within the process and represent distributed independent sampling. Actual: rows warn as clustered but count 30/30 and unlock. | Eligibility is principally a row count with an upper `asOfDate`; it lacks an `establishedAt` lower bound and hard independence predicate. | A lower temporal bound may be bounded; independent-sampling semantics require protocol/product agreement. Never treat synthetic attack rows as valid evidence. | Reproduced in the prior run; still open. |
| Application readiness disagreement | P0 | Certification / UX | Create a Visual application without all geotagged role evidence, compare list badge and Removal readiness. | Both surfaces should agree. Actual: list can show Ready while final readiness blocks; boundary + logbook is evaluated more strictly at submit time. | The list badge uses a shallower predicate than final Removal evidence readiness; overlaps #246. The final submit builder also trusted the UI-only gap. | Reuse one authoritative evidence-readiness result. The bounded QA fix now rejects non-empty `entityReadinessGaps` at the final registry build boundary, but list/badge parity remains #246. | Submit backstop fixed + unit-tested; badge parity remains open. |
| Sample evidence readiness | P0 | Certification / UX | Save complete 1000-year chemistry with no COA and no sample-to-lab transport evidence. | The sample should not claim certification readiness. Actual: sample list/detail said Ready while the predicate only evaluated chemistry. Missing COA is not currently a final hard gate, so making the badge stricter alone would create new drift. | Chemistry readiness is not coupled to an agreed source/evidence policy. | The bounded fix relabels the column and pill to `Chemistry` / `Chemistry complete`; define a shared lab/transport policy before claiming full readiness. | Misleading claim fixed, unit-tested, and browser-verified; evidence policy remains open. |
| Feedstock and delivery transport evidence UI | P1 | Certification / UX | Create derived inbound and outbound legs, then try to attach a BoL/weigh ticket through the feedstock or delivery flow. | Every claimed transport distance should have an operator attachment path. Actual: the derived legs were rendered read-only and no evidence editor was exposed; sample legs support it. | Feedstock and delivery surfaces omitted the existing document pipeline; attaching to replaceable derived-leg rows could orphan files. #420 does not cover this missing control. | Reuse one attachment-only panel, storing inbound evidence on stable feedstock records and outbound evidence on stable delivery records; keep derived legs read-only. | Implemented, unit-tested, and UI-verified with 8/8 feedstock/delivery files. All appear in the 19-candidate Removal set. |
| Supporting Sources discoverability | P1 | Certification / UX | In New Removal, select a batch and continue to the Confirm & submit step. | Operator should be led through evidence mirroring before final submit. Actual: the wizard reports Ready to submit, but Supporting Sources exists only after closing it and reopening the draft detail; this run then showed `0 of 19 mirrored`. | Wizard has Select → Confirm & submit only; source management lives at `?removal=<id>`. | Add a clear “Review supporting sources” handoff or integrate the existing panel before submit; avoid implicit auto-mirroring. | Current-base browser-reproduced; open as an operator-guidance issue (#380 adjacent). |
| Legacy URL-only Source looks mirrorable | P1 | Certification / UX | Open Supporting Sources for a Removal containing an old URL-only document. | The UI should explain that managed bytes are required. Actual: an enabled Mirror action inevitably failed the server's `storageKey` pre-flight. | Candidate rows branched only on whether a remote mirror existed even though the document payload already exposed managed-storage state. | Keep the server fail-closed and render a disabled `Re-upload required` affordance for URL-only rows. | Fixed, component-tested, and browser-verified: 17 managed Mirror actions plus two disabled legacy rows. |
| Automatic evidence-ledger failure is non-actionable | P1 | Certification / Operations | Submit an otherwise complete Removal while generated evidence-ledger export fails. | Missing exported evidence should be visible and actionable. Actual: submission continues after a generic best-effort warning. | Prior live run logged `evidence ledger generation failed; submitting without it` without actionable detail. | Preserve fail-closed registry behavior where required and expose ledger status/error before submission; do not blindly retry remote side effects. | Reproduced across prior live submissions; still open. |
| Remote Source audit-event loss | P1 | Auditability / Engineering | Mirror documents and inspect local sync-event writes. | Every successful remote Source creation should have a recoverable local audit event. Actual: remote mappings persisted while local sync-event inserts warned. | Remote side effect and local audit write are not atomic and lack a reconciliation path. | Add idempotent audit reconciliation; never retry remote creation blindly. | Reproduced in prior run; still open. |
| Source mirroring throughput | P2 | Operations / UX | Mirror an 11-document monthly evidence set. | Operator should see useful progress without a two-minute serial stall. Actual: synchronous serial uploads took about 11 seconds each. | Source loop is serial and foreground-bound. | Defer optimization until correctness; consider bounded background work with per-document status. | Reproduced in prior run; deferred. |
| Server Function credential logging | P0 | Security / Engineering | In development, save per-organization Isometric credentials and inspect the Next.js terminal. | Write-only tokens and client secrets must never reach logs. Actual: Next 16's default Server Function trace serialized the entire action input. | Framework development logging enables `logging.serverFunctions` by default. Application structured logging was already redacted, but the framework trace happened outside it. | Set `logging.serverFunctions=false`, keep a config regression, and rotate the exposed sandbox credential pair. | Fixed and runtime-verified: the same UI save succeeds with no Server Function argument trace. Rotation remains an external credential action. |
| Reset bootstrap logs PII | P1 | Security / Engineering | Run `pnpm db:reset` and inspect bootstrap output. | Auth/bootstrap logs should use stable IDs. Actual: legacy success messages printed the admin email and organization name. | `ensure-admin.ts` predated the repository's current PII logging rule. | Log only `userId`/`organizationId`; keep credential values and emails out of output. | Fixed; typecheck and targeted lint pass. |
| Reactor creation without a facility | P1 | UX / Data entry | From a zero-facility database, open Reactors and choose New Reactor. | The page should explain that a facility is required. Actual: it opened an enabled form whose hidden empty facility ID made submit appear to do nothing. | The table empty state was gated, but the header CTA and sheet were unconditional. | Use the shared select-facility empty state before rendering any reactor actions. | Fixed, unit-tested, and captured before fix in `cold-start/failure-reactor-create-without-facility.png`. |
| Admin users dead-end | P2 | UX | Open the User Management tile on the Admin page. | Admin should reach a working member-management surface. Actual: `/admin/users` only displayed “coming soon.” | A scaffold route remained linked after organization settings gained member/invitation management. | Relabel the tile and redirect `/admin/users` to `/settings/organization`; leave platform-wide directory work to #372. | Fixed and browser-verified. |
| Authenticated quick-add demo route | P1 | Security / Data integrity | Navigate directly to `/quick-add-demo` as any authenticated member. | Demo-only mutation controls should not be reachable in the application. Actual: the unlinked route exposed internal IDs and performed real organization-scoped writes. | The prototype route was auth-protected but not development-only. | Delete the route rather than maintain a second raw CRUD surface. | Fixed; browser verifies a 404. |
| Missing-ID detail routes | P2 | Engineering / UX | Open missing UUIDs for credit batch, supplier, and customer after reset. | Designed not-found states. Actual: credit batch can hit an error boundary; supplier/customer can remain on an indefinite loading state. | Dynamic IDs or missing results are not consistently validated/settled; issue #253 is adjacent and its local branch is stale. | Fix only if reproduced on the current base; do not merge the stale 509-line branch wholesale. | Retained from the prior run; dynamic missing-ID probes were outside this follow-up's 28 static-route sweep. |
| Product wet-mass derived value | P2 | UX / Engineering | Select a 150 kg run in Create Biochar Product and submit without retyping the visibly populated wet mass. | Visible derived value should satisfy the required field. Actual: React Hook Form reports Wet Mass required until re-entry. | Display-derived state and form state are not synchronized. | Bounded form-state fix after certification blockers. | Reproduced in prior run; open. |
| Sample pagination metadata | P2 | UX / Engineering | Create 60 samples with a 20-row page size. | Three pages or a 60-row page-size option. Actual: 20 rows render while footer says Page 1 of 1; exact search can find hidden rows. | Paginated query total/page metadata disagrees with rendered result set. | Add a focused pagination regression before changing the table. | Reproduced in prior run; open. |
| Transport evidence taxonomy | P1 | Compliance / Product decision | Review the two transport upload slots against Transportation v1.1 §6. | The UI should not imply BoL + weigh ticket exhaust the evidence contract. Actual: calibration, vehicle classification, and return/onward-destination evidence have no dedicated taxonomy. | The current component models only `bill_of_lading` and `weighbridge_ticket`. | Keep the bounded upload fix honest in copy; decide the wider evidence taxonomy separately. | Newly code-confirmed; not expanded here. |
| Protocol version drift | P1 | Compliance / Documentation | Compare Method-B ADRs and issue #417 with `docs/isometric/versions.json`. | Implementation claims should share one pinned authoritative version. Actual: Method-B decisions cite Biochar Protocol v1.3 while the local pin remains v1.2. | Version migration and rule implementation have moved on separate tracks. | Reconcile the pin before encoding additional Method-B credit logic. | Newly confirmed; no protocol logic changed. |
| Feedstock allocation can exceed intake | P1 | Mass integrity | Enter bin allocations whose sum exceeds the delivery's wet mass. | Stock creation should reject mass above the truck intake. Actual: the form warns but the schema accepts each non-negative allocation independently. | `src/schemas/feedstocks.ts` has no cross-row total invariant. | Add a schema/server total check after confirming override semantics; do not fix as UI-only validation. | Code-confirmed; deferred. |
| Product can link an unfinished run | P1 | Mass integrity / Engineering | Create a biochar product against a draft, running, or void production run. | Product inventory should come only from eligible completed production. Actual: create validates run existence/facility/bin stock but not run status. | `src/data-access/biochar-products.ts` does not select or gate the run lifecycle status. | Add a data-access lifecycle guard with a regression test; coordinate with the status-vocabulary migration. | Code-confirmed; deferred. |
| Upcoming deliveries affect derived transport | P1 | Certification / Engineering | Save an upcoming delivery with mass and distance, then inspect the product's derived distribution leg. | Certified transport should represent completed journeys. Actual: aggregation reads all product deliveries without filtering `status = delivered`. | `syncBiocharProductTransportLeg` queries by product only. | Filter or explicitly model planned versus completed transport, with stock/readiness regression coverage. | Code-confirmed; deferred. |
| `document` provenance is not evidence-coupled | P1 | Auditability / Engineering | Mark a distance source as Document without uploading any transport evidence. | A documentary provenance claim should have a corresponding document or visible missing-evidence state. Actual: the enum is accepted independently of uploads. | Distance provenance and polymorphic documents are separate facts. | Add a shared evidence-readiness fact once the transport evidence taxonomy is decided. | Code-confirmed; deferred. |
| Sampling independence is advisory only | P1 | Protocol integrity / Product decision | Add three complete replicates on one day or with unknown run provenance. | Independent sampling should be provable or explicitly accepted as an agreed alternative. Actual: the system warns but permits submission/unlock counting. | Run linkage is optional and distribution is a non-blocking warning by design. | Confirm hard-versus-advisory policy with Isometric before changing the gate. | Reproduced; intentionally not overengineered. |
| 1000-year TGA field mismatch | P1 | Certification / Product decision | Complete a 1000-year sample form and compare required TGA/reactive-carbon fields with the live blueprint payload. | Required operator fields should feed the credited path or be clearly labelled as evidence-only. Actual: sample creation requires TGA-style values while the 1000-year submission uses total carbon + `s_fraction`. | Form/readiness requirements and the verified sandbox payload were developed from different requirement interpretations. | Reconcile against the authoritative protocol before removing or crediting any field. | Code-confirmed; no unsafe change made. |
| Chain chronology is under-constrained | P2 | Data integrity | Enter feedstock after the run, product/order/delivery out of sequence, or analysis before sampling. | Obvious event-order inversions should fail or warn. Actual: only selected local constraints (for example application ≥ delivery) are enforced. | Schemas validate fields mostly in isolation; the full lineage has no shared chronology policy. | Add only high-confidence boundary checks; avoid a broad chronology engine without domain decisions. | Code-confirmed; deferred. |
| Production status vocabulary drift | P3 | Domain model | Compare production-run status options with `CONTEXT.md`. | UI/schema should use `failed` and `cancelled`; `void` is explicitly deprecated. Actual: code exposes `draft`, `running`, `complete`, `void`. | `src/schemas/production-runs.ts` and DB constraints predate the glossary update. | Handle as a dedicated migration; do not rename in this QA patch. | Code-confirmed; deferred. |

## Method A/B lifecycle result

The current-base computer-use lifecycle passed 1/1 in 6.4 seconds:

- At 9/30 eligible samples, Method B remained locked and explained that 21 more
  were required.
- At 30/30, the unlock action became available and the declaration captured the
  agreed baseline, sampling plan, and moisture pathway.
- “Start a new production process” clearly explained the history boundary and
  created a fresh Method-A process at 0/30 while retaining the historical
  Method-B process and declaration.

That transition is understandable as an operator workflow, but it does not
erase the P0 functional gaps above: unsampled 1000-year routing is unreachable,
cadence is Removal-scoped, the current method can reinterpret older batches,
and baseline provenance/independence is under-constrained.

The authoritative artifact is
`output/qa/2026-07-12-final-12-followup/method-b-lifecycle-clean/`. Two earlier
trace-enabled runs captured the screenshots but timed out during trace
finalization under disk pressure; their directories are diagnostic-only.

## Fresh current-base operator evidence

After the zero-state sweep, `pnpm db:seed` created one 1000-year facility and a
small realistic operating window:

| Surface | Current-base proof |
| --- | --- |
| Production cadence | Core runs `PR-26-001/002/003` occurred on 13, 15, and 17 May 2026, with 97/91/97 readings (285 total). |
| Laboratory delay | Six samples were analysed 6–7 days after sampling; for example `SAM-26-001` was sampled 13 May and analysed 20 May. |
| Batches and logistics | Two 1000-year credit batches, 12 transport legs, and three applications were seeded. |
| Evidence uploads | Authenticated UI flow passed 1/1 in 46.9 seconds and attached 17/17 PDFs: four feedstock, four delivery, three COAs, and six sample-leg transport documents. All are private, `uploaded`, and have managed storage keys. |
| Local Removal | Draft `45eeca0a…` contains only `CB-26-001`, is not submitted, and is marked Ready to submit. Its detail exposes exactly 19 private candidates and `0 of 19 mirrored`. |
| Registry safety | Local counts remain zero for certification submissions, GHG Statements, and document-upload mappings. No fresh Source, Removal, or statement mutation was sent to Isometric. |

The 19 candidates are the 17 managed uploads plus two seeded application
logbooks. Those two logbooks are legacy URL-only rows with no storage key and
must be re-uploaded before mirroring. The server rejects them fail-closed, and
the bounded UI fix now labels both `Re-upload required` while retaining Mirror
for the 17 managed files.

Local computer-use artifacts (intentionally not committed):

- `output/qa/2026-07-12-final-12-followup/cold-start/report.md`
- `output/qa/2026-07-12-final-12-followup/operator-evidence/evidence-attachment-report.md`
- `output/qa/2026-07-12-final-12-followup/operator-evidence/report-accurate.md`
- `output/qa/2026-07-12-final-12-followup/operator-evidence/local-removal-ready-no-submit.png`
- `output/qa/2026-07-12-final-12-followup/operator-evidence/supporting-sources-19-candidates-top.png`
- `output/qa/2026-07-12-final-12-followup/operator-evidence/supporting-sources-sample-transport-bottom.png`
- `output/qa/2026-07-12-final-12-followup/operator-evidence/supporting-sources-legacy-reupload-required.png`
- `output/pdf/2026-07-12-demo-evidence/` — 17 one-page PDFs, each visibly
  marked synthetic QA evidence and checked for clipping/overlap.

## Environment notes for this follow-up

- Docker Desktop was restarted with explicit approval. Postgres then passed
  `docker info`, `pnpm docker:up`, and `pnpm db:wait`.
- `pnpm db:reset` completed. Before seeding, every operational table was zero;
  only two users/accounts, one organization/member bootstrap, and 81 applied
  migrations remained.
- The earlier disk/Docker failure is resolved chronology, not a blocker. The
  filesystem ended near 96% used with roughly 20 GiB free.
- The in-app Browser drove the signed-in operator inspection. Because it
  explicitly rejects file uploads, one focused local Chromium/Playwright
  computer-use run handled only the 17 UI uploads.
- A transient 32-byte credential-encryption key was supplied to the local dev
  process; it was not written to the repository or an environment file. The
  temporary organization credential row was removed through the UI after the
  read-only checks, leaving no ciphertext tied to that ephemeral key.

## Verification log

- Read-only Isometric readback: annual statement
  `ggs_1KX9BFSBSSBX4RGS` is `DRAFT`, contains exactly 12 entries, and all 12 are
  `REMOVAL` entries linked to it across December 2026–November 2027.
- Cold-start computer-use sweep: 28/28 static routes; zero crashes, hangs,
  console errors, failed requests, or HTTP errors. The three bounded cold-start
  findings were fixed and browser-checked where a current seeded state allowed.
- Method lifecycle: 1/1 passed with trace disabled; 9/30 locked, 30/30 unlock,
  declaration captured, then fresh Method A at 0/30.
- Evidence attachment: 1/1 passed; database proves 17/17 uploaded and managed.
- Source follow-up: browser shows 17 enabled managed-storage Mirror actions and
  two disabled `Re-upload required` legacy rows.
- Final browser diagnostic log: 100 entries, zero warnings or errors.
- Final focused Vitest: 9 files / 38 tests passed. Independent final security
  review exercised 11 files / 44 tests with no blocking finding.
- `pnpm typecheck` and `git diff --check` passed.
- Whole-repository `pnpm lint` exited 0 with no errors; it reports 43 existing
  warnings, including duplicates from `.claude/worktrees/pr-migration-gate`.
  Targeted lint on the changed code has zero errors and only the two unchanged
  `delivery-list.tsx` hook-dependency warnings (plus two ignored Markdown-file
  notices when docs are included on the command line).
