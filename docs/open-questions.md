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

## Invariants an LLM must not violate

Short, load-bearing rules that this file's entries assume. Each is enforced in
code today; breaking one compiles cleanly and fails silently.

- **Data-access guard contract.** Every `src/data-access/` function takes
  `ctx: OrgContext` as its first argument, calls `requireOrgScope(ctx)`, and
  filters every query on `eq(table.organizationId, ctx.organizationId)`.
  Cross-entity references go through `assertSameOrg(ctx, table, id, executor)`.
  `src/data-access/utils.ts` is the source of truth; `requireAuth()` is an
  **auth**-layer helper (`src/lib/auth/server.ts`) and appears in **zero**
  data-access modules. Writing a new accessor with `requireAuth()` and no org
  filter silently leaks across organizations. See
  [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md) and
  [`docs/organization.md`](./organization.md). Intentional cross-org reads are
  marked with an `// org-scope-ok:` comment (e.g. `getPublicDocumentById`).
- **`assertSameOrg`'s `executor` is a pool-starvation invariant, not an
  optimization.** A caller inside a transaction MUST pass its `tx`; reading
  through the global pool from inside an open transaction holds one connection
  while waiting for another, and starves the pool under parallel load. This is
  the same failure the `storage/sources-sync-events-tx` entry below band-aided
  with `DB_POOL_MAX=10`. Applies to every tx-scoped read, not just this helper.
- **`transport_legs.tripType` defaults to `'return'` and is credit-bearing.**
  `roundTripDistanceFactor` in `src/lib/isometric/utils/aggregation.ts` applies
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
  ([`docs/qa/2026-07-15-qa-staging-production-chain.md`](./qa/2026-07-15-qa-staging-production-chain.md), S3)
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

- **Deferred from issue #309** (samples re-anchored on credit batches — built).
  The issue also asked for parsing an uploaded COA/lab-report PDF to pre-fill
  the sample form's chemistry fields.
- **Why it matters:** ~30 numeric fields transcribed by hand from the lab
  certificate; transcription errors feed certified carbon figures directly.
- **To resolve:** decide extraction approach (LLM vs. per-lab templates),
  confidence/review UX (never silently overwrite operator entries), and where
  parsing runs (server action + storage provider, [`docs/storage.md`](./storage.md)).
  The upload slot already exists (`lab_report` on the sample's Evidence step).

### Validate production-run window ⊆ credit-batch period (`production/run-window`, opened 2026-07-01)

- **Deferred from the readings-CSV work (issue #207).** A run may span days, but
  its `start_time`/`end_time` window should not extend beyond its credit batch
  (the protocol production batch — [ADR 0016](./adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)).
  No cross-entity check exists; both timestamps default to `now()`.
- **Why it matters:** the readings importer clips telemetry to the run window,
  so readings can't escape a run — but nothing stops a run's window from
  exceeding its batch period, letting telemetry land outside the batch it
  certifies.
- **To resolve:** decide where the run↔batch link is authoritative, then bound
  it in `src/schemas/production-runs.ts` + `src/fn/production-runs.ts`.

### White-label dashboards per Organization (`tenancy/white-label`, opened 2026-06-11)

- **Deferred (2026-06-11 multi-tenancy grilling):** at launch each Organization
  gets the org-scoped app with its name/logo in the chrome — no per-org
  subdomains, theming, or branded invitation emails.
- **To resolve:** revisit on client demand; scope is wildcard domain routing,
  per-org theme tokens, branded Resend templates
  ([`docs/mail-setup.md`](./mail-setup.md)).

### Documents are org-scoped but not entity/facility-narrowed (`security/document-authz`, opened 2026-06-15)

- **Current behavior:** `getDocumentById` / `updateDocument` /
  `setDocumentVisibility` / `assertCanManageDocumentEntity`
  (`src/data-access/documents.ts`) all take `ctx: OrgContext`, call
  `requireOrgScope(ctx)`, and filter on `documents.organizationId`;
  `assertCanManageDocumentEntity` re-checks the owning entity's
  `organizationId` across all document-bearing entity types. **Cross-org reads
  are refused**, including via the `/api/documents/[id]` presigned-download
  redirect.
- **Still open:** *intra-org* narrowing. Any member of an organization can read
  any private document in that org by UUID, without proving access to the
  owning `(entityType, entityId)` — no per-user facility membership exists (see
  `security/facility-membership` below). The `visibility: public | private`
  column encodes an intended boundary that org scoping alone doesn't enforce.
- **To resolve:** fold document reads/mutations through a facility/entity-scoped
  check once membership lands. A `createdBy`-only stopgap is too tight —
  operators share documents on shared entities. Implement the `it.todo` negative
  tests in `tests/documents-authz.test.ts` against the scoped helper.

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

### Multi-hop biochar transport — intermediate storage (`transport/multi-hop-distribution`, opened 2026-06-11)

- **Current model:** a biochar product carries exactly ONE auto-derived
  distribution leg (facility → delivery destination), aggregated from its
  deliveries (mass-weighted distance, `transport_legs`
  one-derived-per-entity invariant). Matches Dark Earth Carbon's flow. The
  manual "biochar → storage" leg editor was removed from the product sheet (it
  predated derivation and invited rows the resync didn't own).
- **Question:** how to model orgs that truck biochar to an intermediate
  storage/depot first — two or more real legs per product with different masses
  per hop, which the single-derived-leg invariant can't represent. The live
  Certify template's `biochar-transport` component takes one distance + mass
  pair per removal, so submission-side needs either per-hop Σ(dist×mass) folded
  into one equivalent leg, or a template change.
- **To resolve:** wait for an org with intermediate storage; then choose (a)
  multi-leg derivation with hop ordering, folded into one equivalent
  distance×mass for Certify, or (b) per-hop components in the removal template.
  Touches `aggregateDistributionLegs`, the one-derived-per-entity index, and the
  batch readiness transport gate.

### Additional storage locations — keeping the dMRV flexible (`transport/storage-topology`, opened 2026-06-11)

- **Question:** how does the dMRV stay correct when an org adds a second storage
  location? Parts of the flow hard-code a single facility-anchored topology:
  - derived transport legs use the **facility** (name + GPS) as the biochar
    origin — the storage location a product actually sits in never enters the
    route;
  - the live template's `biochar-transport` component assumes one
    facility → destination hop (see the multi-hop entry above);
  - `biochar-storage` emissions (template group currently empty) would need
    per-location attribution if storage sites with different energy/fuel
    profiles appear.
- **Why it matters:** a second storage site silently changes real transport
  distances and storage emissions without changing anything the derivation
  reads, so submitted numbers drift from reality.
- **To resolve:** decide whether storage locations get GPS + distance provenance
  and enter leg derivation (origin = the product's bin location), and whether
  storage-site transfers become first-class custody events in the trail.

### Split `src/db/seed-data.ts` into domain seed modules (`db/seed-modularization`, opened 2026-06-11)

- **Problem:** `seed-data.ts` is 1814 lines — the only non-generated file in
  `src/` over the 1000-line cap — and grows as each new domain appends its block
  to the single transaction.
- **Note the lint exemption:** `eslint.config.mjs` lists
  `src/db/seed-data.ts` in the `ignores` array alongside the generated Isometric
  types, so `max-lines` will **never** flag it. Removing that exemption is part
  of this work; nothing else will surface the file.
- **To resolve:** extract per-domain modules (e.g. `src/db/seeds/transport.ts`
  exporting `createTransportLegsSeed(tx, ids)`) and leave `seed-data.ts` a thin
  orchestrator. Mechanical but touchy — the blocks share the `ids` map — so do
  it as a dedicated refactor PR (M).

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

### Application evidence-readiness: two implementations, one taxonomy (opened 2026-07-20)

- **Problem:** the list badge / dashboard evaluate application visual-evidence
  gaps via `applicationEvidenceGapCountSql` (raw SQL, folded into
  `deriveEntityCertifyReadiness`), while the certify wizard evaluates the same
  concept via `buildApplicationEvidenceGaps`
  (`src/fn/certification/application-evidence-readiness.ts`, async TS). They
  share only the `application-evidence` constants (roles / geotag predicate),
  not the evaluation path — unlike production-run / sample / transport, which
  both route through `deriveEntityCertifyReadiness`.
- **Why it matters:** issue #246's contradiction (list "Ready", wizard blocked)
  is closed because both surfaces now fail-closed, but the duplicated logic is a
  live drift risk. E2E `application-readiness-evidence.spec.ts` guards only the
  badge side; nothing asserts badge/wizard *agreement*, so a future divergence
  in one predicate would reintroduce #246 undetected.
- **To resolve:** either (a) route `buildApplicationEvidenceGaps` through the
  same shared source as the badge (true unification), or (b) add a regression
  test driving the wizard's gap computation against the same seeded application
  the badge test uses. (b) needs the full ready-batch / certifier-mapping setup
  the wizard spec currently deems too fragile for CI, so (a) is likely cheaper (M).

## Isometric Certify integration

### Template component → dmrv source mapping is hardcoded by display name (`certification/template-component-source-wizard`, opened 2026-07-04)

- **Decision needed** — where should the "this template component carries this
  dmrv aggregated source" mapping live? Today it's a code constant
  (`PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT` in
  `src/lib/isometric/transformers/datapoint.ts`), keyed by component **display
  name**, because Certify's template model exposes no stable per-component key.
  It only bites when one `(group, blueprint, input)` triple is declared by more
  than one component — currently just the pyrolysis generator/startup diesel
  split.
- **Why it matters** — a display-name rename in the Isometric UI silently
  requires a code change. It fails closed with a clear `SafeError` (so it can't
  mis-submit) but blocks the submit until code catches up, coupling the registry
  template to a deploy that a non-engineer operator can't do.
- **To resolve** — a facility-configurable component→source mapping (persisted
  on the certifier mapping row) plus a small assignment wizard in facility
  settings; the code constant becomes the seed/default. Scope it when a second
  multi-component triple appears.

### Eq.6 R₀-term semantics — 1000-year F_durable normalization (`certification/fdurable-1000-r0-semantics`, opened 2026-07-03)

- **From issue #142.** The storage module ("Biochar Storage in Soil
  Environments" v1.2, Eq.6 §5.1.1.3.2) is internally inconsistent about the
  units/semantics of the first Eq.6 factor: the formal glossary defines R̄₀ as a
  mean of R₀ measurements in **percent**, but the narrative ("credited for the
  percentage of their biochar which passes the 2% R₀ benchmark") implies the
  histogram **fraction of R₀ measurements ≥ 2%** (0–1). The two readings are
  dimensionally incompatible with the 0.95 cap.
- **Local choice (preview only):** `computeFDurable1000`
  (`src/lib/calculations/biochar-removal.ts`) applies Eq.6 literally to the
  stored batch columns, with the mandatory `min(0.95, max(0, …))` bounds. The
  interpretation is documented at the function. The registry computes the
  authoritative F_durable at submission, so this is a preview — but a wrong
  reading shows operators a misleading crediting estimate.
- **The live path follows the blueprint, not Eq.6.**
  [ADR 0021](./adr/0021-durability-tier-is-facility-scoped.md) is authoritative:
  the `biochar_sequestration_1000_year` blueprint resolves the ambiguity in
  favour of the narrative reading and has neither a non-reactive-carbon factor
  nor the 0.95 cap, so it **diverges from module Eq.6**. The blueprint is what
  runs; `computeFDurable1000` stays the local preview.
- **Still open — needs Isometric staff sign-off:** which of Eq.6 vs. the
  blueprint governs verification credit, and total-vs-organic carbon for
  `carbon_contents`. Authoritative module:
  <https://registry.isometric.com/module/biochar-storage-soil-environments/1.2?tag=1.2.0>.
  Record the answer in [`docs/isometric/changes.md`](./isometric/changes.md).

### Credit-batch lab-sampling — Method-B Track 2 unlock followups (`certification/method-b-unlock-track-2`)

- **[ADR 0017](./adr/0017-method-b-unlock-registry-computes-noma-gates-and-previews.md)
  Track 2 shipped** (PR #301): explicit Method-B unlock (`unlockMethodBForProcess`)
  with prerequisite capture, the μ−σ/√n unsampled estimate preview
  (`previewUnsampledCarbon`, 6-month eligible pool), compliance-drift counters,
  `_unsampled` submission routing, the process-grain **DB trigger backstop**
  (migration `0060`, replacing the dropped `0052` reactor trigger, counting only
  the pre-unlock baseline), and the operator surface under the registry-gated
  `/certification/production-processes`.
- **Still gated:** the live `_unsampled` submission POST stays behind
  `DURABILITY_MEASUREMENT_SAMPLES_LIVE` (wire format unconfirmed); the preview
  does NOT winsorise (the registry's 3σ winsorisation over the eligible pool
  remains the registry's authority,
  [ADR 0013](./adr/0013-registry-computed-durable-fraction.md) / D1).
- **Gate shape to settle before activation:** Method-B cadence is a
  production-process history rule, not just the removal member-batch subset. The
  live gate should load the full process batch window or accept an explicit
  process-level cadence fact.
- **Decided 2026-07-12** (regime boundary, `established_at` semantics,
  submitted-evidence lock): recorded as ADR 0017 amendments; verification
  narrative in
  [`docs/archive/qa/2026-07-12-final-12-month-followup.md`](./archive/qa/2026-07-12-final-12-month-followup.md).
  The evidence-snapshot enforcement for the submitted-evidence lock is still
  unbuilt (#200/#391).
- **Needs Isometric confirmation before the 1000-year unsampled route is built
  or enabled:** the exact `_unsampled` registry wire contract. The working
  product expectation is to reuse the trailing eligible historical sample
  pool/average rather than require three new 1000-year replicates per unsampled
  batch — but noma must not invent the submitted representation.
- **Needs protocol confirmation:** whether independent/distributed sampling is a
  hard eligibility gate or an operator warning. Synthetic same-day rows must not
  be treated as proof in QA either way.
- **Version dependency:** ADR 0017 cites biochar protocol 1.3 while the local
  pin remains 1.2; coordinate under #278 before encoding more credit-bearing
  Method-B logic.
- **Why it matters:** DEC runs Method A everywhere today, so Track 2 blocks
  nothing current. Do not enable Method B until the activation path and
  submission gate are process-grain end to end.
- **Watch:** entangled with ADR 0013 and issue #291 (template-driven remodel) —
  coordinate so the submission layer isn't double-built.
- **ADR-number hygiene:** ADR 0017 refines ADR 0016; keep sampling/credit-batch
  references on ADR 0016 unless they specifically describe the Method-B unlock.

### Method-B compute — tracked cleanups on the process-grain surface (`certification/method-b-compute-cleanups`, opened 2026-06-20)

Low-priority consolidations on the Track 2 surface (PR #301 review), deferred so
they don't churn a freshly-introduced surface mid-review:

- **`sampleMeanStdDev` ⇄ `meanAndStdDev` convergence.**
  `src/lib/calculations/stats.ts` is a knowing near-duplicate of the private
  `meanAndStdDev` in `src/lib/isometric/utils/durability-aggregation.ts`. The
  aggregation copy can collapse onto the client-safe `stats.ts` helper once its
  server-coupled neighbour (`./aggregation`) is untangled from the client-safe
  path.
- **O(n²) leave-one-out in `countSubThreeSigmaMeasurements`.** It recomputes
  `sampleMeanStdDev` over a fresh `filter` array per element. Fine for a 6-month
  window pool; if pools grow, compute the leave-one-out mean/variance
  analytically in O(n) from running sums.

### Evidence-ledger font tracing — verify on first deploy (`isometric/evidence-ledger-font-tracing`, opened 2026-06-19)

- The evidence-ledger PDFs (transport mass·distance and 200-year durability —
  both auto-generated and mirrored as Sources on every Removal submit) render
  with bundled DM Sans/Mono TTFs read at runtime via a dynamic `process.cwd()`
  path (`src/lib/certification/evidence-ledger/fonts.ts`, shared via
  `registerEvidenceLedgerFonts`). Next's static tracer can't follow a dynamic fs
  path, so the TTFs are pulled into the serverless bundle by
  `outputFileTracingIncludes` in `next.config.ts` (broad `"/**"` key, since the
  submit action bundles under several routes). The glob is directory-wide, so it
  already covers the durability renderer.
- **Why it matters:** serverless file-tracing can't be exercised locally. If the
  glob misses, the renderer throws `ENOENT` at submit time — and because ledger
  generation is best-effort (try/catch in `submitRemoval`), the failure is
  **silent**: the submit succeeds but no ledger Source is attached. A wrong
  trace config looks like "working" until someone notices removals have no
  ledger.
- **Narrowed, not closed:** the dev-runtime render + full
  generate→store→mirror→`source_ids` flow is verified in-process against the
  seeded sandbox. The remaining risk is *the serverless file-tracing path
  specifically* — local dev does not bundle.
- **Resolve via:** on the first staging deploy, run a real submit and confirm a
  `transport_evidence_ledger` document + Source is created (check the removal's
  sources, or the structured log line `generated evidence ledger`). The
  durability ledger shares fonts + render path, so a passing transport render
  confirms both. If absent, inspect the function bundle for the `.ttf` files and
  tighten the trace key to the actual submit route(s). Record the outcome in
  [`docs/isometric/changes.md`](./isometric/changes.md) and remove this entry (S).

### Durability measurement-samples — sandbox confirms before live wiring (`isometric/durability-measurement-samples`, opened 2026-06-18)

**The whole surface is behind `DURABILITY_MEASUREMENT_SAMPLES_LIVE`**, which
`src/config/env.ts` defines as an optional flag *plus* a cross-field refinement
rejecting it whenever `ISOMETRIC_ENVIRONMENT !== "sandbox"` — i.e. it is a
sandbox-only kill-switch that cannot be enabled against production. Do not
remove this entry until the flag is retired after the operator runs the confirms
below; at the same cutover, delete the stale `carbon_rich_substance_sequestration`
`INPUT_MAPPING` entry (see the Phase 3 note).

- **Tier-1 Phases 1–5 built + committed** — the run → credit-batch re-grain, the
  facility reference soil-temp field, the staged measurement-samples submission
  step, the durability evidence-ledger PDF, and the two UX surfaces (lab-sample
  batch progress + credit-batch durability panel).

- **1000-year extension (ADR 0021).** The durability tier is facility-scoped;
  DEC (Moshi) is 1000-year. Recognition + guard plumbing is built and has passed
  an end-to-end **sandbox** removal submit — the live POST remains gated:
  - `biochar_sequestration_1000_year` is in `SEQUESTRATION_BLUEPRINT_KEYS`;
    `resolveTemplateInputs` skips the whole sequestration **family**
    (`isSequestrationBlueprintFamily`), so a 1000-year template reaches the
    staging gate instead of throwing a misleading "no INPUT_MAPPING entry".
  - `submitRemoval` validates the template's sequestration blueprint against the
    facility tier (`expectedSequestrationBlueprintKeys`) and fails closed early
    on a mismatch.
  - `build1000YearSequestrationSample`
    (`src/lib/isometric/transformers/measurement-sample.ts`) builds the
    blueprint inputs (per-replicate `carbon_contents` + `s_fraction` LISTs +
    `product_mass` SCALAR — **no** local mean/−SE/cap; the registry reduces).
  - **`s_fraction` data model:** stored per Sample as
    `samples.s_reflectance_fraction` (ISO 7404-5 inertinite fraction —
    proportion of that sample's R₀ readings ≥ 2%). Captured as a percentage,
    stored/submitted 0–1 (see the invariants section). Sandbox accepted
    `dimensionless_ratio/inertinite_fraction`; `carbon_contents` was accepted as
    total carbon with `mass_fraction_dry_basis/total_carbon`.

- **Grill-with-docs resolution (2026-06-19).** Stress-tested against ADR 0013 /
  ADR 0016 and the authoritative protocol (biochar 1.2 §8.3.1; soil module 1.2
  §5.1.1.3.1, both re-verified via the isometric MCP). Full phased plan +
  sandbox-parameterised checklist:
  [`docs/plans/2026-06-19-tier1-durability-live-wiring.md`](./plans/2026-06-19-tier1-durability-live-wiring.md).
  Decisions locked:
  1. **Re-grain run → credit batch (root issue).** Durability gates,
     aggregation, measurement-sample builders, and the COA candidate-document
     walk all read `run.samples`, but ADR 0016 re-pointed lab samples to
     `creditBatchId`. Lab chemistry is therefore invisible to the durability
     surfaces — re-grain to the **credit batch** before the live POST.
  2. **Sample model:** enter a Sample against **one production run**
     (provenance); **account at the credit batch** (pool ≥3 → mean + std-dev).
     The ≥3 are **independent samples distributed across runs/days** (§8.3.1),
     not aliquots; hard-gate the count, **warn** if not distributed.
  3. **Submitted shape:** one measurement-sample submission per credit batch
     carrying the batch's **mean + std-dev** (raw ≥3 evidenced by COA +
     durability ledger); the registry means the per-batch list.
  4. **Soil temperature:** an operator-declared **facility-level reference
     value** (global DB, e.g. Lembrechts 2022; 7 °C floor), justified in the
     PDD; per-application temps become a future override.
  5. **COA:** the `lab_report` on each Sample via the existing document→Source
     mirror (re-grain the walk to gather by credit batch); D4 gate at batch grain.
  6. **INPUT_MAPPING:** delete the stale `carbon_rich_substance_sequestration`
     entry; carve the two `biochar_sequestration_200_year_*` components out of
     the legacy datapoint loop into the measurement-samples step. `_unsampled`
     (Method B) is an **inert** seam — no estimate math.
  7. **Scope grew (accepted):** a durability evidence-ledger PDF reconciling raw
     replicates → submitted mean+std-dev + soil-temp reference, plus two UX
     surfaces (lab-sample create form with single-run ref + live credit-batch
     sample count; credit-batch sample list/aggregation view).

- **Phase 3 staged.** The measurement-samples step is built and wired into
  `runRemovalSubmission`, gated in
  `src/fn/certification/durability-measurement-samples.ts`. With the flag off,
  `submitRemoval` hard-blocks any template declaring a
  `biochar_sequestration_200_year_*` component with a "staged, not yet live"
  `SafeError`; `resolveTemplateInputs` + `buildCreateGhgEntryRequest` skip those
  components.
  - **DEFERRED — delete at the live-flip cutover:** decision #6 said to delete
    the stale `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry *now*.
    It is **load-bearing on the still-live old-template carbon path** —
    referenced by 5 tests (`isometric-submit-removal`, `registry-boundary-removal`,
    `period-input-tuples`, `isometric-transformers`, `isometric-sources`) and by
    two `tuple(…)` descriptors in `certify-field-registry.ts`. Deleting it while
    the new path is gated breaks working tests for zero functional gain.
    **Decision: keep it until the live flip**, then delete the entry + the two
    field-registry tuples (`biocharOutputKg`→`product_mass`,
    `organicCarbonPercent`→`carbon_content`) and retarget the 5 tests.

- **Two sandbox-empirical confirms still gate the LIVE submit.** The
  measurement-sample bodies, the HTTP wrappers
  (`src/lib/isometric/measurement-samples.ts`), and the per-batch durability
  aggregation are done and unit-tested; what remains needs the operator's
  `pnpm isometric:coverage-check -- --source=db` against the sandbox
  (interactive 1Password — an agent can't run it).
  1. **Datapoint↔component-input binding.** How a
     `biochar_sequestration_200_year_*` blueprint input references the
     measurement-sample datapoints — auto-link by measurement type/property vs.
     an explicit `datapoint_id` reference. Not modelled yet.
     *Doc evidence leans explicit reference:* `user-guides/certify/datapoint-sharing`
     describes a datapoint being created and then "used as an input to multiple
     components" (an explicit sharing act). Type+property identify *what* a
     datapoint measures but don't bind it to a blueprint input. Confirm the exact
     field against the `post-datapoint`/component schema in `certify.d.ts` or
     the live sandbox.
  2. **H/C unit transform.** The blueprint declares `h_c_molar_ratios` in `%`
     while samples store a dimensionless molar ratio (~0.5);
     `toHcMolarRatioPercent` applies ×100 as the most likely transform.
     *Doc evidence leans dimensionless, NOT %:* the Certify measurement-samples
     reference lists the Biochar→Production batch **H:C** property as quantity
     kind `DIMENSIONLESS_RATIO` / qualifier `HYDROGEN_TO_ORGANIC_CARBON_RATIO`,
     and `biochar-storage-soil-environments` 1.2 §3 Table 2 evaluates the molar
     H/C_org ratio as a dimensionless *Ratio* (threshold < 0.5). This suggests
     the ×100 transform is likely **wrong**. Still verify against the live
     template's blueprint *input* unit declaration before flipping — the module
     doc covers the science, not the platform input declaration.

  Neither doc finding closes the gate; both are sandbox-empirical.

- **Also gated to the live wiring:** the `total_carbon_contents` /
  `inorganic_carbon_contents` / `product_mass` datapoint construction + binding,
  the COA/lab-report Source behind the chemistry datapoints (D4), and recording
  the conservative soil-temp method string on the `biochar_soil` datapoint (the
  `CreateMeasurementSampleRequest` body has no description field).
- **Snapshot-back the measurement-sample bodies before the flip (resume
  coherence).** The gated step in `runRemovalSubmission` rebuilds the
  measurement-sample submissions from live `durability.batches` every attempt,
  whereas `transport.datapointBodies` and the fixed bindings come off the
  claimed row snapshot on resume. Inert while gated, but once live a resumed
  claim could reconcile a stale body or POST changed live chemistry under the
  prior version. Persist the built submissions into the payload snapshot and
  read them back on resume — same pattern as `transport.datapointBodies`.
  (Surfaced in PR #297 review.)
- **Why live submit is already fail-closed:** the legacy
  `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry references a
  blueprint the operator deleted when re-authoring the template (expected
  mid-migration; not-live, no prod data).
- **Resolve via:** run the coverage-check, confirm (1) + (2), wire the live path
  in `submit-removal.ts` (blueprint selection via
  `selectSequestrationBlueprintKey`, D6), replace the stale `INPUT_MAPPING`
  entry, then close this entry and record the decision in
  [`docs/isometric/changes.md`](./isometric/changes.md). Plan:
  [`docs/archive/plans/2026-06-18-200yr-durability-submission-and-sampling-method-enforcement.md`](./archive/plans/2026-06-18-200yr-durability-submission-and-sampling-method-enforcement.md)
  (§6 Phase E), [ADR 0013](./adr/0013-registry-computed-durable-fraction.md).

### Ambiguous-lookup rejection records no failed sync event (`isometric/ambiguous-lookup-audit-silence`, opened 2026-06-10)

- **When a registry create's reconcile lookup finds MULTIPLE candidates** (today
  only reachable for GHG Statements — several DRAFT statements for one
  `(project, end_on)`), `performRegistryCreate`
  (`src/fn/certification/registry-create.ts`) rejects the ledger row and throws
  the caller's ambiguity message **without writing a failed sync event**.
  Deliberate Phase 2 parity with the pre-module GHG behavior.
- Not blind: the reason survives in the ledger row's `metadata.lastError` and
  the row status flips to `rejected`. But the statement's
  `certifier_sync_events` timeline just stops — the detail panel's "recent sync
  events" list shows nothing for the failed attempt.
- Phase 3's boundary test pins current behavior by assertion
  (`tests/registry-boundary-ghg-statement.test.ts`) with a pointer here — flip
  that assertion when this is resolved.
- **Resolve via:** decide whether ambiguity should append a `status: "failed"`
  sync event (operation `ghg_statement:create`, errorMessage = the ambiguity
  wording, no response body). One-line change in `reconcileToResult` plus the
  pinned assertion; no migration.

### GHG Entry API rename — September 2026 sunset cleanup (`isometric/ghg-entry-migration`, opened 2026-06-10)

- **Migration landed.** noma calls the `ghg_entry` route family; the regen
  pipeline points at the docs-hosted Certify spec. Full inventory + phased plan:
  [`docs/plans/2026-06-10-isometric-ghg-entry-migration.md`](./plans/2026-06-10-isometric-ghg-entry-migration.md).
- **Sunset CONFIRMED ~September 2026** (issue #353). What remains post-sunset:
  (a) regenerate `certify.d.ts` — the deprecated `Removal*` schemas and the
  `GhgStatement.removal_ids` / `Component.removal_template_component_id` keys
  disappear, so the test mocks still carrying both old+new fields
  (`isometric-reconciliation.test.ts`, `isometric-ghg-statement-flow.test.ts`,
  `isometric-ghg-statement-submit.test.ts`) drop the deprecated keys; (b) delete
  the 🚫-marked deprecated rows from
  [`docs/isometric/openapi-index.md`](./isometric/openapi-index.md). No app-code
  change expected — the wire layer only calls new routes.
- **Domain term "Removal" is RETAINED** (stakeholder decision): the
  `Removal → GhgEntry` *domain* rename floated in
  [ADR 0014](./adr/0014-credit-batch-as-production-cohort.md) is **decided
  against**. Only the wire layer uses `ghg_entry*`; routes, UI, tables, and
  `CONTEXT.md` keep "Removal" as the canonical submission-unit term.
  `submissions.test.ts` guards that no deprecated `/removals` or
  `/removal_templates` calls remain.

### GHG entry / statement free-field follow-ups (`isometric/ghg-entry-free-fields`, opened 2026-06-10)

The migrated surface returns fields noma does not yet capture — new capability,
not a blocker:

- **Credit allocation / buffer pool.** `GhgEntry` + `GhgStatement` expose
  `risk_of_reversal_percentage` and `credit_allocation`
  (`buffer_pool_contribution_kg` / `supplier_allocation_kg`). Surfacing the
  split is new UI. Relates to the dropped `reversal_risk_assessments` table.
- **Reporting-period readback.** `GhgStatement.reporting_period_start_at` /
  `_end_at` are returned; reading them back can fix the reconciliation gap where
  the statement wizard's "predicted to be linked" preview over-promises against
  Isometric's server-derived period.
- **Source `description`.** Optional human-readable label now accepted on
  `POST /sources` / `PATCH /sources/{id}` (we pass the `Undefined` sentinel).
  Wire it when the Sources panel grows a label.

### Per-user facility membership within an organization (`security/facility-membership`, opened 2026-06-18)

The only surviving question from the 2026-06-18 authz audit. Org isolation
itself is **built and enforced** — see the invariants section,
[ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md),
[`docs/organization.md`](./organization.md), and the `tests/e2e/org-isolation.spec.ts`
/ `tests/e2e/organization-settings.spec.ts` specs. What does not exist is a
"user X may access facility Y" check *inside* an org.

- **Consequence:** any member of an org can drive irreversible Isometric writes
  against any facility **in that org** by id — `submitRemovalAction`,
  `submitTelemetryAction`, `createGhgStatementDraft`,
  `submitGhgStatementToVerifier`, `refreshGhgStatementStatus`,
  `createRemovalWithBatchesAction`, and the certifier-removal accessors in
  `src/data-access/certifier-removals.ts`. Acceptable while an org is one
  operator team; a decision is needed before an org onboards a second,
  mutually-untrusted facility operator.
- **The durable lesson (do not regress):** a server action must resolve the
  facility from the **anchor row**, never from a client-supplied field. The
  shipped seam `resolveSubmissionFacilityId` / `assertSubmissionInFacility`
  (`src/data-access/certification.ts`) does exactly this, and the id/key-addressed
  reads take an optional `expectedFacilityId`. It is defence-in-depth +
  fail-closed on a dangling anchor, **not** an access check — every wired caller
  derives the expected facility from the same anchor id it is reading. Detail:
  [`docs/archive/2026-07-09-certification-submit-facility-scope-partial-fix.md`](./archive/2026-07-09-certification-submit-facility-scope-partial-fix.md).
- **Not wired to that seam:** `submitRemovalAction` and
  `createRemovalWithBatchesAction`; the three admin mapping/emission actions
  stay on `requireAdminAction()` (platform-global, see
  [`docs/auth.md`](./auth.md)).
- **Resolve via:** build a real `requireFacilityAccess(ctx, facilityId)` first
  (do not wire calls to a missing helper), then gate every
  removal/statement/telemetry/mapping/emission accessor on the *resolved*
  facility, scope the three admin actions, and audit all `localEntityId`
  accessors in `certifier_sync_events` for the same shape. Also swap
  `resolveEntityFacility` (`src/data-access/transport-legs.ts` — the polymorphic
  parent-chain walk that already closed the orphan-mutation hole) for the new
  helper at that one chokepoint, then propagate. Formalizes pre-deploy gate #3
  in [`docs/isometric/integration-plan.md`](./isometric/integration-plan.md).
- **Pattern to copy:** `mirrorDocumentToSource` / `unlinkDocumentSource` enforce
  a forgery-proof document→removal lineage anchor
  (`assertDocumentIsCandidateForRemoval`); `reconcileRemovalMembership` is
  facility-predicated + `FOR UPDATE` internally.

### GHG-statement period-overlap: app-layer guard vs. DB constraint (`isometric/ghg-period-overlap-db-constraint`, opened 2026-06-04)

- Non-overlapping reporting periods are enforced in `createGhgStatementDraft`
  (reject an `end_on` ≤ the latest other statement's end) and mirrored in the
  create drawer. A read-then-write check, not a DB invariant.
- A truly concurrent pair of creates with overlapping periods could both pass
  (TOCTOU). Low likelihood — periods are consecutive and the
  `(provider, facility, end_on)` unique constraint blocks exact dupes — but not
  airtight.
- **Resolve via:** a Postgres `EXCLUDE USING gist` range constraint on
  `(facility_id, daterange(reporting_period_start_on, reporting_period_end_on))`
  once start dates are reliably populated (they're reconciled post-create, so a
  draft row has a null start until Isometric returns the window — the constraint
  must tolerate that or be deferred). Decide if the DB guarantee is worth the
  `btree_gist` extension + null-start handling.

### Transport-leg compliance follow-ups (opened 2026-05-13)

- **Per-leg evidence model deferred** (`isometric/transport-v1.1-evidence`).
  - Isometric Transportation v1.1 §6 + Appendix 1 require: emission-factor
    source citation, factor vintage by mode (road ≤3 y, ship/air ≤5 y,
    rail/pipeline ≤7 y), round-trip vs. onward-leg evidence, distance-method
    fallback justification (§3.1 "appropriately evidenced"), weigh-scale
    calibration record, vehicle class/model year.
  - **Current state** (`src/db/schema/logistics.ts`): `tripType` **exists**
    (`'return'` default, ×2 multiplier — see the invariants section), as do
    `billOfLading` and `weighScaleTicketRef`. There is **no**
    `emissionFactorSource` column anywhere in the schema, and none for factor
    vintage, onward destination, or fallback evidence. Form text mentions §3.2
    but validators do not enforce.
  - **Resolve via:** a dedicated PR with a Drizzle migration adding the columns,
    condition-registry rules
    ([`docs/isometric/condition-registry.md`](./isometric/condition-registry.md)),
    refreshed [`docs/isometric/schema-mapping.md`](./isometric/schema-mapping.md)
    rows 30–32, and three new entries on
    [`docs/isometric/p0-compliance-checklist.md`](./isometric/p0-compliance-checklist.md)
    (P0-16 method-hierarchy + fallback evidence, P0-17 per-leg round-trip
    default, P0-18 factor vintage by mode).

- **Per-leg vs aggregated submission strategy**
  (`isometric/transport-v1.1-aggregation`) — **resolved within the SCALAR
  constraint.** The operator re-authored the template onto the
  `mass_distance_based_ci_emissions` blueprint, so each category submits one
  `mass_distance` (tonne·km) scalar = `Σⱼ(distⱼ × massⱼ)` directly, still
  enforcing per-category factor uniformity. See `aggregateTransportMassDistance`
  in `src/lib/isometric/utils/aggregation.ts` — and note the `tripType`
  multiplier is applied there, so the summed scalar is already round-trip
  adjusted.
  - **True per-leg submission is categorically impossible, not merely
    un-exposed.** A live catalog sweep confirmed *every* `mass_distance` input
    across all Certify blueprints is `data_shape: SCALAR`; no transport
    blueprint accepts a `datapoint_ids` LIST. Per-leg visibility would require
    one component *instance* per leg (dynamic `AddComponentToRemoval`, outside
    the template-driven pipeline) and yields no numerical gain for same-mode
    legs — rejected.
  - **Deferred — mixed-mode transport** (`isometric/transport-mixed-mode`): one
    `mass_distance` component carries one emission factor, so rail/ship legs
    (different EF) cannot be summed into a road tonne·km scalar — today they
    trip the mixed-factor warning and block submission. Supporting them needs
    per-mode component instances. Out of scope while the transport UI is
    road-only; re-raise when a non-road mode is enterable.

> **Note:** ADR 0003 / ADR 0004 pre-deploy gates (legacy ledger cutover,
> destructive migration `0021`, wide id-addressable removal/GHG-statement
> surface, no-zero-stub-in-prod) live in
> [`docs/isometric/integration-plan.md`](./isometric/integration-plan.md) →
> **Pre-deploy gates**. They are actions before deploy, not open questions.

### Remaining template-coverage gaps

The Phase 3 / 3.6 / 3.7 template inspection found ~10 input coverage gaps; all
are closed (period-level inputs resolved by
[ADR 0005](./adr/0005-period-emissions-as-project-components.md) — they're now
`PROJECT`-scope Components managed in the Isometric UI). Breakdown in
[`docs/isometric/changes.md`](./isometric/changes.md). Two forward-looking items
remain:

- **Pyrolyzer pre/post electricity readout** (`isometric/phase-3-readouts`).
  `INPUT_MAPPING` under `pyrolysis / metered_energy_based_ci_emissions`
  synthesises `initial_readout = 0`, `final_readout = totalElectricityKwh`. The
  difference equals real consumption, the only quantity Certify uses downstream
  — verifier-acceptable today, but replace with real per-run pre/post readouts
  when `production_runs` gains the columns.

- **Blueprint version dimension in `INPUT_MAPPING`**
  (`isometric/mapping-version-dimension`) — **deferred**.
  - **Question:** when Isometric introduces blueprint versioning (e.g.
    `carbon_content` moving from `dimensionless` to `mass_fraction` in
    `pyrolysis@v2`), how should `INPUT_MAPPING` represent the version dimension
    — a 4-tuple `(group, blueprint, blueprintVersion, input)`, an
    N-entries-per-input branch-on-`compatible_unit` model, or something else?
  - **Why deferred:** the Certify OpenAPI exposes no `blueprint_version` field
    (verified by grep across `src/lib/isometric/generated/certify.d.ts`). With
    no concrete example, any decision would be speculative. The submit-time unit
    guards in `src/lib/isometric/transformers/datapoint.ts` plus the nightly
    coverage check catch type/unit mismatches; no near-term integrity risk.
  - **Resolve via:** re-read the OpenAPI on any spec bump; reopen the first time
    Isometric ships a versioned blueprint.

### Phase 5 Slice B / C deferrals (opened 2026-05-29)

Scoped out of the Phase 5 Slice A design (biochar reactor time-series via
Parquet — [ADR 0006](./adr/0006-data-upload-submission-idempotency.md)). Each is
independently shippable once Slice A is in production and demand surfaces.

- **Slice B — `POST /biochar_applications`** (`isometric/phase-5-slice-b`).
  Per-spread-event JSON submission (`application_date`,
  `truck_mass_on_arrival/departure`, `average_application_rate`) that verifiers
  use to inspect individual delivery records. Deferred because it requires two
  upstream primitives noma does not post — `POST /production_batches` and
  `POST /projects/{id}/storage_locations` — which doubles the scope vs. Slice A.
  Per-application `supplier_reference_id` IS supported by the create request, so
  the standard reconciliation pattern applies (no ADR 0006-style departure).

- **Slice C — `MonitoringSubmission`** (`isometric/phase-5-slice-c`).
  `POST /projects/{project_id}/monitoring_requirements/{id}/submissions` —
  structured-by-requirement submissions, parallel to the bulk Parquet path.
  Deferred because it overlaps Slice A's purpose; without operator demand we
  don't know which is the canonical home for which protocol-mandated
  measurement. **Resolve via:** ask Isometric directly whether reactor
  temperature/pressure belongs in `MonitoringSubmission` or
  `DataUploadSubmission`. If the former, consider whether Slice A's hourly
  aggregator becomes a `MonitoringSubmission` feeder rather than a Parquet writer.

### Isometric Certify docs — three filed defects awaiting a docs update

All three were filed with Isometric via the MCP `submit_feedback` tool
(`mcp__claude_ai_Isometric__submit_feedback`) and remain open here until the
public docs page is corrected. Re-check them in the next
[`update-playbook`](./isometric/update-playbook.md) pass.

- **UPPERCASE vs lowercase enum mismatch.** The "Uploading time series data"
  page (`docs.isometric.com/user-guides/certify/time-series-data-upload`) shows
  measurement-property `quantity_kind`/qualifier values UPPERCASE
  (`TEMPERATURE`, `PRESSURE`, `MASS_FRACTION`, `COMPOUND_CO2`). The API requires
  **lowercase** — confirmed against sandbox with `POST /sensors` (UPPERCASE →
  422 enum violation listing the canonical lowercase set). A reader following
  the docs produces rejected requests until they discover it by trial.
- **Undocumented 60-second cap on aggregation period.** Isometric rejects
  DataUploadSubmissions where
  `aggregation_period_end - aggregation_period_start > 60 s`
  (`AggregationPeriodDurationInvalidError`). The docs page describes the Parquet
  column shape but not the cap. noma's first design picked 1-hour windows on
  verifier-readability grounds and the sandbox smoke forced a revision to 60 s.
  (The smoke probe was deleted; its pattern lives in
  `tests/isometric-sandbox.integration.test.ts`.)
- **Biochar pyrolysis reactor declared DAC-only.** The same page opens *"Time
  series data can currently be associated with either a Direct Air Capture (DAC)
  capture facility or a DAC storage location (saline aquifer),"* then lists
  Biochar Pyrolysis Reactor measurement properties, and the OpenAPI enum
  includes `biochar_pyrolysis_reactor_facility_time_series`. A sandbox probe
  confirmed the API accepts the biochar submission_type; the prose intro is
  stale, so anyone evaluating biochar time-series support via the docs
  incorrectly concludes no.

### Isometric Certify API — no facilities LIST endpoint (`isometric/facilities-list-endpoint`, opened 2026-06-10)

- Filed with Isometric as a missing capability. The Certify API exposes **no way
  to enumerate facilities** — verified against the live operation list: no
  `GET /facilities`, no `GET /projects/{project_id}/facilities`, no
  `POST /facilities`. The facility id (`fcl_…`) appears only as a stored scalar
  on other resources.
- **Why it matters:** the facility certifier mapping's "Isometric facility
  (telemetry)" field (`externalFacilityId`) is therefore a free-text paste —
  operators create the facility in the Certify UI then hand-copy the id into
  noma (`facility-certifier-dialog.tsx`). Error-prone (typo → telemetry
  submitted against the wrong facility), and it is the one mapping field with no
  validation against a real list. Creation being UI-only is fine and
  intentional; the gap is purely the missing read.
- **Resolve via:** when a read endpoint ships (ideally
  `GET /projects/{project_id}/facilities` returning id + display name), mirror
  the existing template-picker chain: `listFacilitiesByProject()` in
  `src/lib/isometric/projects.ts` → a `useIsometricProjectFacilities(projectId)`
  hook (pattern: `useIsometricProjectTemplates`) → swap the free-text
  `FormInput` for a `FormSelect`.

### Phase 4 deferrals

- **Isometric webhook contract availability** (`isometric/phase-5`).
  When will Isometric publish a webhook event schema, signature header, and HMAC
  algorithm? Blocks any automated reconciliation of GHG-statement state.
  `certifierProjects.webhookSecret` exists in the schema, but Certify's OpenAPI
  declares `webhooks = Record<string, never>` and no webhook topic exists in the
  docs. Today users rely on the manual "Refresh" button calling
  `refreshGhgStatementStatus`. A receiver built now would be guessing payload
  shape, header name, and algorithm. **Resolve via:** ask Isometric support;
  check `api-reference/` quarterly via
  [`docs/isometric/update-playbook.md`](./isometric/update-playbook.md). Once
  published, build `src/app/api/certification/webhook/route.ts` with HMAC +
  reconciliation tests.

- **External GHG statement amendment claiming** (`isometric/phase-5`).
  Detect when an admin edits statement dates or attached Removals directly in
  Isometric and the registry creates a new statement-version draft noma has not
  claimed. Phase 4 surfaces `pending_total_co2e_removed_kg` and supports
  resubmission against the known local row, but does not compare the local
  `externalId` against the registry's current period draft on every refresh.
  **Resolve via:** a claim/reconcile flow for external statement-version drafts.

- **Hash-changed partial-orphan cleanup** (`isometric/phase-5`).
  Reconcile or report Datapoints/Removals created by a failed attempt when local
  inputs changed before the retry, producing a new payload hash and new supplier
  refs. Same-hash retries reuse stored refs and reconcile before POST, but
  changed-hash retries intentionally create a fresh version, so remote resources
  from the failed old hash can remain orphaned. **Resolve only if** production
  traffic shows this often enough to justify per-Datapoint sub-ledger bookkeeping.

- **Per-input source attribution** (`isometric/sources-per-input-attribution`).
  Phase 3.5 ships removal-wide attribution: every monitored Datapoint receives
  the same `source_ids` list. Verifiers see complete evidence per Datapoint but
  lose the narrowing that "this lab report supports carbon_content +
  product_mass, not transport distance" would convey. A verification-quality
  concern, not an API correctness one — the API accepts removal-wide attribution.
  **Resolve via:** extend `loadCandidateDocumentsForRemovalAction` to return
  per-input bindings (or a per-blueprint heuristic) and thread them through
  `buildCreateDatapointRequest`'s `sourceIds` arg, which is already per-input.

- **Stream large source files** (`isometric/sources-stream-large-files`).
  Phase 3.5 caps mirror size at 50 MB via `arrayBuffer()` for code simplicity;
  larger documents fail loud with a `SafeError`. **Resolve via:** pipe
  `response.body` from the noma storage download directly into the Isometric PUT
  with `duplex: "half"` (needs careful `Content-Length` handling). Defer until a
  real LCA PDF or video exceeds the cap.

- **Mirror lock held across Isometric HTTP round-trips**
  (`isometric/sources-lock-hold-time`).
  `mirrorDocumentToSource` holds the per-document mirror advisory lock across
  three Isometric calls (`findSourceBySupplierRef`, `createSource` /
  `requestSignedUploadUrl`, `putBlobToSignedUrl`) plus the storage download.
  Since `submitRemoval` and `setDocumentSourceVisibility` also acquire it, a
  slow 50 MB upload stalls every concurrent submit + visibility flip on the same
  document. Logged as the main scalability tradeoff to revisit before
  multi-operator workloads. **Resolve via:** split mirror into a `reserve` phase
  (lock, look up remote, request upload URL, persist a `pending` mapping,
  release) and an `upload` phase (PUT without the lock, re-acquire briefly to
  flip `pending → ready`). Adds one `upload_status` column to
  `certifier_document_uploads` and one DB round-trip per mirror.

- **Per-Datapoint ledger sub-rows** (`isometric/phase-4`).
  Add `submissionType='datapoint'` rows in `certification_submissions` so a
  re-submit short-circuits successfully-POSTed datapoints from a prior failed
  attempt. Phase 3 leaks orphan datapoints in Certify on partial-failure
  re-submits; the leaked rows have no Removal reference — cosmetic clutter, not
  a data-quality issue. **Resolve only if** partial-failure rates rise.

- **PATCH `/removals` vs supersede-and-create** (`isometric/phase-4`).
  Phase 3 always creates a new versioned remote Removal on payload changes. If
  Certify supports in-place PATCH for selected fields and verifier UX prefers
  it, branch 3e gains a PATCH path (more accurate audit trail when only metadata
  changes; no v=2 Removal flooding the registry UI). **Resolve via** reading
  Certify's PATCH docs and confirming which fields are mutable post-creation.

- **`LIST` data-shape inputs receiving multiple datapoints**
  (`isometric/phase-4`).
  `CreateComponentListInput.datapoint_ids[]` accepts N IDs, but Phase 3
  aggregation collapses N runs into a single value, so list inputs receive a
  one-element array. Today's protocol-level UX is "one credit batch = one
  Removal" with aggregated values. **Resolve only when** a template surfaces
  that needs a per-run breakdown.

- **Per-column upload-URL field migration** (`storage/phase-2`).
  `production.plc_data_file_url`, `samples.r0_histogram_file_url`,
  `samples.tga_thermogram_file_url`, `production_samples.photo_url`,
  `feedstock.registry_url`, `emissions.source_url` are still plain text columns.
  Phase 2 plan: add a `*_document_id` FK alongside each, backfill via UI, drop
  the URL column — routing all uploaded evidence through the single `documents`
  table (one audit trail, one storage-key convention, one visibility model, see
  [`docs/storage.md`](./storage.md)). Not urgent; existing URL fields keep
  working as external/legacy links via the `/api/documents/[id]` proxy route's
  `fileUrl` branch.

### Phase 3.5 source-mutation hardening — deferred simplifications (opened 2026-05-26)

Surfaced by the `/simplify` pass after the P1/P2 fix set. All below the
threshold for the same PR; revisit next time the area is touched.

- **Extract `finalizeSnapshotInputs` from `submitRemoval`'s create-new-version
  closure** (`code/submit-removal-finalize-helper`). The `prepare` callback
  passed to `insertDraftSubmissionWithMappingLockAndLocks` in
  `src/fn/certification/submit-removal.ts` is ~80 lines mixing lock acquisition,
  conditional source-id reconciliation, hash recomputation, template-input
  rebuild, and final `InsertDraftSubmissionInput` assembly. Readable today
  (linear, rare-path clearly marked) but a third caller would force extraction.

- **Extract `assertDocumentReadyForMirror` pre-flight from
  `mirrorDocumentToSource`** (`code/mirror-preflight-helper`). Ten sequential
  `SafeError` throws on document nullability fields (`storageKey`,
  `fileSizeBytes`, `mimeType`, head size match, …) plus post-validation
  narrowing tricks. Lifting it to a helper that returns narrowed locals would
  also delete the `!` non-null assertions in `buildSourceRequestBody`.

- **Export `DbClient = DbTransaction | typeof db` from `@/db`**
  (`code/dbclient-alias`). `src/data-access/certifier-document-uploads.ts`
  defines the alias locally; `src/data-access/applications.ts` writes the union
  inline at 3 sites. As more data-access modules accept optional `tx`, the
  duplication compounds.

- **Shared test fixture builder for Isometric submission tests**
  (`tests/isometric-submission-fixtures`). `tests/isometric-submit-removal.test.ts`,
  `tests/isometric-sources-mirror-flow.test.ts`, and
  `tests/isometric-ghg-statement-submit.test.ts` each repeat ~8 `vi.mock(...)`
  declarations and a similar `beforeEach` block; a new data-access dependency in
  `submit-removal.ts` typically breaks all three. **Resolve via:**
  `tests/fixtures/isometric-submission-mocks.ts` exporting the mock path list
  and per-test default data. Note `vi.mock` factories are hoisted, so each file
  still calls them in its hoisted section. See [`docs/testing.md`](./testing.md).

### Phase 3.5 Sources panel test-pass follow-ups (opened 2026-05-27)

Surfaced while exercising the Sources panel against the sandbox (Cases A–H).
A–E and the precondition guards (G/H) passed; the three below were band-aided or
are clean deferrals.

- **`storage/sources-storage-loopback` — replace the HTTP loopback in
  `downloadDocumentBlob` with a `getObjectStream(key)` on `StorageProvider`.**
  `src/fn/certification/sources.ts` issues a presigned URL then `fetch`es it
  back from the same server. In dev that flows through `/api/storage/...` and
  requires `STORAGE_SIGNING_SECRET`; the round trip duplicates network and
  signing work an internal stream would avoid. **Resolve via:** add
  `getObjectStream(key): Promise<{ stream, contentType, contentLength }>` to the
  `StorageProvider` interface (local-fs + S3 + GCS) and call it directly.
  Browser→storage signed URLs stay for genuine browser use. Removes one HTTP hop
  per mirror, shrinks the loopback-host allowlist surface, and kills the dev-only
  `STORAGE_SIGNING_SECRET` dependency on this path.

- **`storage/sources-sync-events-tx` — move `certifier_sync_events` writes out
  of the mirror business transaction.** `safeAppendSyncEvent` (called inside
  `db.transaction` in `mirrorDocumentToSource`) calls `appendSyncEvent` on the
  root `db`. With a single-connection pool the audit write deadlocks waiting for
  a connection held by the open business transaction — **the same
  pool-starvation failure the `assertSameOrg` `executor` parameter exists to
  prevent** (see the invariants section). Band-aided by setting `DB_POOL_MAX=10`
  in `.env.local`, which is pool-size-dependent and must not become the
  long-term invariant. **Resolve via:** accumulate event payloads in a closure
  and flush after the transaction settles (success or rollback). Touch points:
  `src/fn/certification/sources.ts` (`withSyncEventOnFailure`,
  `safeAppendSyncEvent`), `src/data-access/certification.ts` (`appendSyncEvent`).

- **`ux/sources-panel-row-layout` — buttons clip on narrow viewports.** The
  Mirror / Unlink / visibility-toggle button row in
  `src/components/certification/sources-panel.tsx` clips below ~640px when
  filenames are long. Pure UX follow-up: wrap the action row, go icon-only on
  narrow viewports, or move buttons to a per-row overflow menu. See
  [`docs/design-system.md`](./design-system.md).

### Submit-removal — `pyrolyzer_direct` PROJECT-scope conflict in default template (opened 2026-05-27)

Clicking SUBMIT on a Removal raises a `SafeError` stating that
`direct-emissions/ghg_direct_emissions/concentration` belongs to a PROJECT-scope
Component (`category="pyrolyzer_direct"`) and must be removed from the Removal
Template — the corresponding emission is a Project Component published in the
Isometric UI ([ADR 0005](./adr/0005-period-emissions-as-project-components.md) /
[ADR 0018](./adr/0018-isometric-owns-project-emissions.md)).

- **The check is correct; the seed is wrong.** The seeded default Removal
  Template still references that input. Update the seed (and any fixture
  template references) to drop it per ADR 0005.
- **Root cause is upstream of the template:** noma has **no source for the
  `pyrolyzer_direct` magnitude** (exhaust CH₄/CO concentration + gas mass flow).
  It is not operational production-run data — it comes from the annual external
  LCA, and no real extracted value has been published as a PROJECT-scope
  Component in Isometric yet. (The former `certifier_project_emissions` journal
  rows were Moshi-LCA placeholders; the journal is gone per ADR 0018.)
- **The interim-`0` temptation is the exact integrity bug ADR 0005 removed.**
  Pyrolyzer direct emissions are *positive* emissions that *reduce* net removal.
  Sending `0` **inflates** the credit — anti-conservative, the wrong direction
  for a registry. `0` is not a neutral placeholder; it is an over-claim until
  the real LCA value lands.
- **Stakeholder questions to resolve:**
  1. Who owns the LCA report, and what is the real `pyrolyzer_direct` value (kg
     CO₂e for the window) to publish as a PROJECT-scope Component?
  2. Until it exists, is the agreed interim posture (a) **omit the component
     from the template** so the Removal simply doesn't carry it (data absent,
     not a false `0`), or (b) a deliberately **conservative over-estimate**
     transcribed as a PROJECT-scope Component? Both defensible; `0` is not.
  3. Does this block only sandbox exploration or a real production submission?
     (Sandbox: unblock by editing the sandbox template only.)
- **Do NOT re-add a zero-stub `INPUT_MAPPING` entry to bypass the guard.** That
  reverts ADR 0005/0018 and re-introduces the over-claim. The unblock path is
  template-field removal, not a fake datapoint.

### Pinned biochar protocol behind latest certified (opened 2026-06-04)

- [`docs/isometric/versions.json`](./isometric/versions.json) pins biochar
  `1.2.0`, storage-soil `1.2.0`, energy-use `1.2.0`, ghg-accounting `1.0.1`.
  Latest CERTIFIED is biochar **1.3** (2026-05-22), bundling **GHG Accounting
  1.1**, **Energy Use Accounting 1.3**, and **Storage-in-Soil 1.3**
  (biomass-feedstock 1.3 and transportation 1.1 are already current).
- **Why it matters:** the per-batch health check + submit payload encode
  1.2-line expectations; if 1.3 changes the required-input/evidence set or
  durability thresholds (H:Corg < 0.5, R₀ ≥ 2%, pollutant ceilings), they drift
  from the live protocol.
- **noma-specific impact is mostly low:**
  - **GHGAM 1.1 carbon-mass-balance (Procedure 4): largely N/A.** It governs
    *co-product* allocation (biochar **+** a second creditable CDR product of
    different durability); noma is biochar-only and `buildMassAccounting`
    (`src/lib/certification/mass-accounting.ts`) does per-run *applied-mass*
    attribution, not a co-product split. Only bites if a creditable co-product
    is added.
  - **GHGAM 1.1 20-year amortization cap + residual-debt reporting + mandatory
    year-1/3/5 reviews:** amortization is server-side (ADR 0005/0018 — Isometric
    owns project emissions end-to-end), so the cap is enforced registry-side.
    Operator-process change, low code impact.
  - **GHGAM 1.1 embodied-emissions LC-stage + staff-travel clarifications:**
    verify the ADR 0005 period-emission category definitions still match
    (doc-level).
  - **EUA 1.3** (hourly-matching removed for pre-2030 FID; added
    technical/feasibility tests) and **storage-soil 1.3 / Appendix-4
    risk-of-reversal** (questionnaire/registry-determined): low code impact;
    buffer-split *numbers* may shift.
- **The real work is registry-side, not in `versions.json`.** The protocol
  version is bound to the project's GHG-entry template in the Certify UI —
  editing `versions.json` migrates nothing. Sequence once the project moves:
  (1) re-author/re-bind the GHG-entry template to biochar 1.3 in Certify;
  (2) `pnpm isometric:coverage-check` → update `INPUT_MAPPING` only if blueprint
  keys/inputs/units changed; (3) doc refresh per
  [`update-playbook`](./isometric/update-playbook.md); (4)
  `pnpm regenerate-certify-types` is separate (the OpenAPI surface is
  version-independent).
- **Why this stays open:** whether the project migrates to biochar 1.3 needs
  Isometric coordination + template re-authoring (existing 1.2 removals may
  stay; new crediting periods may require 1.3). Authoritative:
  <https://registry.isometric.com/protocol/biochar/1.3>.
- **Standing re-audit mechanism:** `.claude/workflows/isometric-gap-check.js`
  independently re-detected the same four drifts from a cold start and flagged
  none on biomass-feedstock or transportation. Re-run it on any version bump to
  regenerate the three-corner (authority vs. docs vs. code) gap list before
  re-pinning. Run summary:
  [`docs/archive/2026-06-22-isometric-gap-check-run.md`](./archive/2026-06-22-isometric-gap-check-run.md).

### Submit-context builder N+1 on selection/submit hot paths (`certification/submit-context-n+1`, opened 2026-06-05)

- Two N+1s remain in the shared submission-context builder:
  `loadSelectableBatchesForFacility` (`src/fn/certification/certify-context.ts`)
  loops a full `buildRemovalContext` per ungrouped batch — each iteration walks
  that batch's applications through `getChainOfCustodyData` (~6
  queries/application) plus production-run and transport-leg loads; and
  `resolveScopeForRemoval` resolves member `applicationIds` + `co2eStoredPreview`
  per member (≈2×M queries).
- **Why it matters:** the New-Removal wizard's first step and the submit path;
  cost scales with batches × applications-per-batch. The per-batch Isometric
  *remote* calls were already hoisted and the create-removal confirm loop fixed
  (`buildCreditBatchContextWithFacts` loads facility facts once) — what's left is
  the per-batch DB lineage fan-out.
- **Resolve via:** rework `buildRemovalContext` to batch the lineage walks across
  a batch set (one chain-of-custody resolve keyed by all `applicationIds`, one
  transport-leg query over all entity ids), or add a lighter projected
  fact-loader for the ungrouped-batch health verdict. **Constraint:**
  `resolveScopeForRemoval` intentionally does per-batch preview work because the
  submit summary needs `co2eStoredPreview` per member — a grouped optimization
  must still supply it. The builder is shared with `submitRemoval`, so verify
  both paths. High-risk; wants a focused pass, not a mechanical edit.

### Wizard robustness gaps (`certification/wizard-robustness`, opened 2026-06-05)

Three failure-path gaps, each a surprising mode before a registry write:

- **Submit double-fire:** `SubmitConfirmDialog.onConfirm`
  (`src/components/certification/new-removal-dialog/submit-step.tsx`) calls
  `fireSubmit(true)` unconditionally; a double-activate before `isPending` flips
  can fire the mutation twice. (Server submit is ~idempotent; the primary Submit
  button is already `busy`-guarded.) **Fix:** guard with
  `if (submitMutation.isPending) return;` and disable the confirm while pending.
- **Registry-guard error path:** `CertificationRegistryGuard`
  (`src/components/certification/certification-registry-guard.tsx`) ignores the
  certifier-summary query's `error` — a transient fetch failure reads as "no
  registry" and silently redirects the operator from every certification page to
  Settings. It also renders bare `null` while loading. **Fix:** an explicit
  error/retry state distinct from "no registry", plus a loading affordance.
- **Batch-health TOCTOU:** `createRemovalWithBatchesAction` re-derives each
  batch's health *outside* the write transaction; the data-access write
  re-checks ungrouped/same-facility under `FOR UPDATE` but not health, so a
  batch could regress below `ready` between check and locked write. Health is a
  soft/derived gate, so impact is grouping a briefly-regressed batch. **Fix:**
  either re-assert `state === "ready"` inside `createRemovalWithCreditBatches`
  after acquiring locks, or document health as a point-in-time advisory.

### TelemetryPanel orphaned, reactor-telemetry submit dark (`certification/telemetry-panel-orphaned`, opened 2026-06-19)

- `TelemetryPanel` still exists but is not rendered anywhere, so the reactor
  temperature/pressure → Isometric `DataUploadSubmission` path remains dark.
  Archive:
  [`docs/archive/2026-06-19-telemetry-panel-orphaned.md`](./archive/2026-06-19-telemetry-panel-orphaned.md).
- **Resolve via:** re-home and barrel-export `TelemetryPanel`, then validate the
  file-upload → signed PUT → data-upload-submission pipeline live on the sandbox
  before re-surfacing it.

## Audit follow-ups (opened 2026-05-25)

Deferrals from the whole-codebase tech-debt audit (CRITICAL + HIGH landed
in-PR). Roughly ordered by leverage.

### Architecture audit — remaining phases (opened 2026-05-21)

The 2026-05-21 audit plan
([`docs/archive/2026-05-21-architecture-audit-scalability-tech-debt.md`](./archive/2026-05-21-architecture-audit-scalability-tech-debt.md))
was partially executed: Phase 0 (PII log line, doc-query cap, parallel FK
checks, `max-lines` lint, `DB_POOL_MAX` docs, CI prod approval gate) and the
observability half of Phase 2 (structured logger) are done; Phase 4 split the
two oversized data-access files. Still open:

- **Phase 1 — schema-wide indexes.** Add `index()` for unindexed FK columns,
  time-series indexes (`productionRunReadings.timestamp`,
  `soilTemperatureMeasurements.measurement_date`), and the composite
  `transportLegs (entity_type, entity_id)`. One `pnpm db:generate` migration.
  (Superset of `perf/missing-indexes` below — fold those in.) See
  [`docs/database.md`](./database.md).
- **Phase 3 — read-path + correctness.** Explicit column selection on
  wide-table reads, full document pagination, a central `query-config.ts`,
  narrowed React Query invalidation, and `revalidatePath` on key mutations.
- **Phase 4 (remainder) — file size.** `src/db/seed-data.ts` (1814 lines) is now
  the **only** non-generated file in `src/` over the 1000-line cap; the
  previously-flagged oversized forms are gone. Flipping `max-lines` from `warn`
  to `error` therefore only requires finishing `db/seed-modularization` above —
  **and removing `src/db/seed-data.ts` from the eslint `ignores` array**, which
  is why the lint does not flag it today.
- **Phase 5 — CRUD/hooks de-duplication.** Same scope as `code/hooks-factory`
  below; optional, only worth it if the entity set keeps growing.

### Structural / cross-cutting

- **Duplicate-hooks factory** (`code/hooks-factory`). The `src/hooks/use-*.ts`
  family is ~4–5k lines of near-identical query/mutation wiring per entity; a
  `createEntityHooks(...)` factory would collapse most of it. Dedicated refactor
  PR — should not stack on in-flight feature work. See
  [`docs/architecture.md`](./architecture.md).

- **Pin the document-redirect allowlist to the exact Isometric report bucket**
  (`security/redirect-host-pinning`). The `/api/documents/[id]` redirect guard
  was narrowed to `.s3.amazonaws.com` (+ regional/dualstack),
  `.storage.googleapis.com`, `.digitaloceanspaces.com`, `.isometric.com`. The
  S3/Spaces families still match **any** bucket on those providers, so an authed
  user could store a `fileUrl` on an arbitrary bucket host. Low risk (browser
  302; not request-attacker-controlled), accepted for now. **Resolve via:**
  discover the exact host(s) Isometric presigns GHG-statement report URLs
  against and set `ISOMETRIC_STORAGE_REDIRECT_HOSTS` to that explicit host per
  environment — it replaces the default families. No code change needed.

### Performance / scalability

- **Sequential datapoint POSTs in `submitRemoval`** (`perf/datapoint-fanout`).
  `src/fn/certification/submit-removal.ts` iterates `transport.datapointBodies`
  and awaits each `createOrReconcile` sequentially — N × Isometric RTT per
  submission. With 5–15 monitored inputs per template that is 1–9s of avoidable
  wait. `Promise.all` with `p-limit(4)` cuts wall-time ~Nx without overwhelming
  Isometric's per-second budget; sync-event ordering becomes interleaved — a
  trade-off the owner should call.

- **Missing composite index on `certifier_sync_events`** (`perf/missing-indexes`).
  The table now carries `certifier_sync_events_organization_id_idx`
  (`src/db/schema/certification.ts`) but still has no index supporting the
  detail-page lookup by `(entity_type, entity_id)` ordered by `attempted_at
  DESC`, so every detail page does a seq scan. Under org scoping the useful
  composite now leads with `organization_id`, i.e.
  `(organization_id, entity_type, entity_id, attempted_at DESC)` — not the
  three-column shape this entry originally proposed. One migration; fold into
  the Phase 1 index pass.

- **CI coverage script serial per-facility loop** (`perf/coverage-check-fanout`).
  The outer `for (const facility of facilities)` in
  `scripts/isometric-coverage-check.ts` iterates one at a time, each running 1×
  `listGhgEntryTemplates`. `p-limit(4)` over the facility array cuts CI
  wall-time linearly.

### Correctness / observability

- **Mapping-revision ambiguity on resume path**
  (`isometric/mapping-revision-resume`). `submit-removal.ts` stamps the current
  `MAPPING_REVISION` on sync events emitted during the resume branch, but the
  actual datapoint bodies were built from `payloadSnapshot.__mappingRevision` (a
  potentially older deploy's mapping). An auditor querying
  `response_payload->>'mapping_revision'` cannot tell which mapping authored the
  bytes. **Resolve via:** stamp both `snapshot_mapping_revision` and
  `runtime_mapping_revision` on every resume sync event. JSONB shape addition,
  no migration.

- **Lossy `IsometricApiError` in submission catch paths**
  (`obs/preserve-error-context`). `createOrReconcile` (`submit-removal.ts`) and
  `createGhgStatementRemote` (`ghg-statements.ts`) catch failures, write a
  `failed` sync event carrying only `errorMessage: message`, and throw a wrapped
  `SafeError`. The original `err.body`, `err.status`, `err.code` are dropped —
  neither the audit ledger nor any logger receives them. **Resolve via:**
  include all three in `responsePayload` alongside `mapping_revision`; pair with
  the logger work so the developer-facing stack and the operator-facing
  `SafeError` live in different channels.

### Accessibility

- **Color-only severity convention in warning notices** (`a11y/wcag-1.4.1`).
  Warning/blocker notices on the certification surface (e.g. in
  `src/components/certification/certify-panel.tsx`) encode visual severity only
  by the `--color-signal-orange` left border + a decorative `!` glyph. WCAG
  1.4.1 requires a non-color cue; SR-only text satisfies AT users but the
  sighted-low-vision case still needs a non-color visual signal ("Warning"
  inline text, or an icon with sufficient contrast). **Resolve via:** a
  dedicated `audit-a11y` pass that also runs a runtime contrast check on
  `--color-signal-orange` and picks a house style for severity badges
  ([`docs/design-system.md`](./design-system.md)).

## Documentation hygiene

### Review feedback parked for future PRs (opened 2026-05-19)

- **`docs/isometric/changes.md` archival split** (`docs/changelog-archival`) —
  **deferred**. Review suggested moving dated implementation-history sections
  into `docs/archive/` and leaving an evergreen status pointer. Parked because
  `changes.md` is documented in `CLAUDE.md` and
  [`docs/isometric/README.md`](./isometric/README.md) as the project's local
  changelog — dated by construction; splitting every entry would hurt
  discoverability without changing information density. **Resolve via:** agree a
  retention policy first (e.g. "entries older than 6 months move to
  `docs/archive/isometric-changes-<year>.md`"), then execute in one PR.

- **`docs/isometric/README.md` and `sandbox-template-authoring.md` phase
  language** (`docs/evergreen-language`) — **deferred**. Phase- or date-specific
  phrasing in the README index entry. Parked because the phase references
  describe what the walkthrough *unblocks*, which remains accurate. Bundle with
  the next substantive update to the walkthrough.

- **`env-banner.tsx` style-constant extraction** (`code/env-banner-style-consts`)
  — **deferred**. Review suggested extracting padding (`px-12 py-8` /
  `px-16 py-12`) and icon-size (`16` / `20`) literals into named constants.
  Parked: only two call sites duplicate each literal, and the inline ternary
  makes the inline/page divergence immediately visible. Revisit on a third
  variant.

## Product bins & formulations

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

## Audit follow-ups (whole-repo audit, opened 2026-06-07)

Deferred items from the 9-commit + working-tree audit — needing a product/UX
decision or larger than a review-fix. Execution summary archived in
[`docs/archive/2026-06-07-whole-repo-audit-snapshot.md`](./archive/2026-06-07-whole-repo-audit-snapshot.md).
Sizing: (S) small, (M) medium, (L) large.

### Unbounded readings table — pagination/virtualization (`perf/readings-table-unbounded`) — **deferred**

- The `(production_run_id, timestamp)` index **landed** (migration `0036`), so
  the query is no longer a full scan. Still open: `getProductionRunReadingsList`
  (`src/data-access/production-run-readings.ts`) has no `.limit`, and
  `src/components/production-run-readings/production-run-reading-table.tsx`
  renders every row to the DOM with no virtualization. Telemetry is the
  highest-cardinality child entity on a run.
- **Why it matters:** a run with thousands of readings ships the whole set to
  the client and paints every row. Not biting at seed scale; will bite as real
  telemetry lands.
- **Resolve via:** decide server-side paging UX (page size, infinite-scroll vs.
  pages), then add `.limit`/offset + `@tanstack/react-virtual` (M). UX decision
  first.

### Certification readiness loader lineage fan-out (`perf/overview-lineage-nplus1`) — **deferred**

- `loadCertificationOverview` rebuilds a full submission context per removal;
  each walks every application through `getChainOfCustodyData`, which issues
  ~5–6 sequential single-row queries → on the order of R×A×6 round-trips per
  Removals load, uncached. Same root pattern as the per-batch
  `getCo2eStoredPreview` fan-out in `src/data-access/credit-batches.ts` and the
  per-row `getCreditBatchById`/`getLatestSubmission` loops in
  `certify-context-core.ts`.
- **Why it matters:** the Removals hub readiness payload grows linearly with
  removals×applications; every navigation re-runs the full fan-out.
- **Resolve via:** batch lineage with set-based `inArray` queries
  (delivery→order→product→run in one pass, zip in JS) and/or memoize the
  readiness payload (React Query `staleTime` or a server cache). The batched
  primitive `getCreditBatchSummariesByRemovalIds` already exists as a model (L).

### create-removal idempotency key (`concurrency/create-removal-idempotency`) — **deferred**

- `createRemovalWithBatchesAction` has no server-side idempotency key. Batch
  double-link is already race-safe (rows locked `FOR UPDATE`, re-checked
  `removalId IS NULL`) and the UI Confirm button is `busy`-gated, so single-tab
  and same-batch-set retries are covered. Residual gap: a network retry or a
  second tab submitting a **disjoint** batch set can create an extra
  `certifier_removals` row, and `gcRemovalIfOrphaned` only reaps on delete.
- **Why it matters:** narrow exposure (no batch double-spend, no bad credits —
  just a stray empty/duplicate removal), but it needs product semantics to close.
- **Resolve via:** add an optional client-generated `idempotencyKey` to
  `createRemovalWithBatchesSchema`, persist with a unique index,
  `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` inside the
  existing txn (M). Local Postgres dedupe only — the Isometric POST happens
  later in `submitRemoval`.

### Inline-CRUD table duplication (`refactor/inline-crud-table`) — **deferred**

- The three production-run child tables (readings/incidents/samples) share ~90%
  boilerplate: identical `inlineForm` discriminated-union state machine, header
  markup, `TableSkeleton`, empty state, edit/delete column, and
  `DeleteConfirmDialog` wiring. `formatTimestamp` is copy-pasted 3×.
- **Why it matters:** maintenance drift — a fix to one table's CRUD flow has to
  be mirrored 3×.
- **Resolve via:** extract a generic `<InlineEntityTable>` or
  `useInlineCrudTable` hook parameterized by columns + form component + mutation
  hooks; per-entity files collapse to a config (M). Pure refactor, no behavior
  change — wants its own PR + test pass.

### Generic typing for the certify field registry (`types/certify-registry-generic`) — **deferred**

- `certify-field-registry.ts` condition/`formFields` lookups are keyed by bare
  strings probed via `(entity as Record<string, unknown>)[field]` in
  `entity-readiness.ts`. A typo in a registry key compiles fine and silently
  reads `undefined` → a readiness gate passes when it shouldn't. This class of
  bug produced the original **MRV durability gap** (fixed at the data layer +
  covered by a regression test in `tests/isometric-certify-context.test.ts`).
- **Why it matters:** the regression test closes the *known* instance; the
  *class* remains open — another mistyped key fails the same silent way.
- **Resolve via:** make the registry generic per entity —
  `CertifyFieldDescriptor<T>` with `condition.field: keyof T` and
  `formFields: readonly (keyof T)[]`, and `deriveEntityCertifyReadiness<T>`
  bound to the real row type per entity kind, so every key becomes a
  compile-checked property reference (M). Revisit when the registry next grows.

### Correlation-id field drift in removal submit (`observability/submit-correlation-id`) — **deferred**

- The removal submit flow binds `submissionAttemptId` on its child logger but
  several deeper boundary logs key the correlation field as `submissionId` (the
  DB row id) — an aggregator filtering on one won't see records keyed by the
  other. No data loss; weakens "trace one attempt end-to-end".
  `ghg-statements.ts` already uses `submissionAttemptId` consistently.
- **Resolve via:** thread the attempt-scoped `log` child through those boundary
  logs, or include both ids (S).

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

### Unprompted "Link Isometric project" modal after facility create (`facilities/phantom-link-dialog`)

- `FacilityCertifierDialog` opens unprompted over `/facilities` after facility
  create, on GitHub-runner production builds only (6/6 there, 0 local repros).
  Needs reproduction and a bisect; if real, it's a user-facing bug. CI forensics
  archived in
  [`docs/archive/2026-06-10-phantom-link-dialog-investigation.md`](./archive/2026-06-10-phantom-link-dialog-investigation.md).
- **Interim quarantine:** `facilities.spec.ts` dismisses the modal if present
  (loud `phantom-link-dialog` annotation); remove when resolved.
- **Resolve via:** CI-side instrumentation — temporary `--trace on` on the first
  attempt, or a debug step dumping the React owner chain of the dialog node
  (component names need a non-minified build to be readable) (M).

### Playwright hygiene (`testing/e2e-hygiene`)

- `waitForLoadState("networkidle")` is used throughout `full-chain-ui.spec.ts`
  (slow-by-design with polling queries); shard 1 carries all `certification-*`
  files because sharding distributes by file. Consider `fullyParallel: true`
  (shard by test) after confirming no in-file ordering deps, replacing
  networkidle waits with role-based expects, and `eslint-plugin-playwright` (S).

## Tooling & toolchain upgrades (research pass, opened 2026-06-12)

Verified findings from a sourced research sweep (Next 16 / TS 7 / Drizzle v1,
mid-2026). Already confirmed fine: Turbopack default (no stale flags, no webpack
config), `reactCompiler: true` opt-in, `src/proxy.ts` rename, generate+migrate CI
workflow.

### TypeScript 7 (tsgo) for CI typecheck (`tooling/ts7`)

- TS 7's native Go compiler benchmarks ~7.5–10× faster full type-checks
  (first-party numbers; partly multi-threading). Beta is live
  (`@typescript/native-preview`, `tsgo` CLI, supports `--noEmit`); stable was
  planned ~June 2026 but had not shipped as of 2026-06-12. Emit gaps are
  irrelevant here (typecheck-only; SWC/Turbopack transpiles), but there is no
  Strada compiler-API support — inventory API consumers first.
- **Resolve via:** add a non-blocking `tsgo --noEmit` CI job now to validate
  parity against the 60+-table schema and Zod-heavy types; flip the blocking
  typecheck once stable ships (S).

### Drizzle ORM/Kit v1.0 upgrade (`db/drizzle-v1`)

- v1 was at `1.0.0-rc.3` (stable line still 0.45.x). Bundles a full drizzle-kit
  rewrite (introspection ~10s → <1s — relevant at 60+ tables), migrations folder
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

Lint tooling (Biome 2 / oxlint vs ESLint 9), Vitest 4 browser mode, Playwright
1.58+ features, OpenAPI contract testing for the Isometric client, Renovate vs
Dependabot, pnpm supply-chain guidance — the sweep produced no
adversarially-verified claims in these areas.

## Entity deletes orphan polymorphic documents (opened 2026-07-12)

- No `delete*` function in `src/data-access/` cleans up rows in the polymorphic
  `documents` table (entityType/entityId, no FK). `deleteFeedstock` and
  `deleteDelivery` hard-delete the parent without touching its documents;
  `assertCanManageDocumentEntity` then throws its entity-missing error for the
  orphan, so the document row and its storage object become unlistable and
  undeletable — permanently leaked. Systemic across every document-bearing
  entity; verified pre-existing (not a #432 regression).
- No `deleteDocumentsForEntity` helper exists yet.
- **Resolve via:** a shared
  `deleteDocumentsForEntity(ctx, tx, entityType, entityId)` mirroring
  `deleteTransportLegsForEntity`, called from every entity delete in the same
  transaction, plus storage-object cleanup and a delete-parent-with-documents
  regression test (M). **Note:** orphans are org-scoped rows — the helper must
  take `ctx` and filter on `organizationId` like every other data-access write,
  and must accept the caller's `tx` as its executor (see the invariants section),
  not just mirror `deleteTransportLegsForEntity`'s signature.

## Flow Hero dropped the old action-center structural cert checks (opened 2026-07-18)

- The Flow Hero dashboard (PR #462) replaced the old action-center, whose
  "Evidence" section (deleted `dashboard-operations.ts`) surfaced six structural
  certification gaps. Two are still visible: application evidence gaps
  (applications station badge) and credit batches without samples (certification
  block). Four are no longer surfaced anywhere: **facility GPS missing**,
  **feedstock GPS missing**, **transport endpoint (origin/dest GPS) gaps**, and
  **transport distances not document-backed**. With those gaps present but every
  station check clean, "Needs attention" reads "All clear" — a false green for
  certification readiness.
- **Why not fixed in #462:** the new attention model is station-anchored (each
  flag maps 1:1 to a flow station; `attentionTotal` derives from station
  badges). The dropped checks don't fit cleanly — facility GPS is
  facility-level, and transport endpoint/distance gaps span feedstock, biochar,
  and sample legs (a multi-join query that maps to the chain-of-custody page,
  not a single station). Forcing them onto station badges would conflate
  meanings and balloon scope; only feedstock GPS maps to one station.
- **Resolve via:** a dedicated certification-readiness surface (or a
  non-station "structural gaps" panel) that re-adds `loadGpsGapCounts` and
  `loadTransportGapTotals` from git history
  (`origin/staging: src/data-access/dashboard-operations.ts`), preserving the
  fail-closed evidence contract (M).
