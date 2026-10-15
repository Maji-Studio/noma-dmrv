# Open Questions

**What this covers:** every deferred decision, known-but-unfixed defect, and question waiting on an external party (Isometric, a stakeholder, an operator sandbox run). **When to read it:** before starting work in an area, to find out what is deliberately unbuilt there and why, and before "fixing" something that looks broken, because it may be a recorded decision.

Two rules bind this file:

1. **An entry leaves only when the issue is provably resolved**, not when it goes stale. Record the resolution in the owning doc (an ADR under [`docs/adr/`](./adr/), [`docs/isometric/changes.md`](./isometric/changes.md), or the relevant feature doc) and delete the entry.
2. **Every claim carries a code pointer**, a module path, not a line number (line numbers rot). If you can't point at the code, the claim isn't verifiable and doesn't belong here.

Deferred work lives here, never as a `TODO` in code.

**Anchor every entry on a `file:symbol` it depends on.** This file's recurring failure mode is entries whose code was renamed or deleted underneath them (`safeAppendSyncEvent`, `deleteDocumentsForEntity`, `insertDraftSubmissionWithMappingLockAndLocks`, all gone, all still cited here for weeks). A named symbol makes a rename break the entry visibly under grep; prose alone rots silently.

**`needs-registry-check`** marks a question that must be answered by the Isometric MCP server (`how_to`, then the protocol/OpenAPI tools) or a sandbox probe, **never** from `docs/isometric/*`, which are non-authoritative local summaries. Do not close one of these from a local doc.

## Activity recording gaps (`activity/deferred-writers`) - **deferred**

- `src/data-access/certifier-removals.ts:updateRemovalDates` changes Removal dates
  without an event. Define value-free lifecycle events alongside the existing
  registry status events.
- `src/data-access/production-runs/delete.ts:deleteProductionRun` still uses the
  legacy deletion path without a run event. Route it through the operation runner
  or record on its own transaction; preserve document retirement events.

## DataTable mobile cards (`ui/data-table`) - **deferred**

- `src/components/ui/data-table/index.tsx:DataTable` renders each mobile card as
  a `role="button"` container that holds nested buttons (the Removals list
  Retry button, and now `CertificationStatusBadge`), which screen readers
  announce unreliably. Fix: a semantic card with a separate record-opening
  button or link beside its controls. It changes every DataTable consumer.

## Invariants an LLM must not violate

Short, load-bearing rules that this file's entries assume. Each is enforced in
code today; breaking one compiles cleanly and fails silently.

- **Data-access guard contract.** Every `src/data-access/` function takes
  `ctx: OrgContext` as its first argument, calls `requireOrgScope(ctx)`, and
  filters every query on `eq(table.organizationId, ctx.organizationId)`.
  Cross-entity references go through `assertSameOrg(ctx, table, id, executor)`.
  `src/data-access/utils.ts` is the source of truth; `requireAuth()` is an
  **auth**-layer helper (`src/lib/auth/server.ts`) and does not belong in
  data-access modules. Writing a new accessor with `requireAuth()` and no org
  filter silently leaks across organizations. See
  [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md) and
  [`docs/organization.md`](./organization.md). Intentional cross-org reads are
  marked with an `// org-scope-ok:` comment (e.g. `getPublicDocumentById`).
- **`assertSameOrg`'s `executor` is a pool-starvation invariant, not an
  optimization.** A caller inside a transaction MUST pass its `tx`; reading
  through the global pool from inside an open transaction holds one connection
  while waiting for another, and starves the pool under parallel load. The
  effective pool size really is 1: `resolveAppPoolConfig`
  (`src/db/pool-config.ts`) falls back to `DEFAULT_DB_POOL_MAX` and
  `DB_POOL_MAX` is unset in every environment. The Source mirror hit this
  through its audit writes and is fixed (2026-09-16 entry in
  [`isometric/changes.md`](./isometric/changes.md)); where an
  executor cannot be threaded through, stage the work and flush it after the
  transaction settles (`src/fn/certification/sync-event-stage.ts`). Applies to
  every tx-scoped read, not just this helper.
- **Every transport leg counts its round trip, and the ×2 is credit-bearing.**
  `ROUND_TRIP_DISTANCE_FACTOR` (`src/lib/calculations/round-trip.ts`; used by
  `src/lib/isometric/utils/aggregation.ts` and
  `src/lib/certification/evidence-ledger/build-model.ts`) doubles each leg's
  stored one-way distance (Transportation v1.1 §5: the vehicle returns empty,
  so the full round trip counts; issue #852 removed the One-way option).
  Removing the multiplier halves submitted transport emissions in the
  **anti-conservative** direction — the same integrity class as the
  `pyrolyzer_direct` zero-stub trap below. An evidenced onward-journey
  exception is out of scope until a real case needs it.
- **`sReflectanceFraction` is stored 0–1 but captured as a percentage.** The
  form converts on entry and clears the field on a durability-mode switch
  (`src/components/samples/sample-form.tsx`). It is optional at save and
  required at submission for sampled 1,000-year credit batches by the replicate
  gate (`evaluateSampled1000YearReplicates` in
  `src/lib/certification/durability-1000-replicates.ts`, called by
  `src/fn/certification/durability-readiness.ts`). Dropping the percentage-to-fraction
  conversion puts a 100× error into a credit-bearing input.

## Schema

### Order quantity loses gram precision at large masses (`orders/quantity-real-column`, opened 2026-10-14)

- **Anchor:** `src/db/schema/logistics.ts:orders.quantityKg`.
- `orders.quantity_kg` is `real` and cannot preserve 0.001 kg steps above about
  16,777 kg. The API publishes the stored value.
- **Resolve via:** Kenji decides whether to migrate the column to an exact
  numeric mass type, with tests for large quantities at 0.001 kg steps.

### Dropped protocol-stub tables — re-add when each feature is built (opened 2026-06-08)

Removed in migration `drizzle/0037_sour_lethal_legion.sql`. These were scaffolded
ahead of implementation — defined but never queried or seeded. Dropped to keep
the schema honest (no prod data, so re-adding is cheap). Recover column
definitions from git history (schema files just before `0037`).

- **`loss_records`** — Biochar Protocol §8.4.2 loss accounting (residue /
  spillage / runoff / volatilization / transport_loss adjusting batch CO₂e).
  Re-add when mass-loss accounting enters credit math.
- **`reversal_risk_assessments`** — Appendix I reversal risk → buffer-pool %.
  Also dropped `credit_batches.reversal_risk_assessment_id` and the
  `land_tenure_type` / `soil_erosion_risk` / `climate_volatility_risk` /
  `natural_disaster_risk` / `operator_track_record` enums. The registry owns the risk score and buffer contribution.
- **`ghg_materiality_assessments`** — SSR-emissions-vs-net-removals materiality
  (<1%) per credit batch.
- **`feedstock_sc_assessments`** — per-feedstock sustainability-criteria
  pass/fail/conditional records with evidence docs.
- **`custody_handoffs`** — chain-of-custody ledger. Redundant with the *built*
  chain-of-custody, which derives lineage from FK relationships
  (`src/data-access/chain-of-custody.ts`, [`docs/traceability.md`](./traceability.md)),
  not a ledger. Re-add only if an explicit handoff ledger is actually needed.
- **`certifier_sources`** — Isometric Source definitions;
  `certification_submissions.source_id` dropped with it. Re-add when submission
  Sources are tracked locally rather than derived at submit time.
- **`emission_factors`** — region/fuel EF configuration. The Isometric component
  holds EFs today; re-add only if EFs move in-house.
- **`production_runs.emission_factors_used`** (column) — JSONB EF snapshot,
  selected but never written. Re-add as an audit snapshot when run-level EF
  provenance is needed.

Also removed the same day: the legacy Next.js-starter `projects` /
`project_members` / `items` cluster — tables plus their `[projectId]` route
tree, data-access, fn, hooks, components, and `requireProjectMember` guard.
Pure starter residue; org scoping came later via ADR 0010.

### Lab-characterization chemistry kept `real` in the numeric conversion (`schema/samples-chemistry-precision`, opened 2026-07-03)

- **Decision (PR #342, issue #280):** `h_to_c_org_ratio` uses exact `numeric`, while `total_carbon_percent` / `inorganic_carbon_percent` /
  `organic_carbon_percent` / `random_reflectance_r0_percent` intentionally stay
  `real` (`src/db/schema/production.ts`) — even though `organic_carbon_percent`
  feeds CO₂e-stored math. Rationale: float4 relative error (~1e-7) is far below
  lab assay precision, so no credit-bearing digit is at risk.
- **To resolve:** decide whether #280's registry-reproducibility rationale
  (round-trip exactly what the operator entered) extends here; if yes, migrate
  to the `percent` family in `src/db/schema/numeric-families.ts`.
- **Related:** the `ppm` family caps at 999,999.9999 — marginally below the
  1,000,000 ppm physical maximum. Irrelevant for hand-entered assays; matters
  only if a lab/CSV import path ever writes ppm columns (none exists).

### Sample Surface Area / Volatile Matter — add columns or drop for good? (`schema/sample-lab-properties`, opened 2026-07-15)

- **Context:** staging QA
  ([archived report](./archive/qa/2026-07-15-qa-staging-production-chain.md), S3)
  found the sample form accepted **Surface Area (m²/g)** and **Volatile Matter
  (%)** then silently discarded them — no columns exist and
  `src/data-access/samples.ts` hard-coded both to `null`. Both fields were
  removed end-to-end so success no longer lies about what was stored.
- **Decision needed:** canonical sample record (COAs commonly report both;
  `production_samples` already has `volatile_matter_percent`) or permanently out
  of scope? Neither feeds credit math today.
- **To resolve:** stakeholder call; if yes, add columns via the `percent`
  numeric family and re-add the fields end-to-end (reseed, not migrate).

### Mix pile wet stock floors each batch at zero on its own (`output-stock/wet-stock-mix-floor`, opened 2026-10-05)

- **Context:** `layerWet` in `src/lib/output-stock/moisture-estimate.ts` floors
  each batch's wet stock at zero before `estimateStock` sums the pile. A mix
  removal takes wet shares pro rata to solids, so a removal wetter than a dry
  batch can take more wet mass from that batch than it holds. Its negative
  remainder is dropped, not netted against the other batches.
- **Example:** batches of 100 kg wet with 60 kg and 90 kg solids; a 175 kg
  removal at 60% takes 70 kg and 105 kg wet. The pile shows 30 kg wet, while
  wet in less wet out is 25 kg. Split bins are unaffected: their batches are
  separate sub-bins.
- **To resolve:** decide whether a mix pile floors its total once instead of
  each batch, and whether a batch's wet stock can then read negative.

## Architecture

See [Architecture open questions](./open-questions-architecture.md) for the deferred decisions in this area.

## Isometric Certify integration

Registry-specific deferred decisions live in
[Isometric Certify open questions](./open-questions-isometric.md). That
companion inherits this file's schema, invariants, and resolution rules.

### An archived research doc carries live corrections to shipped readings behavior (`isometric/readings-research-corrections`, opened 2026-07-29, `needs-registry-check`)

- **Observed:** [`docs/archive/2026-07-29-production-run-readings-structured-data-research.md`](./archive/2026-07-29-production-run-readings-structured-data-research.md)
  is filed as history, but two of its findings contradict behavior that is
  shipped, so nothing tracks them.
- Finding 1: the research reads Biochar Protocol v1.1.1 §9.1.2 as not containing
  the `> 0.5 bar` pressure condition or the five-minute temperature cadence that
  `src/db/schema/production.ts` documents on `productionRunReadings`. Either the
  comments describe a Noma policy that the protocol does not impose, or the
  research misread the pinned version.
- Finding 2: §9.2.2 requires flow plus CH4, H2, CO, and CO2 concentrations for
  the continuous direct-emissions method, and the canonical header set in
  `src/lib/production-readings/readings-csv.ts:parseReadingsCsv` carries only
  timestamp, temperature, and pressure. If any facility declares that method,
  the current CSV cannot evidence it.
- Both claims come from a local reading of the registry pages, so neither is
  authoritative here. Confirm each against the registry before changing a gate
  or a schema comment.
- **Resolve via:** verify both findings through the Isometric MCP server
  (`how_to`, then the protocol tools). Then correct the schema comments, decide
  whether the direct-emissions channels need a canonical-CSV extension, and
  record the outcome in [`docs/isometric/changes.md`](./isometric/changes.md)
  (M).

### One sample transport source cannot fill the template's two sample shipping lines (`isometric/sample-transport-template-drift`, opened 2026-08-21)

- **Observed:** the live sandbox check in
  `tests/isometric-sandbox-health.integration.test.ts` ("resolves every transport
  category to mass_distance") once required three
  `mass_distance_based_ci_emissions` components. It was relaxed to the two it
  actually found (feedstock and biochar transport) when the scheduled live
  workflows were repaired, so `sampling-required-for-mrv` is no longer exercised
  against the registry.
- The binding is still live in code and docs:
  `src/lib/isometric/semantic-binding-catalog.ts` declares
  `sampling-required-for-mrv / mass_distance_based_ci_emissions /
  mass_distance` (`INPUT_MAPPING`, the certify field registry tuples and the
  transport categories are projections of it), and
  `docs/isometric/sandbox-template-authoring.md` still lists the row. `src/fn/certification/certify-transport-coverage.ts:deriveRequiredTransportCategories`
  derives required categories from the live template, so a category the template
  drops is silently no longer collected or submitted.
- Two explanations are open and only a registry probe separates them: the
  re-authored template genuinely dropped sample transport, or the spec picked a
  different template — `pickTransportTemplate` falls back to the first template
  carrying any transport component, and `isometric-health.yml` sets no
  `ISOMETRIC_DEMO_TEMPLATE_ID`.
- **Registry check 2026-10-15:** the sandbox "Dark Earth Carbon Template (29 Jul)"
  (`rvt_1KS4S43VPSBXA26X`, REST GET) had no component in
  `sampling-required-for-mrv`. Later that day the template was edited in place
  as "Dark Earth Carbon Template (15 Oct)" and now has two sample shipping lines
  (EU, India), as the production template "LCA based template Cula" does. Sample
  transport is present, but one source cannot fill two lines.
- **Resolve via:** the [template-driven emissions plan](./plans/2026-10-15-template-driven-emissions.md)
  §4.5 fills both lines from emissions entries and removes
  `sampleTransportMassDistanceTonneKm` from
  `src/lib/isometric/semantic-binding-catalog.ts`, drops the authoring-doc row,
  records it in [`docs/isometric/changes.md`](./isometric/changes.md) and
  updates the sandbox-health assertion. The entry leaves when that change is
  switched on in the sandbox (M).

### Unsampled batches with incidental Samples may still submit an H/C_org mean (`isometric/unsampled-incidental-chemistry`, opened 2026-10-13)

- The durability gates skip chemistry checks when a credit batch's stored
  `sampling` choice is `unsampled` (`src/lib/certification/durability-submission-gates.ts`),
  but `buildPerBatchDurabilityData` (`src/lib/isometric/utils/durability-aggregation.ts`)
  marks a batch sampled whenever any Sample carries a usable H/C_org. An
  unsampled batch with an incidental Sample could therefore send an H/C_org mean
  the gates never judged.
- Not live today: `assertSupportedDurabilityConfiguration` refuses everything
  but sampled 1,000-year submissions.
- **Resolve via:** before enabling 200-year or unsampled submission, make the
  aggregation follow the stored `sampling` choice and add a test with an
  incidental Sample on an unsampled batch.

Audit follow-ups opened 2026-05-25 are in [open-questions-audit-follow-ups.md](./open-questions-audit-follow-ups.md).

## Product bins & formulations

### Output-bin FIFO and physical composition (`product-mass/dry-biochar-lineage`, opened 2026-08-04, `needs-registry-check`) — implemented in #759; split and mix bins agreed 2026-09-28

- **Accepted design:** [ADR 0029](./adr/0029-output-bin-stock-is-dry-biochar-drawn-fifo.md)
  and the [implementation plan](./plans/2026-09-14-fifo-bin-accounting.md)
  replace `src/data-access/delivery-dry-biochar.ts:deriveDeliveryDryBiocharKg`
  and `src/data-access/biochar-product-source-allocations.ts:planBiocharProductSourceAllocations` under [#756](https://github.com/Maji-Studio/noma-dmrv/issues/756), shipped in [#759](https://github.com/Maji-Studio/noma-dmrv/pull/759).
  Orders reserve nothing; completed deliveries post measured FIFO dry withdrawals. Applications retain proportional truck shares via `src/lib/biochar-mass-accounting.ts:allocateTrackedDryBiocharKg`.
- **Reconciliation and corrections:** compare counted and tracked solids using
  the count's moisture. Show dry losses explicitly. Retain linked corrections
  and block affected dependent changes; late intake does not replay history.
- **Registry follow-up:** validate physical oldest-first loading, fixed batch
  composition, editable ingredient-moisture evidence, and the PDD method against
  the pinned Biochar v1.1 and Agricultural Soils v1.1. FIFO attribution alone
  does not establish actual composition if material is remixed.
- **Split and mix bins (2026-09-28):** the [plan](./plans/2026-09-28-split-and-mix-bins.md),
  the ADR 0029 amendment and [ADR 0030](./adr/0030-mix-bins-draw-pro-rata.md) replace
  assumed oldest-first loading with operator-recorded draw order in physically
  separate sub-bins, and add pro-rata mix piles. The PDD still has to describe
  both practices, how a mix pile's homogeneity is shown (the Agricultural Soils
  module requires it per Storage Batch), and the per-removal moisture-reading
  method. The module requires lab moisture per production batch and says nothing
  about removal readings.
- **Mix-bin credit hold (2026-09-29):** until the PDD covers mixing,
  `MIX_BIN_REMOVALS_CREDITABLE` (`src/config/output-stock.ts`) is `false`, and
  `src/data-access/mix-bin-credit-hold.ts` keeps applications drawn pro-rata
  from a mix bin (directly, or through a product made from a mix biochar bin)
  out of credit-batch slices. The application sheet says why. Flip the switch
  once the PDD is accepted, then reconcile the credit-batch slices of the held
  applications: flipping it alone does not re-slice them.
- **Merge time is not correctable (2026-09-29):** a split-to-mix merge posts a
  movement at the chosen "Merged at" time, and history has no Correct entry for
  it. A wrong merge time needs a data fix until merges get a correction path.
- **Deferred:** all whole and partial bin-to-bin transfers remain in
  [#34](https://github.com/Maji-Studio/noma-dmrv/issues/34). Transfers must preserve
  provenance and atomically update both bins; destination ordering is to be
  settled there. Unknown-origin positive additions, arrival/application
  moisture, and general historical replay are excluded from this implementation.
- **History follow-up:** per-bin dry effects and correction comparisons are
  required here. Facility-wide history and CSV remain in
  [#33](https://github.com/Maji-Studio/noma-dmrv/issues/33).

### Product-bin formulation claim-release policy (`product-bins/formulation`, opened 2026-06-04) — **deferred**

- A product bin (`storage_locations` of type `product_bin`) carries an optional
  `formulationId` enforcing "one formulation per bin" (mirroring the
  `feedstockTypeId` "one feedstock type per bin" pattern, see
  [ADR 0012](./adr/0012-bin-capability-from-held-feedstock-type.md)). It is set
  at bin setup, or **claimed on first use**: the first formulated product placed
  into an unassigned bin sets the bin's `formulationId`
  (`src/data-access/biochar-products.ts`).
- **Deferred decision:** the claim is a *persistent* reservation — nothing
  auto-releases it when the bin's last product leaves or changes formulation. To
  re-purpose an emptied bin an operator clears the formulation;
  `updateStorageLocation` guards that edit, rejecting clearing/re-pointing while
  the bin still holds product of a different formulation (`IS DISTINCT FROM`),
  so manual release is only allowed once the bin is genuinely free.
- **Why it matters:** without auto-release, a long-lived facility accumulates
  bins permanently tagged to old formulations, so they stop appearing as
  "unassigned" for new intake. Acceptable for now; revisit on operator reports
  of bin churn.
- **Resolve via:** choose (a) keep manual release and document it as the
  intended model, or (b) auto-clear a bin's `formulationId` when its last
  matching product leaves (`deleteBiocharProduct` + the move-out path of
  `updateBiocharProduct`).

### May an emptied bin with stock history be repurposed? (`product-bins/identity-change-with-history`, opened 2026-09-16) — **decision pending**

- `src/data-access/storage-location-identity-guards.ts:assertBinIdentityChangeAllowed`
  refuses a `type` or `feedstockTypeId` change when the bin holds stock in its
  current lane, and also when the bin is empty but carries stock history
  (intake batches, run draws, products, allocations, deliveries, inventory,
  bin movements). Refusing the empty-with-history case is deliberately the
  conservative half of the decision: it is reversible, while silently
  re-pointing the lane strands recorded mass.
- **Resolve via:** the product decision on
  [#767](https://github.com/Maji-Studio/noma-dmrv/issues/767) /
  [#313](https://github.com/Maji-Studio/noma-dmrv/issues/313) — either keep the
  refusal and point operators at archive plus a new bin, or allow the change on
  an emptied bin and define what happens to the history that still names it.

### Lane totals count receipts the bin tiles do not show yet (`product-bins/lane-total-future-receipts`, opened 2026-09-29) — **decision pending**

- An output bin has two dry figures (`outputStockBalance` in
  `src/lib/output-stock/layer-projection.ts`). `allLayersDryKg` counts every
  layer, including a run or product placed later than now. `availableDryKg`
  counts only layers placed by now.
- The storage list's lane summary adds `allLayersDryKg`, while each bin's tile
  and every selector shows `availableDryKg`. After a future-dated receipt, the
  lane total is higher than the sum of its tiles.
- Guards must keep the all-layers balance, so a later receipt is never drawn
  twice or archived away. The lane total is display only.
- **Resolve via:** a product call on what the lane total means. Either it
  switches to `availableDryKg` so it matches the tiles, or it keeps the
  all-layers figure and labels the difference.

## E2E walkthrough follow-ups (opened 2026-06-07)

Surfaced by a manual walkthrough of every entity + certification; most findings
were fixed in that pass. Run context archived in
[`docs/archive/2026-06-07-e2e-walkthrough-snapshot.md`](./archive/2026-06-07-e2e-walkthrough-snapshot.md).

### Certification view is local-first; doesn't mirror the registry (`isometric/registry-mirror`) — **deferred**

- The in-app cert view can show 0 removals / 0 GHG statements while the live
  sandbox registry holds drafts created out-of-band. Period math aligns, so this
  is almost certainly **by-design**: the app surfaces only what *it* created,
  not full registry state. The bare 0-counts can be misread as "the registry is
  empty" rather than "nothing created from here yet".
- **Resolve via:** (a) a one-line note in the cert UI clarifying the local-first
  model (S), or (b) a read/sync view mirroring existing registry
  removals/statements into the app (M–L). Likely (a).
- **Option (b) is technically unblocked** — Certify exposes
  `GET /ghg_statements` (active, cursor-paginated) and `GET /removals`
  (deprecated but functional, filterable by `supplier_reference_id`), plus
  single-`GET` variants. The open decision is product, not capability.

### Isometric submission refs aren't stable across a DB reseed (`isometric/reseed-idempotency`) — **deferred**

- Idempotency **is implemented and correct within a DB lifetime**:
  `submission-claim.ts` locks drafts, refs are deterministic
  (`buildSourceSupplierRef` → `nm-src-{documentId}`), and
  `findRemovalBySupplierRef` + idempotent membership linking reconcile after a
  5xx instead of recreating. The gap: `supplier_reference_id` derives from
  **local row UUIDs**, which `pnpm db:reset` regenerates → the dedupe lookup
  can't match the prior registry entity → re-submission creates a **duplicate**
  registry removal/source/statement. Likely cause of the sandbox project
  accumulating duplicate draft removals across test cycles.
- **Why it matters:** **sandbox-only today** — prod won't reseed, so refs stay
  stable and idempotency holds. A test-hygiene issue, not a production
  data-integrity bug. But it makes the sandbox registry a noisy mirror, and any
  future reseed-like prod event (restore from scratch, re-key) would silently
  duplicate.
- **Resolve via:** (a) accept it — sandbox drafts are harmless (0 credits
  issued), optionally cleaned periodically (S); or (b) derive
  `supplier_reference_id` from a stable business key (the entity's `XX-26-NNN`
  code) instead of the row UUID (M). Likely (a) pre-launch.

Whole-repo audit follow-ups opened 2026-06-07 are in [open-questions-audit-follow-ups.md](./open-questions-audit-follow-ups.md).

## E2E robustness follow-ups (opened 2026-06-10)

Deferred from the e2e-reliability pass that split live-sandbox specs out of PR
CI (`@live` tag → nightly `e2e-live.yml`) and fixed the stale full-chain
selectors. See [`docs/testing.md`](./testing.md).

### Graceful degrade for invalid Isometric project links (`certification/invalid-project-422`)

- A facility linked to a project id the registry rejects (404/422) makes
  `safeListIfConfigured` re-throw, and React Query retries the failing server
  action — repeated real API calls and a degraded page instead of a calm
  "project not resolvable" state. Surfaced in CI when fake-project specs ran
  with real creds loaded; the same behavior would hit prod on a stale/revoked
  link.
- **Already handled:** `ghg-statements-list.tsx` derives `mappingFailed` from
  the failing summary query and shows a warning banner, and
  `deriveRemovalReadiness` (`src/lib/certification/readiness.ts`) blocks
  readiness when `!facts.hasMapping`.
- **Still open:** `safeListIfConfigured` (`src/fn/certification/shared.ts`) —
  treat 404/422 as non-retryable, return an empty/flagged result instead of
  throwing, and surface a warning chip on the registry-connection card (M).

### Hermetic local stub for the Isometric client (`testing/isometric-stub`)

- `ISOMETRIC_BASE_URLS` in `src/lib/isometric/client.ts` is hardcoded, so the `@live`
  specs only run against the real sandbox; devs without
  `ISOMETRIC_DEMO_PROJECT_ID` silently skip them — which is how the
  Settings/mapping specs drifted unnoticed.
- **Resolve via:** a test-only base-URL override + a small fixture stub server
  (started from Playwright `globalSetup`) serving canned project/template
  responses, so the certification flows run hermetically everywhere (M).

### Playwright hygiene (`testing/e2e-hygiene`)

- `waitForLoadState("networkidle")` is used throughout `full-chain-ui.spec.ts`
  (slow-by-design with polling queries); certification specs cluster on a shard
  because sharding distributes by file. Consider `fullyParallel: true`
  (shard by test) after confirming no in-file ordering deps, replacing
  networkidle waits with role-based expects, and `eslint-plugin-playwright` (S).

Tooling and dependency upgrade deferrals are tracked in
[Toolchain open questions](./open-questions-toolchain.md).

## QA 2026-07-21 remediation follow-ups (opened 2026-07-21)

See [QA follow-up questions](./open-questions-qa.md) for these unresolved findings.

## Promotion #682 review follow-ups (opened 2026-08-14)

Findings from the multi-agent review of the staging-to-main promotion PR #682
that were verified real but deliberately not fixed in
`fix/promotion-682-review-findings` (which fixed the sync-event entity-id type,
the stale-lock script's entity type, the storage-location lock order, the GHG
interrupted marker, the interrupted-CAS visibility, PDF number formatting, and
the shared-project create gate fallback).

### A drifted draft with a confirmed registry write is permanently blocked (`certification/confirmed-drift-dead-end`)

A removal draft that latched `externalMutation: "confirmed"` and later hits a
payload-hash mismatch is retired by `retireForDrift` in
`src/fn/certification/removal-submission-freshness.ts` with
`preserveForReconciliation = true`, which throws before
`retireStaleSubmissionDraft` can run — and that is the symbol's only caller, so
`create-new-version` is unreachable for this state. `draft` also blocks
regrouping. The escape hatch is now `scripts/isometric-clear-stale-lock.ts`
(fixed to target `localEntityType = 'removal'`), but rejecting a
confirmed-write draft and re-versioning can double-create registry entries
because removal supplier refs are version-suffixed (`buildRemovalSupplierRef`).
**Resolve via:** a deliberate reconcile-or-discard path for
confirmed-mutation drafts, not the reject-and-reversion the script does.

### First-time Storage Location creates always run the bounded reconcile scan (`certification/storage-location-resumed-scan`)

`createStorageLocationUnderLocks` (`src/fn/certification/storage-locations.ts`)
passes `resumed: true` unconditionally, so every first create pages through
`findStorageLocationBySupplierReference`
(`src/lib/isometric/storage-locations.ts`), which scans at most 50 pages x 20
records and throws past that. Once a project holds more than 1000 storage
locations, no new site can be registered. `needs-registry-check`: whether
`GET /storage_locations` supports server-side filtering by
`supplier_reference_id`, which would remove the scan entirely.

### Crash-window interruption still loses the confirmed-write marker (`certification/interrupted-marker-crash-window`)

The interrupted markers written by
`recordClaimedRemovalSubmissionFailureBestEffort`
(`src/fn/certification/removal-submission-failure.ts`) and the GHG create path
are in-process best-effort writes inside a `catch`; a SIGTERM/timeout mid-POST
records nothing. On retry `readRemovalSubmissionExternalMutation` reports
`"none"`, so payload drift retires the draft without
`preserveForReconciliation` and the next version re-POSTs datapoints and
measurement samples under new version-suffixed supplier refs — a duplicate
GHG entry. **Resolve via:** persisting an attempt-started marker before the
first registry POST, or reconciling by unversioned keys.

### Order/delivery repoint does not guard the target lineage (`orders/repoint-target-lineage-guard`)

`updateSample` and `updateApplication` call the certification lineage guard on
the *target* parent when repointing; `updateOrder`
(`src/data-access/orders.ts`, repointing `biocharProductId`) and
`updateDelivery` (`src/data-access/deliveries.ts`, repointing `orderId` /
`biocharProductId`) guard only the entity's current lineage. Repointing an
order onto a product that belongs to a submitted removal grafts new chain-of-
custody onto a locked lineage after submission. Pre-existing, not introduced
by #682.

### Wet-mass allocation attributes draws to depleted intake batches (`feedstock/allocation-original-mass-weights`)

`allocateFeedstockWetMass` (`src/data-access/feedstock-wet-stock.ts`) weights
by each batch's original `massWetKg`, never remaining mass, so cumulative
`production_run_feedstocks` attribution to one batch can exceed its intake once
later batches share the bin. Bin stock stays correct; provenance (credit-batch
feedstock-type derivation, CoC Sankey) degrades. Carried over verbatim from the
pre-#676 dry allocator - a known limitation, not a regression.

### Unused stock-take and application facet paths

`recordStockTakeFn` / `useRecordStockTake` / `recordStockTakeMovement` lost
their only consumer when #666 deleted `StockTakeForm`. The `visual`
null-method facet branch in `src/data-access/applications.ts` is unreachable
(`evidence_method` is NOT NULL). Remove these unused paths in a follow-up.

### Confirm: unapplied member runs now hard-block removal submission (`certification/unapplied-member-run-blocker`)

PR #660 (titled as gap routing) also made `productionReadinessGapForScope`
(`src/lib/certification/production-readiness-from-lineage.ts`) return a gap for
any completed member run with zero applications, and `hasSubmittableRuns` in
`src/fn/certification/certify-context-core.ts` turns that into a hard blocker
for the whole Removal. Batch membership is date-window auto-assignment
(`src/data-access/credit-batch-membership.ts`), and biochar is typically
applied weeks after production, so a run completed late in a crediting period
blocks an otherwise-complete batch until its product is applied. The sub-commit
says deliberate; needs a product confirmation that this is the intended
operational tradeoff, and this is not a registry requirement we verified.


## Design review 2026-08-13 follow-ups (opened 2026-08-14)


## API credential lifecycle follow-ups

- Deliver the decided 14-day expiry notices and owner-removal notices to
  organization admins when the scheduled-job/notification infrastructure lands
  (data-entry API plan, decisions 8 and 13). The credential foundation records
  expiry and revocation but sends no notices. Pointers: `src/db/schema/api-keys.ts:apiKeys.expiresAt` and `src/data-access/api-credential-auth.ts:disableOwnerApiKeys`.
- Staging cron gap: Vercel Cron does not run on Preview deployments. Staging
  relies on the claim path deleting expired idempotency records lazily, and
  idle rate-limit buckets are not purged on schedule. Abandoned uploads and
  failed-document retention also lack the daily sweep. Both crons run only on
  Production; the site deployment answers 404 to both. If growth matters, add
  scheduled GitHub Actions calls to the secret-authenticated
  `/api/cron/purge-api-records` and `/api/cron/sweep-document-uploads` routes.
