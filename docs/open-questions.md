# Open Questions

**What this covers:** every deferred decision, known-but-unfixed defect, and
question waiting on an external party (Isometric, a stakeholder, an operator
sandbox run). **When to read it:** before starting work in an area, to find out
what is deliberately unbuilt there and why — and before "fixing" something that
looks broken, because it may be a recorded decision.

Two rules bind this file:

1. **An entry leaves only when the issue is provably resolved** — not when it
   goes stale. Record the resolution in the owning doc (an ADR under
   [`docs/adr/`](./adr/), [`docs/isometric/changes.md`](./isometric/changes.md),
   or the relevant feature doc) and delete the entry.
2. **Every claim carries a code pointer** — a module path, not a line number
   (line numbers rot). If you can't point at the code, the claim isn't
   verifiable and doesn't belong here.

Deferred work lives here, never as a `TODO` in code.

**Anchor every entry on a `file:symbol` it depends on.** This file's recurring
failure mode is entries whose code was renamed or deleted underneath them
(`safeAppendSyncEvent`, `deleteDocumentsForEntity`,
`insertDraftSubmissionWithMappingLockAndLocks` — all gone, all still cited here
for weeks). A named symbol makes a rename break the entry visibly under grep;
prose alone rots silently.

**`needs-registry-check`** marks a question that must be answered by the
Isometric MCP server (`how_to`, then the protocol/OpenAPI tools) or a sandbox
probe — **never** from `docs/isometric/*`, which are non-authoritative local
summaries. Do not close one of these from a local doc.

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
  while waiting for another, and starves the pool under parallel load. This is
  the same failure the `storage/sources-sync-events-tx` entry below describes —
  and that one is **not** mitigated: `src/db/index.ts` runs `max: env.DB_POOL_MAX
  ?? 1`, and `DB_POOL_MAX` is unset in every environment. Applies to every
  tx-scoped read, not just this helper.
- **`transport_legs.tripType` defaults to `'return'` and is credit-bearing.**
  `roundTripDistanceFactor` (defined in `src/schemas/trip-type.ts`; imported by
  `src/lib/isometric/utils/aggregation.ts` and
  `src/lib/certification/evidence-ledger/build-model.ts`) applies
  ×2 for `return` and ×1 for `one_way` (issue #316, §4.2 — conservative by
  default; `one_way` requires an evidenced onward destination). "Simplifying"
  the default or the multiplier halves submitted transport emissions in the
  **anti-conservative** direction — the same integrity class as the
  `pyrolyzer_direct` zero-stub trap below.
- **`sReflectanceFraction` is stored 0–1 but captured as a percentage.** The
  form converts on entry and clears the field on a durability-mode switch
  (`src/components/samples/sample-form.tsx`); `src/schemas/samples.ts` makes it
  *conditionally required* for 1000-year durability. A well-meaning edit that
  drops the conversion or the conditional puts a 100× error into a
  credit-bearing input.

## Schema

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
  `natural_disaster_risk` / `operator_track_record` enums. Today
  `credit_batches.buffer_pool_percent` is entered directly.
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

- **Decision (PR #342, issue #280):** the real→numeric conversion moved
  `h_to_c_org_ratio` and the heavy-metal/contaminant panel to exact `numeric`,
  but `total_carbon_percent` / `inorganic_carbon_percent` /
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

## Architecture

### Auto-fill sample chemistry from an uploaded lab report (`samples/coa-autofill`, opened 2026-07-02)

- Parse an uploaded COA/lab-report PDF to pre-fill the sample form's ~30
  hand-transcribed chemistry fields. Upload slot already exists (`lab_report` on
  the sample's Evidence step). **Owned by #329** — extraction approach,
  review UX, and where parsing runs are all scoped there.

### #473 no-flash guarantee is now per-page, not global (`navigation/select-facility-deep-link-skeleton`, opened 2026-07-20)

- **Context:** the layout-level `FacilityGate` was deleted; the pre-resolution
  loading skeleton for a deep-linked `?facility=<id>` (issue #473) now lives
  inside `SelectFacilityEmptyState`
  (`src/components/navigation/select-facility-empty-state.tsx`), rendered only
  when a facility-scoped page reaches the point of rendering that component
  for its no-selection state.
- **Consequence:** the guarantee "a deep-linked facility never flashes an
  empty/select-a-facility state while it resolves" is an **invariant of
  `SelectFacilityEmptyState` usage**, not something the router or layout
  enforces. Any facility-scoped page that branches on the facility itself
  (e.g. an early return or a different empty-state component instead of
  rendering `SelectFacilityEmptyState`) can still flash on a direct/deep-link
  navigation, and nothing will catch it.
- **Test coverage gap:** the regression spec for #473
  (`tests/e2e/facility-gate.spec.ts`, `describe("Deep-linked facility
  resolves on direct navigation (#473)")`) only exercises `/reactors`. It does
  not assert the invariant on any other facility-scoped page.
- **To resolve:** either (a) audit every facility-scoped page to confirm its
  no-selection branch always routes through `SelectFacilityEmptyState` and add
  a lint/test convention that prevents future pages from rolling their own, or
  (b) extend `tests/e2e/facility-gate.spec.ts` to cover a second, differently-
  shaped facility-scoped page. Until then: **new facility-scoped pages must
  route their no-selection state through `SelectFacilityEmptyState`** rather
  than a bespoke empty state or early return.

### Facility switcher unreachable while an entity side sheet is open (`navigation/sheet-blocks-facility-switch`, opened 2026-07-20)

- QA 2026-07-20
  ([findings](./archive/qa/artifacts/2026-07-20-qa-a-b93d/findings.md), P2):
  with a detail or create sheet open, the modal overlay of
  `src/components/ui/entity-side-sheet/index.tsx:EntitySideSheet` makes the sidebar facility
  selector inert, so the operator cannot switch facilities without first
  closing the sheet. This is the modal behavior working as designed — the
  open question is the intended UX: keep the sheet modal (status quo),
  make it non-modal, or add an explicit close-and-switch flow that
  reconciles URL, navigation, and unsaved form state.
- **To resolve:** UX decision with DEC; adjacent to #253 (cross-facility
  context reconciliation), which any switch-while-open flow must satisfy.

### Registry picker needs approved Puro Earth / CSI logo assets (`onboarding/registry-picker-logos`, opened 2026-07-22)

- The archived onboarding plan
  ([`2026-07-21-onboarding.md`](./archive/plans/2026-07-21-onboarding.md)) asks the wizard's
  registry step to show Puro Earth and CSI greyed **with their logos**.
  `src/components/certification/registry-picker.tsx` deliberately renders styled
  text wordmarks instead: we hold no approved logo files, and bundling
  unofficial reproductions of third-party registry branding is worse than no
  logo. (The component moved out of `onboarding/` on 2026-07-28 when the
  certifier settings pane became its second consumer.)
- **To resolve:** DEC obtains approved logo assets (and usage permission) for
  both registries, or amends the plan to accept text wordmarks. Swap the
  wordmark spans in `registry-picker.tsx` for the assets when they arrive.

### An Organization cannot be renamed (`tenancy/organization-rename`, opened 2026-07-28)

- `organizations.name` and `slug` (`src/db/schema/auth.ts`) are settable only at
  creation, through `createOrganizationWithOwner`
  (`src/data-access/organizations.ts`). There is no `updateOrganization`, so a
  typo at onboarding is permanent and shows in the sidebar brand, the settings
  subtitle, and every invitation email.
- **To resolve:** add `updateOrganization` plus a name/slug field on
  `/settings/organization` for Owners. A slug change needs a decision on
  existing invitation-accept URLs, which embed the invitation id rather than the
  slug — so probably none, but confirm before assuming.

### Registry credentials can be replaced but not removed (`certification/credential-removal`, opened 2026-07-28)

- The certifier settings pane replaces keys by typing over a masked field, and
  the "Remove" control that used to sit above the form is gone
  (`src/components/organizations/organization-certifier-credentials.tsx`). The
  data-access primitive `deleteCertifierCredentials`
  (`src/data-access/certifier-credentials.ts`) remains and is exercised by test
  teardown, but no surface calls it, so an organization cannot disconnect from
  the registry from the UI.
- **To resolve:** decide whether disconnecting is a real operator need. If it
  is, it belongs as a destructive action on the Certifier pane with a confirm
  dialog, not as the row treatment it replaced.

### New organizations still inherit Dark Earth Carbon's feedstock catalog (`tenancy/starter-feedstock-catalog`, opened 2026-07-28)

- `seedOrgDefaults` (`src/db/org-defaults.ts`) injects
  `STARTER_FEEDSTOCK_TYPES`, an operator-specific starter catalog, into every
  organization at creation. Harmless while DEC is the only tenant; wrong as
  soon as it is not.
- **To resolve:** a Platform-Admin choice at org creation, or an onboarding step
  that picks a catalog. Not an operating default: it creates records rather than
  seeding a form, so it does not belong on `/settings/defaults`.

### ADR 0026's org-level plausibility overrides are unbuilt (`data-quality/plausibility-overrides`, opened 2026-07-28)

- [ADR 0026](./adr/0026-plausibility-warnings-are-advisory.md) specifies that
  each rule has "a versioned system default and may have an Admin-managed
  Organization override". No plausibility module exists under `src/`, so neither
  half is implemented.
- **To resolve:** build the rule engine first. When it exists, the override
  surface is `/settings/defaults`
  (`src/components/settings/organization-defaults-form.tsx`) — the table
  `organization_settings` and its Owner/Admin gate are already in place. Keep
  the distinction that page is built on: advisory thresholds may be
  org-editable, certification gates may not.

### White-label dashboards per Organization (`tenancy/white-label`, opened 2026-06-11)

- **Deferred (2026-06-11 multi-tenancy grilling):** at launch each Organization
  gets the org-scoped app with its name/logo in the chrome — no per-org
  subdomains, theming, or branded invitation emails.
- **To resolve:** revisit on client demand; scope is wildcard domain routing,
  per-org theme tokens, branded Resend templates
  ([`docs/mail-setup.md`](./mail-setup.md)).

### Facility-wide monitoring dashboard / live map (`coc/facility-dashboard`, opened 2026-06-11)

- **Recorded as future, out of scope** (2026-06-11 chain-of-custody-views
  grilling): the Maji concept canvas also contains a one-screen monitoring
  dashboard (KPIs, geospatial panel, mini-Sankey, sensors, credit ledger), a
  facility-wide live map spanning all batches/routes, and an outward-facing
  public provenance showcase. The credit-batch anchor
  ([ADR 0011](./adr/0011-credit-batch-anchored-chain-of-custody.md)) deliberately
  covers only batch-scoped provenance.
- **To resolve:** decide whether the existing dashboard route grows a
  geospatial/mass-balance panel, and whether a buyer-facing shareable page is
  wanted (different audience, different auth surface).

### Facility-anchored transport origin breaks on multi-hop / multi-storage orgs (`transport/multi-hop-distribution`, opened 2026-06-11)

Merged 2026-07-20 with the former `transport/storage-topology` — one question.

- **Current model:** a biochar product carries exactly ONE auto-derived
  distribution leg (facility → delivery destination), aggregated from its
  deliveries via `aggregateDistributionLegs` (mass-weighted distance,
  `transport_legs` one-derived-per-entity invariant). The **facility** (name +
  GPS) is the hard-coded origin — the storage location a product actually sits
  in never enters the route. Matches Dark Earth Carbon's flow. The manual
  "biochar → storage" leg editor was removed from the product sheet (it predated
  derivation and invited rows the resync didn't own).
- **Question:** how to stay correct when an org trucks biochar to an
  intermediate storage/depot first, or simply adds a second storage location.
  Both cases mean two or more real legs per product with different masses per
  hop, which the single-derived-leg invariant can't represent; and
  `biochar-storage` emissions (template group currently empty) would need
  per-location attribution once sites have different energy/fuel profiles. The
  live Certify template's `biochar-transport` component takes one distance + mass
  pair per removal.
- **Why it matters:** a second storage site silently changes real transport
  distances and storage emissions without changing anything the derivation
  reads, so submitted numbers drift from reality.
- **To resolve:** wait for an org with intermediate storage or a second site;
  then decide (a) multi-leg derivation with hop ordering (origin = the product's
  bin location, storage locations gaining GPS + distance provenance), folded into
  one equivalent Σ(dist×mass) for Certify, or (b) per-hop components in the
  removal template — plus whether storage-site transfers become first-class
  custody events in the trail. Touches `aggregateDistributionLegs`, the
  one-derived-per-entity index, and the batch readiness transport gate.
- **See also:** #456, #420.

### Split `src/db/seed-data.ts` into domain seed modules (`db/seed-modularization`, opened 2026-06-11)

- **Problem:** `seed-data.ts` is well over the repository's 1000-line cap and
  grows as each new domain appends its block to the single transaction.
- **Note the lint exemption:** `eslint.config.mjs` lists
  `src/db/seed-data.ts` in the `ignores` array alongside the generated Isometric
  types, so `max-lines` will **never** flag it. Removing that exemption is part
  of this work; nothing else will surface the file.
- **To resolve:** extract per-domain modules into a new domain seed-module
  directory and leave `seed-data.ts` a thin orchestrator. Mechanical but
  touchy — the blocks share the `ids` map — so do it as a dedicated refactor
  PR (M).

### Postgres RLS as defense-in-depth (`tenancy/rls`, opened 2026-06-11)

- **Deferred, not rejected** ([ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md)):
  the `organizationId`-on-every-table schema is RLS-ready with zero schema
  change. Add RLS policies + per-transaction `SET LOCAL` if a client
  contractually requires isolation guarantees beyond data-access enforcement.
  Drizzle's first-class `pgPolicy` support (0.45/kit 0.31) is available now.

### Certifier-credential key rotation (`tenancy/credentials-key-rotation`, opened 2026-07-12)

- **Problem:** stored per-org certifier credentials
  (`certifier_credentials.*_encrypted`) are AES-256-GCM payloads prefixed with
  `v1:` — a *payload-format* version, **not** a key identifier. There is exactly
  one active `CREDENTIALS_ENCRYPTION_KEY`, so rotating it makes every existing
  row undecryptable (fail-closed: reads throw "authentication failed", not
  silent corruption). No dual-key or re-encrypt path exists.
- **Why it matters:** once real production credentials are stored, rotation
  (routine hygiene, or incident response after a suspected leak) becomes a
  data-loss event requiring every org to re-enter its secrets.
- **Decide before production data exists:** (a) add a key-id to the payload
  header (`v1:<keyId>:…`) so rows self-describe; (b) support a primary + set of
  decrypt-only retired keys with a background re-encrypt pass during a bounded
  rotation window. Cheap now, expensive to retrofit (M). See
  [`docs/security.md`](./security.md).

### Drop the `ALLOW_SELF_SIGNUP` flag (`auth/drop-self-signup-flag`, opened 2026-07-20)

- **Decided:** public self-signup is not a supported configuration. The product
  is B2B invite-only, so the flag has exactly one correct value and is a tunable
  that is never tuned.
- **Current state:** `false` in every environment — `.env.example:28`,
  `tests/setup.ts:21`, `.github/workflows/e2e.yml:35`,
  `.github/workflows/e2e-live.yml:41` — feeding
  `disableSignUp: !env.ALLOW_SELF_SIGNUP` (`src/lib/auth/better-auth.ts:171`).
- **Simplification (S):** hardcode `disableSignUp: true`, delete
  `ALLOW_SELF_SIGNUP` from `src/config/env.ts:64` and the four environment
  declarations, and rewrite `tests/auth-config.test.ts:6` to assert the constant
  rather than the env round-trip. Removes a config surface whose only failure
  mode is someone setting it to `true`.
- **Why it hasn't been done:** no urgency — the flag is fail-closed and every
  environment already pins it. Worth folding into the next auth-area change
  rather than as its own PR.

### Does the app-shell scrollport deserve a permanent E2E guard? (`e2e/scrollport-guard`, opened 2026-07-29)

- **Problem:** the temporary `zz-app-shell-scrollport` / `zz-redirect-route-errors`
  specs were deleted (they pinned facility UUID `6769395d-…` that no seed or
  fixture creates, so every route rendered the select-facility empty state and
  the suite hung 600s×2 in CI). The layout change they were written for
  (`md:h-screen md:overflow-hidden` in `src/app/(app)/layout.tsx`, which moves
  the desktop scrollbar from the window into `main`) shipped and settled, but
  nothing now asserts the scrollport frame: a regression would break
  `position: sticky` silently on every page.
- **To resolve:** decide whether the frame warrants a purpose-built spec on
  `seededData.facility.id` (assert `main` is the scrollport on a normal route
  and that the two full-bleed canvas routes do not scroll), or whether the
  sticky behavior is exercised enough by existing route specs to leave
  unguarded (S).

### Distance fields use two different react-hook-form wiring patterns (`forms/distance-field-controller-drift`, opened 2026-07-29)

- **Observed:** `src/components/customers/customer-location-fields.tsx:CustomerLocationFields`
  now reads and writes `distanceFromFacilityKm` / `distanceSource` through
  `useController`, matching the GPS fields beside it. The two other
  `DistanceCalcField` hosts still use the older wiring:
  `src/components/suppliers/supplier-location-form.tsx:SupplierLocationForm`
  (`watch` plus `setValue`) and
  `src/components/transport-legs/transport-leg-form.tsx:TransportLegForm`
  (`useWatch` plus `setValue`).
- The old pattern is not known to be broken. `tests/e2e/position-picker.spec.ts`
  exercises the supplier CALC path end to end, including the map-estimate to
  manual provenance flip, and it passes. There is no confirmed repro of a
  value-sync defect on either remaining form.
- The cost of leaving it is convention drift: a reader of the three forms sees
  two answers to the same question, and the next form copies whichever it lands
  on first.
- **Resolve via:** decide whether `useController` is the house pattern for
  `DistanceCalcField` hosts. If it is, convert the supplier and transport-leg
  forms and note the rule in [`forms.md`](./forms.md). If it is not, leave both
  and delete this entry (S).

### Only the GHG statement report PDF renders deterministic bytes (`certification/ledger-pdf-determinism`, opened 2026-08-06)

- **Observed:** @react-pdf/pdfkit writes each compressed object when its own
  async deflate ends (so the threadpool permutes object order in the file) and
  tags every embedded subset font with `Math.random()`. Neither has a seam in
  @react-pdf/renderer 4.5.1, so `renderGhgStatementReportPdf` post-processes its
  output through
  `src/lib/certification/ghg-statement-report/canonical-pdf.ts`.
- Every other document built on `renderLedgerToBuffer`
  (`src/lib/certification/evidence-ledger/pdf-theme.ts`) is still byte-unstable.
  That is harmless today because only the GHG statement report has a stored
  checksum operators and verifiers compare.
- **Resolve via:** if a second ledger ever gains a checksum or a stored-artifact
  verification gate, move the canonicalizer next to `renderLedgerToBuffer` and
  apply it to every ledger rather than copying it (S).

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

Audit follow-ups opened 2026-05-25 are in [open-questions-audit-follow-ups.md](./open-questions-audit-follow-ups.md).

## Product bins & formulations

### Conserve dry biochar through orders, deliveries, and applications (`product-mass/dry-biochar-lineage`, opened 2026-08-04) — **deferred · needs-registry-check**

- **Agreed invariant:** dry biochar mass is established before mixing from the
  source biochar's wet mass and biochar-only moisture. Wet ingredients, added
  water, and later changes to finished-product moisture do not create or remove
  dry biochar. Finished-product moisture remains important evidence of the
  condition and actual mass delivered to the customer, but it cannot distinguish
  ingredient solids, ingredient water, biochar water, and added water.
- **Accepted first version:** orders reserve a proportional planning estimate.
  Deliveries and applications transfer tracked dry biochar in proportion to the
  recorded wet-product basis, with the final full use carrying the exact dry
  remainder. `deliveries.massDryKg` is the server-authoritative dry-biochar
  allocation; finished-product moisture is independent delivery evidence.
- **Deferred limitation:** partial allocation assumes the recorded mixture is
  homogeneous. Recorded added water changes the remaining wet basis without
  changing conserved dry biochar, but unrecorded stock changes, stock takes,
  segregation, ingredient additions, and losses still need an auditable
  reconciliation workflow.
- **Registry check:** use the Isometric MCP `how_to` flow to confirm the required
  grain and evidence for biochar moisture versus finished blended-product
  moisture before changing certification field gates. Local protocol summaries
  are not authoritative for closing this point.
- **To resolve:** specify the mass-ledger and operator-reconciliation workflow
  for departures from the accepted homogeneous recorded-basis assumption,
  then regression-test those reconciliation paths.

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

- `BASE_URLS` in `src/lib/isometric/client.ts` is hardcoded, so the `@live`
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

## Tooling & toolchain upgrades (research pass, opened 2026-06-12)

Verified findings from a sourced research sweep (Next 16 / TS 7 / Drizzle v1,
mid-2026). Already confirmed fine: Turbopack default (no stale flags, no webpack
config), `reactCompiler: true` opt-in, `src/proxy.ts` rename, generate+migrate CI
workflow.

### TypeScript 7 (tsgo) for CI typecheck (`tooling/ts7`)

- Still open: `package.json` pins TS `^5.9.3` and there is no `tsgo` anywhere.
- **Resolve via:** add a non-blocking `tsgo --noEmit` CI job to validate parity
  against the large Drizzle schema and Zod-heavy types; flip the blocking typecheck
  once TS 7 ships stable (S).

### Drizzle ORM/Kit v1.0 upgrade (`db/drizzle-v1`)

- v1 was at `1.0.0-rc.3` (stable line still 0.45.x). Bundles a full drizzle-kit
  rewrite (with materially faster introspection for a schema of this size), migrations folder
  v3 (journal.json removed, per-migration folders, ends git conflicts on
  migrations), and Relational Queries v2 (breaking; official v1→v2 guide).
  Release notes warn "something will definitely break".
- **Resolve via:** do NOT adopt at RC. When stable ships, use a dedicated
  upgrade branch; the no-prod-data reseed-over-migrate stance makes the
  migrations-folder restructure cheap if done before launch (M).

### Cache Components pilot (`app/cache-components`)

- Next 16 caching is fully opt-in via `cacheComponents: true` (`'use cache'` +
  PPR model; `cacheLife`/`cacheTag` stable, old PPR flags removed). For an
  auth-gated, org-scoped app there's no urgency, and no verified real-world
  adoption evidence for auth-heavy apps yet. See
  [`docs/modern-patterns.md`](./modern-patterns.md).
- **Resolve via:** a selective pilot on read-heavy views (dashboard,
  chain-of-custody roll-ups) when perf data justifies it; not codebase-wide (M).

### Unverified research areas needing a follow-up pass

Lint tooling (Biome 2 / oxlint vs ESLint 9), OpenAPI contract testing for the
Isometric client, Renovate vs Dependabot, pnpm supply-chain guidance — the sweep
produced no adversarially-verified claims in these areas. (Vitest 4 and
Playwright 1.58+ were on this list and are both already adopted — `vitest`
`^4.1.0`, `@playwright/test` `^1.58.2`.)

## QA 2026-07-21 remediation follow-ups (opened 2026-07-21)

Product decisions deferred from the staging UX audit + Isometric integration
remediation PR (archived ledgers:
[`2026-07-21-staging-ux-audit.md`](./archive/qa/2026-07-21-staging-ux-audit.md) and
[`2026-07-21-staging-isometric-integration.md`](./archive/qa/2026-07-21-staging-isometric-integration.md)).
The PR shipped the
Layer-1 fixes (named exclusion clocks, structured Removal setup gaps, removed
inert lifecycle badge, typed archive confirmation, Method-B baseline lower
bound); these are the decisions it deliberately did not make.

### Are future-dated samples legitimate planned records? (`samples/future-dates`)

- The remediation labels future-dated samples everywhere ("N future-dated —
  counted from <date>") but does not block them at entry: the QA synthetic
  chains themselves are future-dated, and the audit left block-vs-label as an
  open decision.
- **Resolve via:** decide whether sample entry should reject sampling times
  after "now" (with an explicit planned-samples workflow if planning is a real
  need), then enforce in `src/schemas/samples` + data-access (S).

### Who owns the Credit Batch lifecycle? (`credit-batches/lifecycle`)

- `credit_batches.status` still defaults every row to `pending` with no
  transition path; the badge/filter were removed from the UI rather than
  wired to anything. The enum (draft/pending/verified/issued/rejected) remains
  in the schema and the dashboard's "period ended · awaiting verification"
  attention item still keys on `status = 'pending'`.
- **Resolve via:** define the lifecycle's owner (local readiness vs Isometric
  submission/verification/issuance webhooks) and its transitions, then either
  drive the column from that machine and restore the badge, or drop the column
  (M).

### Blueprint-key gaps: operator-fixable or admin diagnostic? (`certification/blueprint-key-gaps`)

- The Removal wizard now names unresolved template blueprint keys instead of
  issuing the false link/template instruction, but the copy can only say "ask
  an administrator" — there is no in-app control that resolves a blueprint
  mapping.
- **Resolve via:** decide whether blueprint resolution belongs in Certification
  Settings (operator-facing) or stays an admin/support escalation; if the
  former, build the mapping surface (M).

### Archive governance for registry-submitted lineages (`facilities/archive-governance`)

- Archiving a facility with submitted Removals/GHG statements now requires the
  typed facility code plus a warning, but is still allowed for any admin. The
  audit proposed an admin-only governed path (reason, audit event, external
  IDs) for submitted lineages.
- **Resolve via:** decide whether submitted-lineage archive needs a separate
  governed workflow or the typed-code gate suffices pre-launch (S).

### Grouped cert-gap counts vs missing-field counts (`certification/gap-count-wording`)

- One grouped "cert gap" can contain several missing fields (e.g. telemetry +
  three photo roles). The counts are consistent across surfaces, but the
  wording never says "1 gap group · 4 missing fields".
- **Resolve via:** pick one convention (group count with expanded field list,
  or field count everywhere) and apply it to the card tag, health strip, and
  Removal wizard copy (S).

### Zoneless date/time construction outside the production-run form (`dates/zoneless-instants`)

- F-2 anchored the production-run start/end combiner to the facility timezone,
  but the same bug class survives elsewhere. `fn/production-incidents` and
  `fn/production-samples` parse a zoneless `"YYYY-MM-DDTHH:mm"` string with
  `new Date(...)` on the **server**, so the stored instant depends on the server
  process timezone; `data-access/production-runs/overlap` formats conflict
  messages in that same zone; and `productionRunDateExpr` casts `start_time` to
  a **UTC** calendar day rather than the facility day, so a near-midnight run
  can land in the wrong cohort date. Display counterparts in
  `production-incident-form`, `production-sample-form` and
  `components/samples/sample-form` render in the browser zone (the
  production-run side sheet was moved to the facility zone on 2026-07-25).
- **Resolve via:** decide one project-wide rule — instants are constructed and
  rendered in the facility zone, date-only values stay pinned to UTC (issue #46)
  — then apply it to the remaining sites and add a lint or test guard so a
  zoneless `new Date(string)` cannot reappear (M).

### Operator-initiated GHG statements are still refused on a shared project (`certification/shared-project-statement-create`)

- ADR 0023 scoped registry statement identity per organization + facility, so a
  re-pointed project no longer locks the new facility out on **sync**. But
  `assertDedicatedGhgStatementProject` still refuses operator-initiated creates
  while a project is shared across facilities, so the unlocked path is the
  sequential one (A imports → project re-points → B imports its own row).
  Whether two facilities on one live project should be able to create statements
  concurrently is unanswered — the guard was deliberately kept.
- **Resolve via:** confirm with Isometric whether one project may carry
  concurrent per-site statements for the same period; if yes, replace the guard
  with per-facility period scoping, if no, keep it and say so in the copy (M).

### `formatInTimeZone` is not process-zone independent (`dates/format-in-time-zone-gap`)

- `formatFacilityTime` and `formatFacilityDate` (`src/lib/date-utils.ts`) render
  through date-fns-tz's `formatInTimeZone`, which builds a `Date` whose **local**
  components equal the target zone's wall clock. When the machine's own zone
  skips that wall clock, the `Date` rolls forward and the reader lies —
  empirically `formatInTimeZone(2026-03-07T23:30Z, "Africa/Dar_es_Salaam")`
  returns `03:30` instead of `02:30` under `TZ=America/New_York`.
- It only bites when the viewer's (or server's) zone skips the same wall clock on
  the same date, so it is rare — but the affected readers are load-bearing: the
  production-run edit read-back
  (`src/components/production-runs/production-run-timing.ts:productionRunTimingDefaults`),
  and the facility-local sampling day in `src/fn/samples`,
  `src/fn/certification/durability-readiness`,
  `src/lib/certification/durability-batch-summary` and
  `src/lib/certification/evidence-ledger/durability-build-model`, which feeds
  registry-facing durability gates.
- `combineDateAndTime` in the same module already avoids this by reading the zone
  with `Intl.DateTimeFormat.formatToParts` (`wallClockIn`) instead — the likely
  fix shape.
- **Resolve via:** re-implement `formatFacilityTime` / `formatFacilityDate` on
  `wallClockIn`-style `formatToParts` output, then pin it with a regression test
  run under a process zone that skips the rendered wall clock (S).

### Should CERT-field rules vary by pinned protocol version? (`certification/version-flexible-cert-fields`)

- The project is pinned to Biochar Production and Storage **v1.1** + Isometric
  Standard **v1.7** (Certify project settings), while the registry's latest
  certified line is v1.3 + Standard v2.1. `CERTIFY_FIELD_REGISTRY`
  (`src/lib/certification/certify-field-registry.ts`) is version-agnostic.
- Verified 2026-07-27 against registry content: for transport evidence the
  versions are identical (both run on Transportation module v1.1 — same per-leg
  required records, same mapped-distance allowance; delivery proof-of-delivery
  lives at v1.1 §8.3.1.1/§8.3.1.2 vs v1.3 §8.4). The first real divergence is
  the per-handoff custody-documentation clause (soil-environments v1.3 §8.8),
  which has **no counterpart** in agricultural-soils v1.1 — that, plus the
  dropped `custody_handoffs` table (migration 0037), becomes a genuine P0 only
  on a v1.2+ upgrade.
- Complication: Standard v1.7 mandates minor-version adoption "at the following
  verification", Standard v2.1 abolishes forced upgrades until crediting-period
  renewal. Which regime binds this project needs confirmation from Isometric.
- **Resolve via:** ask Isometric which Standard governs upgrades for this
  project; defer version-keyed registry entries until a concrete v1.2+ adoption
  date exists, then key new-in-version requirements (custody handoffs) on the
  pinned version (M).

### Storage board cannot sort bins by on-hand mass (`storage/sort-by-on-hand-mass`)

- The board's sort control (`BIN_SORT_OPTIONS` in
  `src/components/storage-locations/bin-display.ts`) offers only keys that
  resolve in SQL before LIMIT/OFFSET, so the order it shows holds across pages.
  "Most/least on hand" is missing from that list, and it is the sort an operator
  asks for first when deciding where to put a delivery.
- It is missing because on-hand mass is not a column. `binCurrentMassKg` reads
  the enriched row, and that enrichment runs **after** pagination: feedstock and
  biochar stock come from `deriveLaneStock` (several aggregates over feedstocks,
  production runs, production-run feedstocks, biochar products and bin
  movements), and product stock additionally subtracts delivered mass. Sorting
  on it means replicating all of that inside the paginated query.
- Sorting the page in the client is not a substitute: it would order the twenty
  rows already fetched, so a nearly-full bin on page 3 would never rise to
  page 1. The board deliberately does no client-side re-sort for this reason.
- `lastActivityAt` shows the tractable shape of the fix — a correlated scalar
  subquery in `src/data-access/storage-location-activity.ts`, pinned by
  `tests/storage-location-activity-sort.test.ts`.
- **Resolve via:** express per-bin on-hand mass as one correlated subquery (or a
  materialised per-bin stock view) that `getStorageLocations` can ORDER BY, then
  add the option and extend the activity-sort test to cover it (M).

### Report-document attachment is check-then-insert (`certification/attach-report-document-race`)

- `attachReportDocument` (`src/data-access/certification.ts`) dedupes by
  selecting an existing `documents` row for the same
  `(organizationId, entityType, entityId, fileUrl)` before inserting, so two
  concurrent submits of the same external report URL can both miss and write
  duplicate ledger rows.
- The obvious fix is a unique constraint on that tuple plus
  `onConflictDoNothing`. It is deferred because `documents` is shared by the
  entity workflows and the generic `createDocument` path: constraining it would
  also stop an operator attaching the same external URL twice to one entity
  with different descriptions, which no one has asked for.
- Impact today is a duplicate ledger row on an org-admin-gated, rate-limited
  action; the generated-report path does not go through this function at all,
  since it reuses the report's own `documentId`.
- **Resolve via:** decide whether same-URL-per-entity duplicates are ever valid
  for any document type. If not, add the partial unique index (`fileUrl is not
  null`) and switch the insert to an upsert (S).

### Reconciled production batches are claimed on the supplier reference alone (`certification/production-batch-remote-drift`)

- `ensureProductionBatchesForCreditBatches`
  (`src/fn/certification/production-batches.ts`) claims an orphaned remote
  Production Batch when `findProductionBatchBySupplierRef` matches the stable
  `nm-ptb-…` reference, then journals the LOCALLY computed mass, window and
  payload hash. Facility, feedstock types, kind, dates and mass on the remote
  record are never compared, so a remote record created from different figures
  is adopted as if it matched.
- The same asymmetry applies after registration: drift between the registered
  payload and current local data is recorded as a sync event and logged, never
  applied, because `POST /production_batches` has no PATCH counterpart (verified
  against the Certify OpenAPI snapshot: `/production_batches` exposes GET/POST,
  `/production_batches/{id}` GET/DELETE only).
- Deferred rather than fixed because the only remedies are a remote-vs-local
  payload diff on every reconcile (a reconciliation engine for a path that
  fires on crash recovery), or DELETE-and-recreate, which discards a registry
  record verifiers may already reference.
- **Resolve via:** decide whether a mismatched remote Production Batch should
  block submission and be resolved by hand in Isometric, or be re-created after
  a DELETE. If blocking, compare the reconciled record's mass/window/facility
  and surface a conflict instead of claiming it (S).

### A zero-dry-mass chain passes every readiness surface and fails only at the registry POST (`certification/zero-dry-mass-late-gate`)

- Verified on staging 2026-08-05 (issue #630 negative case): a production run
  completed with 100 kg wet biochar at 100% moisture (0 kg dry) flows through
  product creation, delivery, application ("Ready"), the credit batch's "All
  batch data checks passed", and the pre-submit review's "Ready to submit,
  9 checks passed" — which simultaneously displays "You are sending 0.0 t".
- The only gate is `buildCreateProductionBatchRequest`
  (`src/lib/isometric/production-batches.ts`), whose `totalDryMassKg <= 0`
  branch fails the "Sending durability measurements" step with an actionable
  operator message. Fail-closed held: no ProductionBatch and no Removal reached
  the registry. But the gate fires AFTER the 15 monitored-input datapoint POSTs
  succeeded, so a refused submission leaves orphan datapoints in the registry.
- Root enabler: run completion validates positive WET output only
  (`complete-output-required` in `src/lib/production-runs/lifecycle.ts`) and a
  moisture of 100% is accepted, so 0 kg dry is legally reachable. The
  `runsMissingDryMass` (NULL dry mass) branch in
  `buildProductionBatchSubmission` (`src/fn/certification/production-batches.ts`)
  is unreachable from the UI — batch
  membership requires `complete` runs and `complete` requires wet output — so
  that branch is defence-in-depth only.
- **Resolve via:** decide which layers should also know. Candidates, roughly
  independent: (a) a readiness/pre-submit check that every member run has dry
  mass > 0, so the 9-check review catches it; (b) bound moisture below 100 or
  require dry mass > 0 at run completion; (c) run the pure production-batch
  payload validation before any datapoint POST so a refused submission leaves
  zero registry residue (S each).
