# Isometric integration trust fixes — phased plan (2026-07-24)

Status: planned, not started. Source: E2E retry report (codex, 2026-07-24) +
full code/DB/live-API investigation the same day. This file is the handoff —
a fresh session can execute from here without re-investigating.

## Confirmed findings (evidence, verified — do not re-derive)

All registry values below were confirmed via **live read-only GETs** against
`https://api.sandbox.isometric.com/mrv/v0` using the creds in `.env.local`
(headers: `X-Client-Secret` + `Authorization: Bearer`).

### F1 — Sequestration inputs have NEVER bound (root cause of both quantity P0s)

- The submitted payload snapshot (`certification_submissions.payload_snapshot`
  for `rmv_1KY9ATVT1SBXSQ71`) contains 22 inputs across 10 components — **all
  emissions**. Zero sequestration component references.
- By design: `resolveTemplateInputs`
  (`src/fn/certification/removal-submission-build.ts:296`) and
  `buildCreateGhgEntryRequest` (`src/lib/isometric/transformers/ghg-entry.ts:52`)
  skip every `biochar_sequestration_*` component. Sequestration values ride a
  separate `POST /measurement_samples` (`build1000YearSequestrationSample`,
  `src/lib/isometric/transformers/measurement-sample.ts:434`) keyed only by
  `supplier_reference_id`, with `production_batch_id: null` and **no
  datapoint→component binding**. This "registry auto-links by type/property"
  assumption was a documented open question
  (`docs/open-questions-isometric.md` → "Datapoint↔component-input binding —
  needs-registry-check") behind `DURABILITY_MEASUREMENT_SAMPLES_LIVE`
  (`true` in `.env.local`). It is wrong or insufficient.
- **Every sandbox 1000-year removal ever submitted is net-negative on the
  registry** (emissions-only):
  - `rmv_1KX6ZF4FMSBX359V` (2026-07-10 QA run, reported "+135 kg"): **−135.42 kg**
  - `rmv_1KY9ATVT1SBXSQ71` (CB-26-002): **−335.16 kg** (before-discount −332.78, sd 2.38)
  - `rmv_1KY9BF9EXSBX2PHN` (CB-26-001): **−494.71 kg**
- The `GET /ghg_entries/{id}` response does NOT expose components; component
  detail ("Missing inputs") is visible in the Certify UI only.

### F2 — Local card strips signs and fakes verification

- `formatCo2e` (`src/lib/format-utils.ts:109`) renders `Math.abs(kg)` unsigned.
  The observed card "333 / −2 / 335" is exactly abs(−332.78) /
  `max(0, −332.78 − (−335.16)) = 2.38` / abs(−335.16). No arithmetic bug; the
  clamp (`src/lib/certification/removal-breakdown.ts:146`) hides the sign
  anomaly instead of surfacing it.
- Values are fetched **live** per sheet-open (`loadRemovalBreakdown` →
  `getGhgEntry`, React Query staleTime 30s) — not stale, not cached.
- "Registry-verified" (`carbon-breakdown.tsx:189` `Eyebrow`) is gated purely on
  "a GHG entry was fetched". The response field `ghg_statement_id` (null =
  draft, per `certify.d.ts:2618`) is **never read anywhere** in the codebase.
- No tests exist for `carbon-breakdown.tsx` at all.

### F3 — Both removals ARE submitted; the codex "read-only" run mutated state

`certification_submissions` + `certifier_sync_events` show two complete
submission runs today: 05:51 (CB-26-002) and 06:02 (CB-26-001 →
`rmv_1KY9BF9EXSBX2PHN`). The codex report claimed CB-26-001 was left
"Ready to submit". Both registry entries are attached to draft statement
`ggs_1KS87XVZRSBXW62V` (23–31 May, auto-linked server-side by date range).
Treat codex-computer-use "read-only" claims as unverified.

### F4 — Evidence "Re-upload required" is correct behavior; seed data is the defect

All 15 blocked documents are seed rows (`de000000…`, created 2026-07-23) with
`storage_provider/storage_key/checksum_sha256 = NULL` — metadata-only, no
bytes. UI gate: `sources-panel.tsx:154` (`isMirrorable = !!document.storageKey`);
same check server-side (`src/fn/certification/sources.ts:496`). The two
generated transport ledgers mirror fine (server-side `putObject` + inline
auto-mirror on submit, `evidence-ledger-core.ts:278`).

### F5 — Readiness provably ignores evidence

`deriveRemovalReadiness` (`src/lib/certification/readiness.ts:161`) checks
mapping/credentials/template/transport/production/entityReadiness/durability.
No sources/evidence key exists in `RemovalRequirementKey` or
`CertRequirementKey`. "All preconditions met" with 0/9 mirrored is working as
coded.

### F6 — GHG statement sync gaps (narrower than reported)

- Create flow DOES pre-check the registry for an exact `(project, end_on)`
  DRAFT and adopts it (`findDraftGhgStatementsByPeriod`,
  `src/fn/certification/ghg-statements.ts:275`). Creating with end 31 May
  would have reconciled `ggs_1KS87XVZRSBXW62V`, not duplicated.
- Real gaps: (a) nothing discovers remote statements outside a create attempt —
  the local list (`loadGhgStatementsForFacility`) is a pure local read, so the
  remote statement (predates the last `db:reset`) is invisible; (b) the match
  misses non-DRAFT statuses and off-by-a-day `end_on`; (c) the wizard's
  period/preview steps are blind to remote state until "Create" is clicked.
- Removal submission cannot attach to a statement (no such field in
  `CreateGhgEntryRequest`); Isometric links by date range at statement
  create/refresh. The "15–28 May" window is the removal's own §8.6.2
  started/completed window — unrelated to the statement period.

### F7 — Ledger PDF bytes are valid; preview issue unresolved

Local `.storage/...676f79db….pdf`: valid `%PDF-1.3`, 2 pages, embedded subset
fonts (DM Sans/DM Mono), `%%EOF`, SHA-256 matches the checksum recorded in
`certifier_document_uploads.metadata`. Blank/black preview is most plausibly
Isometric's previewer and/or the near-black header band
(`evidence-ledger/pdf.ts` `C.ink` fills). Needs byte-compare of the registry
copy.

### F8 — Protocol version drift unproven

`GET /ghg_statements/ggs_1KS87XVZRSBXW62V` → `protocol_version: null`,
`protocol: null`. The "v1.1" seen in the Certify UI is presumably
project-level. Locally: `certifier_projects.protocolVersion` is stored but
never read by the pipeline; `docs/isometric/versions.json` pins 1.2; ADR 0017
reportedly cites 1.3. Hygiene audit needed; NOT the cause of F1.

---

## Phases

Ordering: Phase 1 before Phase 2 so Phase 2's sandbox verification can be
trusted from the app UI. Phases 3–5 are independent of each other.
Each phase = its own branch + PR to `staging`, with lint + typecheck + tests.

### Phase 1 — Fail-closed carbon accounting display (P0, small)

Goal: the card can never present a net-negative or draft entry as a positive
verified removal.

1. `formatCo2e` (`src/lib/format-utils.ts`): render true sign (or add a
   `signed` requirement at these call sites). Audit all call sites of
   `formatCo2e` for abs() assumptions.
2. `computeRemovalBreakdown` (`src/lib/certification/removal-breakdown.ts`):
   remove the silent `max(0, …)` clamp semantics — keep the clamp for the
   discount row if desired, but emit an explicit `anomaly` flag when
   `netRemovedKg < 0`, when `netRemovedKg > netBeforeDiscountKg`, or when the
   sequestration contribution is 0/absent. Card renders a prominent failure
   state (red, "Registry reports net emissions — sequestration inputs missing")
   instead of the normal ledger.
3. `Eyebrow` / verified label (`carbon-breakdown.tsx`): plumb
   `ghgEntry.ghg_statement_id` + (where cheap) statement status through
   `loadRemovalBreakdown`; label becomes "Registry draft — unverified" unless
   the statement is past verification. Fail closed: unknown → "unverified".
4. Tests (new `carbon-breakdown.test.tsx` + extend
   `removal-breakdown.test.ts`): sign rendering, anomaly states, label gating
   (draft vs verified vs estimate). Read `docs/testing.md` + `docs/forms.md`
   first per repo rules.

Acceptance: with current sandbox data, CB-26-002's card shows a negative net +
anomaly warning + "draft — unverified"; no test regressions.

### Phase 2 — Bind sequestration inputs (P0, the core fix)

Goal: a fresh sandbox removal computes a positive net with a non-zero
1,000-year sequestration component.

1. Empirical confirm FIRST (the step that was skipped):
   `pnpm tsx scripts/isometric-smoke.ts inspect-template <prj_1K9YJ33RKSBX9FFF>`
   — record the sequestration component's `rtcId`, its inputs
   (`carbon_contents`, `s_fraction`, `product_mass`), types (LIST/SCALAR),
   units, and whether inputs are `monitored`. Note: the script flags
   sequestration inputs as "NOT covered by INPUT_MAPPING" — expected noise.
   Also check the measurement-sample POST response schema for
   `values[].datapoint_id` (the plan doc
   `docs/plans/2026-06-19-tier1-durability-live-wiring.md` "Two deltas" section
   sketches exactly this pivot). Consult the Isometric MCP (`how_to`, docs on
   datapoint sharing) for the binding contract.
2. Implement explicit binding (expected outcome): capture
   `values[].datapoint_id` from each measurement-sample response →
   `datapointIdsByRtcInput` → stop skipping sequestration components in
   `buildCreateGhgEntryRequest` (bind LIST inputs; keep the
   `resolveTemplateInputs` skip so INPUT_MAPPING stays clean). Decide whether
   `production_batch_id` should be populated (currently always null).
   If inspect-template instead proves auto-link with a missing precondition,
   fix that precondition; either way delete the wrong assumption from
   `docs/open-questions-isometric.md` and update `docs/isometric/changes.md`.
3. The payload hash/semantic snapshot (`payload-hash.ts`, `MAPPING_REVISION`)
   must incorporate the new binding so resubmission versioning works.
4. Verify with a FRESH removal in sandbox (do not resubmit the three junk
   ones). Check via raw API that `co2e_net_removed_kg` > 0. Then run Isometric
   data checks on the statement side.
5. Regression tests: transformer-level (ghg-entry body includes sequestration
   component with datapoint ids) + registry-boundary test per
   `tests/registry-boundary-removal.test.ts` patterns.

Sandbox hygiene: existing junk (3 removals, ≥2 statements) stays; new
verification uses fresh entities. `db:reset` locally is fine (no production).

### Phase 3 — Remote GHG-statement discovery/reconciliation (P1)

1. Add a registry-list reconcile: fetch `/ghg_statements` for the project and
   upsert into `certifier_ghg_statements` + membership
   (`reconcileRemovalMembership`) — either on statements-page load
   (server-side, best-effort) or an explicit "Sync from registry" action.
   Reuse `applyGhgRemoteState`. Never steal membership (existing invariant).
2. Widen create-time matching: consider all statuses (refuse with actionable
   message when non-DRAFT exists for the period) and surface remote statements
   in the wizard's period step BEFORE the create click.
3. Tests: registry-boundary test for "remote statement exists, zero local rows"
   (the exact post-`db:reset` state observed today).

### Phase 4 — Readiness semantics + evidence UX (P1)

1. Add an evidence key to `RemovalRequirementKey`/`CertRequirementKey` and the
   three checklists: show "N of M supporting documents mirrored". Decision
   needed (ask user if not settled): blocking vs advisory. Default: advisory
   warning, NOT a blocker (mirroring is legitimately optional per current
   product intent — but it must be visible, never "all preconditions met").
2. Mount `SyncEventLog` (exists, statement-sheet-only today) on the removal
   detail sheet so mirror/upload failures are inspectable.
3. Fix seed fixtures: give seeded documents real PDF bytes + storage triple +
   checksum so demos exercise the real mirror path (small generated PDFs are
   fine; keep them clearly synthetic).

### Phase 5 — Closeout: PDF preview + protocol-version audit (P1/P2)

1. Download the registry's copy of a mirrored ledger (Certify UI or source
   download URL), byte-compare against local. If identical → previewer-side;
   try a light-background variant of the ledger header to test the dark-band
   hypothesis before blaming Isometric; report via Isometric MCP
   `submit_feedback` if their previewer is at fault.
2. Protocol versions: determine the sandbox project's actual protocol version
   (Certify UI/API); reconcile `versions.json` (1.2) vs ADR 0017 (1.3) vs
   project (UI showed "v1.1"); make the pipeline read/validate
   `certifier_projects.protocolVersion` at submit time or delete the dead
   column; follow `docs/isometric/update-playbook.md` if a bump is needed.
3. Final acceptance: fresh codex E2E retry. Expected pass bar: positive
   consistent net local+registry, statement data checks clean, evidence
   visible/mirrored, submit reachable up to the known "No verifier is assigned
   to this project" sandbox limit (that block is environmental, not ours).

## Open decisions for the user

- Phase 4.1: evidence mirroring — blocking precondition or advisory? (Plan
  assumes advisory.)
- Whether to keep `DURABILITY_MEASUREMENT_SAMPLES_LIVE=true` locally during
  Phase 2 (yes, needed for sandbox verification; stays sandbox-gated).
- Sandbox junk cleanup: leave as-is (assumed) or attempt deletion via Certify UI.
