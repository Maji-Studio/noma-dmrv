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

- **Isometric MCP token-URL deprecated 2026-05-15** (`isometric/mcp-auth`) —
  opened 2026-05-13.
  - `https://api.isometric.com/mcp/?token=…` is removed 2026-05-15
    (2 days from 2026-05-13). Replacement: `https://api.isometric.com/mcp`
    with Certify/Registry account sign-in
    (https://docs.isometric.com/user-guides/ai/mcp-server). Dev-tooling
    only; no production code path affected.
  - Migration tracked separately; verify via
    `mcp__claude_ai_isometric__me` after switching.

### Pre-coding gates (status as of 2026-05-11)

- **Live-template `INPUT_MAPPING` coverage** (`isometric/phase-3`) — opened
  2026-05-05, **resolution path chosen** (Phase 3.6).
  - Resolution path: author a noma-tailored `noma-mvp` Removal Template in
    the sandbox Registry UI (walkthrough at
    `docs/isometric/sandbox-template-authoring.md`). Phase 3.6 foundation
    landed 2026-05-11 — `INPUT_MAPPING` refactored to three-level
    `(group, blueprint, input)`, transport-leg aggregation utilities added,
    smoke script updated. Once the template ships, the transport portion of
    `phase-3-input-coverage` and all of `phase-3-fixed-constants` close.

### Phase 3 blockers found in template inspection

- **`isometric/phase-3-input-coverage`** — opened 2026-05-05, **transport
  portion closed 2026-05-13**. Status now:
  - `distance` (km) — used by 3 transport components (biomass→processing,
    biochar→storage, sample→lab). **Closed 2026-05-13.** Phase 3.6
    completion shipped polymorphic transport-leg CRUD (data-access,
    schemas, server actions, hooks), `<TransportLegsPanel>` mounted on
    delivery / sample / feedstock side sheets, shared
    `collectTransportEntityIds` lineage walker, `submitCreditBatch`
    wiring via `enrichWithTransportLegs`, and a pre-flight transport-
    coverage checklist on `<CertifyPanel>` that gates the Submit button.
    Staff travel intentionally omitted from the MVP template (no
    corresponding noma entity).
  - `final_readout` / `initial_readout` (kWh) — pyrolyzer electricity
    meter pre/post readings. noma stores `production_runs.electricityKwh`
    as a delta only; pre/post readouts are not captured. **Interim
    synthesis shipped 2026-05-13** (see `INPUT_MAPPING` under
    `pyrolysis / metered_energy_based_ci_emissions` in
    `src/lib/isometric/transformers/datapoint.ts`):
    `initial_readout = 0`, `final_readout = totalElectricityKwh`. The
    difference equals the real consumption, which is the only quantity
    Certify uses downstream. Replace with real per-run pre/post readouts
    when the `production_runs` schema gains the columns.
  - `concentration` (mg/kg) + `mass_flow` (kg) — pyrolyzer GHG direct
    emissions (CH4, CO). noma has `credit_batches.ch4Ppm` /
    `ch4CompositionPercent` but at credit-batch level, not run level.
    Unit-shape mismatch (concentration is mg/kg; ppm is by mass at trace
    level). **Sandbox zero stub shipped 2026-05-13** in `INPUT_MAPPING`
    under `direct-emissions / ghg_direct_emissions` — emits 0 with the
    correct quantity_kind so end-to-end sandbox submission proceeds. Must
    be replaced with a real per-run source before the template moves to
    production. Tracked under `isometric/sandbox-zero-stubs`.
  - `biochar-storage / fuel_usage_by_volume / volume_of_fuel` (L) —
    biochar application via tractor. noma has `applications` rows but no
    per-application fuel volume. **Sandbox zero stub shipped 2026-05-13.**
  - `sampling-required-for-mrv / grid_electricity_use / electricity_use`
    (kWh) — lab analysis electricity. noma does not capture lab-side
    electricity. **Sandbox zero stub shipped 2026-05-13.**
  - `staff-travel / distance_based_ci_emissions / distance` (km) — noma
    has no staff-travel entity. **Sandbox zero stub shipped 2026-05-13.**

- **`isometric/sandbox-zero-stubs`** — opened 2026-05-13, **expanded
  2026-05-21**, blocked on data-model gaps above.
  - `INPUT_MAPPING` in `src/lib/isometric/transformers/datapoint.ts`
    now emits `0` for **12 monitored inputs** that noma cannot yet
    source. Original 5: CH4 concentration / mass_flow, CO concentration /
    mass_flow, biochar-storage fuel volume, lab electricity,
    staff-travel distance. Plus 7 added 2026-05-21 for the granular
    **Dark Earth Carbon Template** (`rvt_1KS4S43VPSBXA26X`):
    biomass-processing metered electricity (initial + final readout),
    biomass / pyrolysis / biochar diesel-genset energy (×3), sample
    transport mass-distance, miscellaneous mass.
  - Quantity_kind is still enforced against the blueprint, so schema
    drift will still surface. Replace each with a real source as the
    corresponding schema gap closes; do NOT promote the active template
    to a production project while any zero stub is in use.
  - **The full field-by-field replacement spec is now
    `docs/isometric/integration-plan.md` → Phase 3.7.** This entry
    resolves (and is deleted) when Phase 3.7 closes the last stub.

- **`isometric/phase-3-fixed-constants`** — opened 2026-05-05, **resolution
  path documented 2026-05-11**.
  - The default sandbox templates (`Protocol default`,
    `Dark Earth removal template`) have ~12 `type=fixed` constants without
    pre-bound datapoints. Phase 3's orchestrator bails with `SafeError`
    directing the admin to Isometric's template editor.
  - Why: constants are policy-level decisions (which emission factor to
    use for which fuel, which IPCC GWP value to use) — Isometric maintains
    these via supplier-managed Datapoints bound to the template, not
    noma-managed values. Phase 3 explicitly does not auto-create them.
  - Resolve via the `noma-mvp` template authoring walkthrough
    (`docs/isometric/sandbox-template-authoring.md`, Step 3 —
    "Pre-bind fixed constants"). MVP scope = 3 `carbon_intensity`
    bindings (one per transport leg) using DEFRA/IPCC defaults.

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

### Sandbox Removal Template lacks pre-bound fixed constant

- **`isometric/sandbox-template-binding`** — **resolved 2026-05-13**.
  Bootstrap script + walkthrough shipped; see
  `docs/isometric/changes.md` (2026-05-13 Dark Earth bootstrap entry)
  and `docs/isometric/sandbox-template-authoring.md` →
  "Alternative — Bootstrap fixed constants". Operational follow-ups
  (sampling-consumables value research, production gate) tracked in
  `docs/isometric/next-steps.md`.

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

- **`docs/isometric/integration-plan.md` snapshot history** (`docs/plan-snapshots`) —
  opened 2026-05-19, **deferred**.
  - Review suggested extracting historical "Status snapshot" blocks into
    a separate archive doc and keeping only the current snapshot inline.
  - Why parked: the file currently contains a single status snapshot
    (2026-05-13) followed by per-phase status — there is no historical
    snapshot to extract yet. Re-raise when the next snapshot lands so
    the prior one can be archived in the same PR.

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
