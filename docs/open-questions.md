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

- **`isometric/phase-3-input-coverage`** — opened 2026-05-05, **partial
  progress 2026-05-11**.
  - Original 20–21 monitored inputs without `INPUT_MAPPING` entries, split
    into three categories. Status now:
    - `distance` (km) — used by 4 transport components (biomass→processing,
      biochar→storage, sample→lab, staff travel). noma has per-leg
      `distance_km` on `transport_legs`. **Foundation landed 2026-05-11:**
      `aggregateTransportLegs` + `enrichWithTransportLegs` helpers (mass-
      weighted average), plus three new fields on `AggregatedProductionData`
      (`feedstockTransportAvgDistanceKm`, `biocharTransportAvgDistanceKm`,
      `sampleTransportAvgDistanceKm`). Staff travel intentionally omitted
      from the MVP template. **Still pending:** polymorphic
      `<TransportLegForm entityType entityId>` + data-access generalization
      (`getTransportLegsForEntity`) + 3 mount points (delivery,
      feedstock-delivery, sample) + pre-flight transport-coverage checklist
      on `<CertifyPanel>`.
    - `final_readout` / `initial_readout` (kWh) — pyrolyzer electricity
      meter pre/post readings. noma stores `production_runs.electricityKwh`
      as a delta only; pre/post readouts are not captured. **Still
      deferred:** out of scope for Phase 3.6; needs schema work
      (add columns or synthesize).
    - `concentration` (mg/kg) + `mass_flow` (kg) — pyrolyzer GHG direct
      emissions (CH4, CO). noma has `credit_batches.ch4Ppm` /
      `ch4CompositionPercent` but at credit-batch level, not run level.
      Unit-shape mismatch (concentration is mg/kg; ppm is by mass at trace
      level). **Still deferred:** needs per-run GHG-concentration schema
      work; out of scope for Phase 3.6.
  - Resolve fully: ship the Phase 3.6 transport-leg UI + checklist (now
    on the next-up list), then revisit electricity-readout and per-run-GHG
    when a tailored sandbox template needs those components.

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

- **Source upload flow** (`isometric/phase-3.5`) — opened 2026-05-05
  - Implement the presigned-URL flow against whatever document-storage we
    land on. Until then, `certifierDocumentUploads` stays empty and
    `source_ids: []` on every Datapoint.
  - Why: Removals without Sources can be created in sandbox but verifiers
    will require source-of-truth attachments before Phase 4's GHG
    statement step.
  - Resolve once the noma documents subsystem has a real S3-equivalent
    backend (currently a mockup per `docs/forms.md`).

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

## (other areas added as they appear)
