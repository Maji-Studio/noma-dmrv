# Open Questions

Living tracker of design questions, deferred work, and items waiting on
external confirmation. Add freely; resolve by removing the entry and
recording the decision in the relevant feature doc (e.g.
`docs/isometric/changes.md` or `docs/architecture.md`).

Each entry follows this shape:

- **Title** (`area/topic` or `phase`) — owner, opened YYYY-MM-DD
  - Question / decision needed
  - Why it matters / blocking what
  - What we'd need to resolve it (sandbox check, stakeholder ask, doc lookup)

## Isometric Certify integration

### Transport-leg compliance follow-ups (opened 2026-05-13)

- **Per-leg evidence model deferred** (`isometric/transport-v1.1-evidence`) —
  opened 2026-05-13, deferred to follow-up PR.
  - Isometric Transportation v1.1 §6 + Appendix 1 require: emission-factor
    source citation, factor vintage by mode (road ≤3 y, ship/air ≤5 y,
    rail/pipeline ≤7 y), round-trip vs. onward-leg evidence, distance-method
    fallback justification (§3.1 "appropriately evidenced"), weigh-scale
    calibration record, vehicle class/model year.
  - Current state: `transport_legs.emissionFactorSource` exists but is
    optional; no schema columns for factor vintage, round-trip flag, onward
    destination, or fallback evidence. Form text mentions §3.2 but
    validators do not enforce.
  - Resolve via: a dedicated PR with a Drizzle migration adding the
    columns, condition-registry rules, refreshed
    `docs/isometric/schema-mapping.md` rows 30–32, and three new entries
    on `docs/isometric/p0-compliance-checklist.md`
    (P0-16 method-hierarchy + fallback evidence, P0-17 per-leg
    round-trip default, P0-18 factor vintage by mode).

- **Per-leg vs aggregated submission strategy** (`isometric/transport-v1.1-aggregation`) —
  opened 2026-05-13, **interim resolution shipped 2026-05-13**.
  - Original plan: flip `INPUT_MAPPING` transport rows from
    `distance` (km) to `co2e` (kg) and submit summed per-leg emissions.
    Blocked because Certify's `transport` blueprint exposes
    `distance` / `mass` / `carbon_intensity` as separate inputs with
    `quantity_kind = "distance"`; the strict guard in
    `src/lib/isometric/transformers/datapoint.ts:201-211` rejects unit
    mismatches.
  - Interim: keep mass-weighted distance, but enforce per-category
    uniformity (same method, same emission factor, all legs have load
    mass) so Certify's server-side
    `distance × Σmass × factor = Σⱼ(distⱼ × massⱼ × factor)` holds —
    compliant with §5 within the current template shape. See
    `aggregateTransportLegs` in
    `src/lib/isometric/utils/aggregation.ts`.
  - True per-leg submission (each leg as its own Certify datapoint)
    is blocked on Isometric exposing a transport template input that
    accepts N>1 datapoints per leg category. Re-raise with Isometric
    support before any future work here.

- **No facility-membership model in codebase**
  (`auth/facility-scoping`) — opened 2026-05-13, parked.
  - The new `resolveEntityFacility` in
    `src/data-access/transport-legs.ts` walks the polymorphic parent
    chain back to a facility on every read/write, closing the
    orphan-mutation hole — but the codebase has no "user X may access
    facility Y" check anywhere (audited across `feedstocks`,
    `biochar-products`, `samples`, `deliveries`, `production-runs`).
  - Upgrade: when a facility-membership model lands, swap
    `resolveEntityFacility` for `requireFacilityAccess(userId, fac)` in
    `transport-legs.ts` (one chokepoint) and propagate the helper to
    the other data-access modules.
  - **2026-05-22 update (ADR 0003):** `src/data-access/certifier-removals.ts`
    joins this list — `getCertifierRemovalById`, `listRemovalsForFacility`,
    `getCreditBatchesByRemovalId`, `ensureRemovalForCreditBatch`,
    `assignCreditBatchToRemoval`, `updateRemovalDates` all guard with
    `requireAuth` only. The refactor widened the id-addressable surface
    (`submitRemovalAction` / `assignCreditBatchToRemovalAction` take a raw
    `removalId` from the client), so an authenticated user can submit or
    regroup any facility's removal by id — including driving an external
    Isometric POST. No regression vs. the deleted `submit-credit-batch.ts`
    (same posture), but **decision needed before a second facility operator
    is onboarded**: accept as single-tenant, or land the membership model
    and gate every removal accessor on the resolved facility.

- **Isometric MCP token-URL deprecated 2026-05-15** (`isometric/mcp-auth`) —
  opened 2026-05-13.
  - `https://api.isometric.com/mcp/?token=…` is removed 2026-05-15
    (2 days from 2026-05-13). Replacement: `https://api.isometric.com/mcp`
    with Certify/Registry account sign-in
    (https://docs.isometric.com/user-guides/ai/mcp-server). Dev-tooling
    only; no production code path affected.
  - Migration tracked separately; verify via
    `mcp__claude_ai_isometric__me` after switching.

> **Note:** ADR 0003 / ADR 0004 pre-deploy gates (legacy ledger cutover,
> destructive migration `0021`, wide id-addressable removal/GHG-statement
> surface, no-zero-stub-in-prod) live in
> `docs/isometric/integration-plan.md` → **Pre-deploy gates**. They are
> actions before deploy, not open questions.

### GHG Statement review follow-ups (opened 2026-05-22)

Findings from the Phase 4.5 GHG Statements review (ADR 0004). The
double-create dedup, the N+1 query batching and the non-atomic
`finalizeGhgStatement` were fixed in the same branch; the entries below
were deferred by the operator to a follow-up PR.

- **No route-level error boundary** (`certification/error-boundary`) —
  opened 2026-05-22, deferred.
  - There is no `error.tsx` anywhere under `src/app`. A thrown error in a
    Certification route (loader reject, server-fn throw not caught by
    `ActionResult`) renders a blank screen instead of a recoverable UI.
  - Resolve via: add `src/app/(app)/certification/error.tsx` with a retry
    affordance — a new convention for the project, so confirm placement
    (per-route-group vs a single app-level boundary) before landing.

- **Report-URL open-redirect / 2nd-party SSRF**
  (`certification/report-url-allowlist`) — opened 2026-05-22, deferred.
  - The operator-supplied GHG-statement report URL (`reportUrl` in
    `submitGhgStatementToVerifier`) is stored on a `documents` row and
    later served through the pre-existing `/api/documents/[id]` route,
    which 302-redirects to `fileUrl` with no host allowlist. A crafted
    URL turns the redirect into an open redirect / server-side fetch of
    an arbitrary host.
  - Pre-existing pattern — the `/api/documents/[id]` `fileUrl` branch
    predates this feature and is shared by every external/legacy URL
    column (see the `storage/phase-2` entry).
  - Resolve via: decide an allowlist policy (e.g. restrict to known
    object-storage / Isometric hosts) and enforce it at the
    `/api/documents/[id]` redirect, not per-caller.

- **Shared-component a11y gaps** (`forms/a11y-shared-layer`) — opened
  2026-05-22, deferred.
  - `FormField` / `FormError` (`src/components/forms/`) do not wire
    `aria-describedby` from input to error message; `useDialog`
    (`src/hooks/use-dialog.ts`) does not restore focus to the trigger on
    close. Surfaced by the GHG Statement dialogs but the gap is in the
    shared layer, so a fix touches every form and dialog in the app.
  - Resolve via: a dedicated a11y pass on the shared forms/dialog
    primitives with a regression check across existing consumers.

### Remaining template-coverage gaps

The Phase 3 / 3.6 / 3.7 template inspection found ~10 input coverage gaps;
all but the period-level ones are closed. The full breakdown is in
`docs/isometric/changes.md` (2026-05-11, 2026-05-13, 2026-05-21 entries).
Two items remain:

- **Pyrolyzer pre/post electricity readout** (`isometric/phase-3-readouts`)
  — opened 2026-05-13. `INPUT_MAPPING` under
  `pyrolysis / metered_energy_based_ci_emissions` synthesises
  `initial_readout = 0`, `final_readout = totalElectricityKwh`. The
  difference equals real consumption, which is the only quantity Certify
  uses downstream — verifier-acceptable today, but replace with real
  per-run pre/post readouts when `production_runs` gains the columns.
- **Period-level inputs zero-stubbed** — **resolved 2026-05-24** by
  [ADR 0005](../adr/0005-period-emissions-as-project-components.md).
  Period inputs no longer flow through `INPUT_MAPPING` at all; they're
  `PROJECT`-scope Components managed in the Isometric UI from a noma
  LCA-journal row. The "no template carrying these stubs in production"
  gate is replaced by integration-plan pre-deploy gate #4 (every
  category present in any used Removal Template must have a matching
  noma row AND a Project Component in Isometric).

- **`isometric/phase-3.7-period-inputs`** — opened 2026-05-21,
  **resolved 2026-05-24 by [ADR 0005](../adr/0005-period-emissions-as-project-components.md)**.
  - **Resolution:** the agenda's premise (client-side apportionment
    across GHG Statements) was invalidated by re-reading the Certify
    OpenAPI surface. Period-level emissions live as `PROJECT`-scope
    Components in Isometric; the
    `ProjectComponentAmortizationStrategy` enum
    (`ESTIMATED_PROJECT_TONNAGE / MANUAL / CUSTOM_TIME_PERIOD /
    ESTIMATED_PROJECT_LIFETIME`) handles per-statement and per-removal
    attribution server-side.
  - **Posture B** — noma is the LCA journal, not the publisher.
    `/admin/emission-estimates` carries the transcribed LCA values
    (per facility × LCA window × category) plus an FK to the source
    document; a read-only drift panel on `/certification/` flags rows
    missing from Isometric or Components missing from noma. The
    operator publishes Project Components in the Isometric UI.
  - **Allocation strategy default:** `CUSTOM_TIME_PERIOD` with
    `target_date = lca_window_end` surfaced as a copy-paste hint;
    per-category overrides are an admin-edit on each row.
  - **INPUT_MAPPING cleanup:** the five `zeroStub: true` families move
    to a new `PERIOD_INPUT_TUPLES` sentinel set; the scope-conflict
    `SafeError` names the canonical scope when a Removal Template
    declares a period-input component (see ADR 0005 §3).
  - Implementation tracked under integration-plan **Phase 3.7-period**
    row; status moves from `🔨 Designed` to `✅` when the admin
    surface, drift panel, sentinel set, and `SafeError` ship.

- **`isometric/mapping-version-dimension`** — opened 2026-05-24,
  **deferred**.
  - **Question:** when Isometric introduces blueprint versioning (e.g.
    `pyrolysis@v1` → `pyrolysis@v2` where `carbon_content` moves from
    `dimensionless` to `mass_fraction`), how should `INPUT_MAPPING`
    represent the version dimension — a 4-tuple
    `(group, blueprint, blueprintVersion, input)`, an
    `N`-entries-per-input branch-on-`compatible_unit` model, or
    something else?
  - **Why deferred:** the Certify OpenAPI surface today does not expose
    any `blueprint_version` field — verified by grep across
    `src/lib/isometric/generated/certify.d.ts`. There are no concrete
    versioning examples to model the table against, so any 4-tuple
    decision would be speculative. Submit-time guards
    (`datapoint.ts:394-404`) + the nightly coverage check (B1) catch
    type/unit mismatches; no near-term integrity risk.
  - **Resolve via:** re-read the OpenAPI on any spec bump; reopen this
    entry the first time Isometric ships a versioned blueprint. The
    decision then has a concrete example to anchor against.

- **`isometric/phase-3-fixed-constants`** — opened 2026-05-05, **bootstrap
  shipped 2026-05-13**.
  - The default sandbox templates have ~12 `type=fixed` constants without
    pre-bound datapoints. Phase 3's orchestrator bails with `SafeError`
    directing the admin to Isometric's template editor.
  - Resolved by the `noma-mvp` template authoring walkthrough
    (`docs/isometric/sandbox-template-authoring.md`, Step 3 —
    "Pre-bind fixed constants" / "Alternative — Bootstrap fixed constants")
    and the `bootstrap-fixed-constants` mode of
    `scripts/isometric-smoke.ts`. Operational follow-ups (replacing the
    `1.0` placeholder for sampling consumables; validating
    region-specific factors before production) tracked in the
    walkthrough's "Verifier-readiness" section.

### Phase 4 deferrals

- **Isometric webhook contract availability** (`isometric/phase-5`) — opened 2026-05-06
  - When will Isometric publish a webhook event schema, signature
    header, and HMAC algorithm we can verify against?
  - Why it matters: blocks any automated reconciliation of GHG-statement
    state. `certifierProjects.webhookSecret` exists in the schema, but
    Certify's OpenAPI declares `webhooks = Record<string, never>` and
    no webhook topic exists at `https://docs.isometric.com`. Today
    users rely on the manual "Refresh" button calling
    `refreshGhgStatementStatus` to reconcile. A receiver built today
    would be guessing payload shape, signature header name, and HMAC
    algorithm.
  - Resolve via: ask Isometric support directly; check
    `api-reference/` quarterly via the existing update playbook
    (`docs/isometric/update-playbook.md`). Once the contract is
    published, build `src/app/api/certification/webhook/route.ts`
    and add HMAC + reconciliation tests.

- **External GHG statement amendment claiming** (`isometric/phase-5`) - opened 2026-05-05
  - Detect when an admin edits GHG statement dates or attached Removals
    directly in Isometric and the registry creates a new statement-version
    draft that noma has not claimed.
  - Why: Phase 4 surfaces `pending_total_co2e_removed_kg` and supports
    resubmission against the known local row, but it does not compare the
    local `externalId` against the registry's current period draft on every
    refresh.
  - Resolve by adding a claim/reconcile flow for external statement-version
    drafts.

- **Hash-changed partial-orphan cleanup** (`isometric/phase-5`) - opened 2026-05-05
  - Reconcile or report Datapoints/Removals created by a failed attempt when
    local inputs changed before the retry, causing a new payload hash and new
    supplier refs.
  - Why: same-hash retries now reuse stored refs and reconcile before POST,
    but changed-hash retries intentionally create a fresh version. Any remote
    resource from the failed old hash can remain orphaned.
  - Resolve only if production traffic shows this failure mode often enough
    to justify per-Datapoint sub-ledger bookkeeping.

- **Source upload flow** (`isometric/phase-3.5`) — opened 2026-05-05,
  storage prerequisite resolved 2026-05-19
  - Storage prerequisite is now in place: see `docs/storage.md` and the
    `useFileUpload` hook (`src/hooks/use-file-upload.ts`). The same
    request → PUT → confirm orchestration can be pointed at Isometric's
    `/sources/{id}/signed_upload_url` instead of our own `requestUpload`
    server action.
  - Remaining work: wire `certifierDocumentUploads` table writes, plumb
    `source_ids` into Datapoint payloads, and add the UI hook for
    selecting which existing noma documents to upload as Isometric
    sources.

- **Per-column upload-URL field migration** (`storage/phase-2`) — opened 2026-05-19
  - `production.plc_data_file_url`, `samples.r0_histogram_file_url`,
    `samples.tga_thermogram_file_url`, `production_samples.photo_url`,
    `feedstock.registry_url`, `emissions.source_url` are still plain
    text columns. Phase 2 plan: add a `*_document_id` FK alongside each,
    backfill via UI, drop the URL column.
  - Why: route all uploaded evidence through the single `documents`
    table (one audit trail, one storage-key convention, one
    visibility/ACL model).
  - Not urgent; existing URL fields keep working as external/legacy
    links via the `/api/documents/[id]` proxy route's fileUrl branch.

- **Per-Datapoint ledger sub-rows** (`isometric/phase-4`) — opened 2026-05-05
  - Add `submissionType='datapoint'` rows in `certification_submissions`
    so a re-submit short-circuits successfully-POSTed datapoints from a
    prior failed attempt.
  - Why: Phase 3 leaks orphan datapoints in Certify on partial-failure
    re-submits. The leaked rows have no Removal reference; they're
    cosmetic clutter, but not silent data quality issues.
  - Resolve only if partial-failure rates rise; the bookkeeping cost is
    real and not worth it for one-off recoveries.

- **PATCH `/removals` vs supersede-and-create** (`isometric/phase-4`) — opened 2026-05-05
  - Phase 3 always creates a new versioned remote Removal on payload
    changes (the supersede path). If Certify supports in-place PATCH for
    selected fields and verifier UX prefers it, branch 3e gains a PATCH
    path.
  - Why: more accurate audit trail when only metadata changes (no v=2
    Removal flooding the registry UI).
  - Resolve via reading Certify's PATCH docs and confirming with their
    team which fields are mutable post-creation.

- **`LIST` data-shape inputs receiving multiple datapoints** (`isometric/phase-4`)
  — opened 2026-05-05
  - `CreateComponentListInput.datapoint_ids[]` accepts N IDs, but Phase 3
    aggregation collapses N runs into a single value, so list inputs
    receive a one-element array. If a verifier asks for per-run datapoints,
    the aggregation step changes shape.
  - Why: today's protocol-level UX is "one credit batch = one Removal"
    with aggregated values; per-run is overkill but may be required for
    some templates.
  - Resolve only when a template surfaces that needs per-run breakdown.

## Documentation hygiene

### Review feedback parked for future PRs (opened 2026-05-19)

- **`docs/isometric/changes.md` archival split** (`docs/changelog-archival`) —
  opened 2026-05-19, **deferred**.
  - Review suggested moving dated implementation-history sections (e.g.,
    2026-05-11 Phase 3.6 foundation, 2026-05-07 env/dialog refactor) out of
    `docs/isometric/changes.md` into `docs/archive/` and leaving only an
    evergreen status pointer in the original file.
  - Why parked: `changes.md` is documented in `CLAUDE.md` and
    `docs/isometric/README.md` as the project's local changelog. A
    changelog is dated by construction; splitting every entry into
    `docs/archive/` would defeat its discoverability without changing
    information density.
  - Resolve via: agree on a retention policy first (e.g., "entries older
    than 6 months move to `docs/archive/isometric-changes-<year>.md`"),
    then execute the cut in one PR rather than ad-hoc per review.

- **`docs/open-questions.md` dated-section extraction** (`docs/open-questions-format`) —
  opened 2026-05-19, **deferred**.
  - Review suggested moving "Pre-coding gates (status as of 2026-05-11)"
    and "Phase 3 blockers found in template inspection" into
    `docs/archive/` because they read as implementation logs.
  - Why parked: the file's documented entry shape (top of file) is
    `Title (area/topic) — owner, opened YYYY-MM-DD`. Dates are part of
    the contract, and the "Phase 3 blockers" entries are still partly
    open (sandbox zero stubs, electricity-readout schema work). They
    will leave this file when resolved, not when stale.
  - Resolve via: a dedicated pass that closes the still-open
    sub-entries (electricity readout, per-run GHG concentration,
    fuel-volume capture) so the parent gate can be removed.

- **`docs/isometric/README.md` and `sandbox-template-authoring.md` phase
  language** (`docs/evergreen-language`) — opened 2026-05-19, **deferred**.
  - Review flagged phase- or date-specific phrasing in the README index
    entry for `sandbox-template-authoring.md` and elsewhere.
  - Why parked low-priority: the phase references describe what the
    walkthrough *unblocks*, which remains accurate. Rephrasing is
    cosmetic; bundle with the next substantive update to the
    walkthrough (e.g., once a noma-mvp template ships and the doc is
    rewritten to reflect lived experience).

- **`env-banner.tsx` style-constant extraction** (`code/env-banner-style-consts`) —
  opened 2026-05-19, **deferred**.
  - Review suggested extracting padding (`px-12 py-8` / `px-16 py-12`)
    and icon-size (`16` / `20`) literals into named constants.
  - Why parked: only two call sites duplicate each literal, and the
    inline ternary makes the inline/page divergence immediately
    visible. Per `CLAUDE.md` ("Don't add abstractions beyond what the
    task requires"), this is below the threshold for extraction.
    Revisit if a third variant is added.
