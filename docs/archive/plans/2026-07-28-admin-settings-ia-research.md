# Admin & settings information architecture — research (2026-07-28)

Primary-source pass over every settings/configuration surface in the app, what
`/admin` is actually worth today, and which hardcoded defaults deserve an
operator-facing settings UI. Every claim cites the file that owns it. Research
only — no code changed.

## Implemented 2026-07-28 — read this before acting on the rest

Migration items 1, 2, 3 and 5 below are **done**. The recommendation sections
are kept as the reasoning behind those changes; the state descriptions in Q1–Q4
describe the app *before* them and are now history.

- **`/settings` exists** — `Members` (`/settings/organization`, unchanged
  contents, new frame) and `Defaults` (`/settings/defaults`, new), both inside
  `SettingsConsole` (`src/components/settings/`). `/settings` itself redirects
  to Members: the rail is the index, so a landing page would be the tile grid
  this document argues against. `SettingsRail` was promoted to
  `src/components/ui/settings-rail/` and is shared with
  `/certification/settings`.
- **`organization_settings` exists** — migration `0094_fast_nemesis.sql`, with
  `src/data-access/organization-settings.ts`, `src/fn/organization-settings.ts`,
  `src/hooks/use-organization-settings.ts` and
  `src/config/organization-settings.ts` (the fallback). Currency, country,
  timezone, trip type, evidence method and packaging now seed the order,
  facility, delivery and application create forms; the query is warmed once per
  session in `FacilityProvider` because react-hook-form reads `defaultValues`
  only at mount.
- **`/admin` folded** — the tile grid is gone; `/admin` redirects to
  `/admin/organizations`, the sidebar item is labelled "Organizations", and
  `/admin/organizations/page.tsx` uses `PageHeader`.
  `src/app/(app)/admin/emission-estimates/` is deleted.
- **`/certification/settings` reshaped further than this document proposed.**
  Credentials and Connection merged into one **Certifier** pane
  (`certifier-settings-panel.tsx`): the registry picker, the organization keys,
  and the facility's project link, top to bottom. Saving keys now performs the
  connection test (`listProjects` with the keys just stored) and reports the
  result. The stored-credential summary row and its Remove button are gone —
  the inputs stay on screen with a masked stand-in, and a field left at its mask
  is omitted from the payload so one key can rotate without the other.
  `?section=connection` and `?section=credentials` both resolve to the merged
  pane. `certificationSettingsHref()` now defaults to `?section=certifier`.
- **Docs updated:** `docs/auth.md` (credential ownership),
  `docs/schema-overview.md` (`organization_settings`), `docs/architecture.md`
  (the three configuration surfaces), `docs/design-system.md` +
  `docs/code-style.md` (the spacing-scale gate).

Still open, tracked in [`open-questions.md`](../open-questions.md):
`tenancy/organization-rename`, `certification/credential-removal`,
`tenancy/starter-feedstock-catalog`, `data-quality/plausibility-overrides`.
Migration item 4's remaining half — one shared constant for
`DEFAULT_LIST_PAGE_SIZE` versus the twelve schemas hardcoding `.default(20)`,
and deriving `DEFAULT_MAP_CENTER` from the org's first facility — was **not**
done.

## Summary

- There are **three** configuration surfaces, not one system: `/admin/*`
  (Platform-Admin, cross-tenant), `/settings/organization` (org members), and
  `/certification/settings` (facility ↔ registry). There is no route at
  `/settings` itself — `src/app/(app)/settings/` contains only `organization/`.
- `/admin` is a 3-tile hub in which **only one tile leads to a page that lives
  under `/admin`**. The other two are cross-links to `/settings/organization`
  and `/certification/settings`. Its "Emission estimates" tile points at a
  section that, on the current product configuration, **renders for nobody**:
  it is gated on `durabilityOption === "200_year"`
  (`src/components/certification/certification-settings.tsx:172-173`), while
  facilities default to `1000_year` and 200-year is disabled in the picker
  (ADR 0021, `src/components/certification/durability-tier-select.tsx:38-43`).
- The **route** `/admin/emission-estimates` is referenced by zero source files
  (only its own doc comment, ADR 0005/0007 prose and archived QA notes). It is
  safe to delete.
- **Correction (verified 2026-07-28):** `certificationEmissionEstimatesHref()`
  (`src/lib/certification/links.ts:10-16`) is **not** dead. It is the
  "Open emission estimates" fix link on the credit-batch health strip
  (`src/lib/certification/batch-health-links.ts:11,94` →
  `credit-batch-health-strip.tsx:35`, `new-removal-dialog/select-batches-step.tsx:26`).
  It is also correctly scoped: the only producer of the blocker that triggers it,
  `attributeSoilTemperatureBlockers` (`src/lib/certification/member-batch-gates.ts:19-21`,
  called once at `src/fn/certification/certify-context-core.ts:669`), filters to
  `durabilityOption === "200_year"` — the same tier that makes the target section
  render. So the link cannot strand a 1000-year operator. **Do not delete it.**
  Its whole path is dormant only because no 200-year facility exists yet, which
  is the same reason the section itself is invisible.
- The user's instinct is right: **operator-configurable defaults have no home**.
  The strongest candidates (currency, country, timezone, trip type, evidence
  method, map center) are hardcoded literals repeated in 3-5 places each.
- ADR 0026 already *accepts* an "Admin-managed Organization override" for
  plausibility rules and is **entirely unimplemented** — no `plausib*` module
  exists under `src/`. That ADR is the strongest documented mandate for an
  org-level defaults surface.
- The correct home for those defaults is **`/settings`, gated on org
  Owner/Admin — not `/admin`**, which is Platform-Admin (`users.role ===
  "admin"`) and therefore invisible to the operators who need them.

## Q1 — Settings/configuration surfaces that exist today

| Route | Component | Configures | Who sees it | Scope |
|---|---|---|---|---|
| `/admin` | `src/app/(app)/admin/page.tsx` | Nothing — 3-tile link grid (Organizations · Emission estimates · Organization members) | Platform Admin (`requireAdmin()` in `src/app/(app)/admin/layout.tsx:15`) | none |
| `/admin/organizations` | `src/components/organizations/organizations-admin.tsx` | Lists all orgs, "Enter" (sets `activeOrganizationId`), creates orgs, and embeds per-org Isometric credentials as a row detail (`organizations-admin.tsx:105-111`) | Platform Admin (layout guard); create action additionally `requirePlatformAdmin` | cross-tenant |
| `/admin/users` | `src/app/(app)/admin/users/page.tsx` | Nothing — `redirect("/settings/organization")` | Platform Admin | n/a |
| `/admin/emission-estimates` | `src/app/(app)/admin/emission-estimates/page.tsx` | Nothing — `permanentRedirect` to `/certification/settings`, preserving `?facility=` | Platform Admin | n/a |
| `/settings/organization` | `src/components/organizations/organization-settings.tsx` | Members: invite, role change, remove, revoke invitation | **Any member** reads the roster; controls gated on `canManage = isPlatformAdmin \|\| orgRole === "owner" \| "admin"` (`src/app/(app)/settings/organization/page.tsx:22-25`) | org |
| `/certification/settings` § Registry credentials | `src/components/organizations/organization-certifier-credentials.tsx` | Write-only Isometric access token + client secret | org Owner/Admin + Platform Admin, via server-computed `viewerCanManage` (`src/fn/certification/facility-mapping.ts:76-79`) | org |
| `/certification/settings` § Registry Source visibility | `src/components/certification/registry-source-visibility-settings.tsx` | Default visibility (`private`/`public`) for new Isometric Sources | reads: any member; writes: `requireOrgRole(orgCtx, "admin")` (`src/fn/certification/source-visibility.ts:41`) | org |
| `/certification/settings` § Registry connection | `src/components/certification/facility-certifier-section.tsx` → `facility-certifier-dialog.tsx` | Isometric project link, default removal template, external facility ID | reads: any member; manage: `viewerCanManage` | facility |
| `/certification/settings` § Emission estimates | `src/components/admin/emission-estimates-form.tsx` | Reference soil temperature (°C) + source note; genset yield round-tripped hidden (`emission-estimates-form.tsx:115`, issue #319) | `viewerCanManage` **and** facility tier `200_year` | facility |
| `/certification/settings` § Integration diagnostics | `src/components/certification/certification-health-panel.tsx` | Read-only env/credential/allowlist status | `useIsAdmin()` (Platform Admin), collapsed by default | deployment |
| `/facilities` (side sheet form) | `src/components/facilities/facility-form.tsx` | Facility name, country, timezone, address, GPS, contacts, **durability tier** | any member (org-scoped CRUD) | facility |
| `/feedstock-types` | `src/components/feedstock-types/*` | Org reference catalog (seeded by `seedOrgDefaults`, `src/db/org-defaults.ts:78`) | any member | org |

Notes:
- The sidebar footer gear icon also links to `/settings/organization`
  (`src/components/navigation/sidebar-content.tsx:390`), giving that page two
  entry points while `/admin` has one.
- `docs/auth.md` (last line of the "Tenancy in data-access" section) still says
  registry credentials "are managed only by Platform Admins". The code has moved
  on: `setOrgCertifierCredentialsFn` uses `requireOrgContext()`
  (`src/fn/certifier-credentials.ts:56`) and the UI gates on `viewerCanManage`,
  which includes org Owners/Admins. **Doc is stale.**

## Q2 — What is broken or stale about `/admin`

1. **It is reachable, but only for Platform Admins.** `adminSection` is appended
   to the nav only when `useIsAdmin()` is true
   (`src/components/navigation/sidebar-content.tsx:161-172, 298, 310`), label
   "Admin Panel", `skipFacilityParam: true`.
2. **`?facility=` is meaningless on `/admin`.** The nav link deliberately skips
   it (`skipFacilityParam`), `/admin/page.tsx` never reads search params, and
   `/admin/organizations` is cross-tenant. The only place the param matters is
   the `/admin/emission-estimates` redirect, which forwards it
   (`src/app/(app)/admin/emission-estimates/page.tsx:16-20`).
3. **Two of three tiles are duplicates.** "Organization members" →
   `/settings/organization` (already in the sidebar footer); "Emission
   estimates" → `/certification/settings` (already a first-class sidebar item
   under Certification). Only `/admin/organizations` is unique to `/admin`.
4. **The "Emission estimates" tile is doubly stale.** Its description still
   promises "per-facility genset yield and period LCA values"
   (`src/app/(app)/admin/page.tsx:41`). Genset yield was made vestigial by ADR
   0015's 2026-07-03 amendment (#319); period LCA values were never built (ADR
   0005 remains import-only). What actually remains is one soil-temperature
   field — and that section only renders for `200_year` facilities, which the
   product does not currently issue (ADR 0021: "1000-year is the available
   tier"). **On a default deployment this tile leads to an empty page.**
5. **`/admin/emission-estimates` is unreferenced in source.** `grep` across
   `src/` finds only its own file and doc comments; `tests/e2e/` does not visit
   it (only `/admin` and `/admin/users` appear, in `security.spec.ts:34,47` and
   `mobile-responsive.spec.ts:49-50`). Deletable.
6. **Link helpers in `src/lib/certification/links.ts`.**
   - `certificationEmissionEstimatesHref()` (lines 10-16) — **live; the original
     "only its own unit test imports it" claim was wrong, corrected 2026-07-28.**
     Production caller chain: `batch-health-links.ts:11,94` →
     `credit-batch-health-strip.tsx:35` and
     `new-removal-dialog/select-batches-step.tsx:26`. It is tier-correct: the
     blocker that triggers it is attributed only to `200_year` batches
     (`member-batch-gates.ts:19-21`), which is precisely when the target section
     renders. Dormant, not broken. Leave it alone.
   - `certificationSettingsHref(facilityId, tab = "connection")` (lines 23-30)
     emits `?tab=` — but `/certification/settings` has **no tabs**; the page
     comment explicitly says "a single stacked page (no tabs)"
     (`certification-settings.tsx:8-9`) and the component never reads
     `useSearchParams`. Its two callers
     (`new-removal-dialog/select-batches-step.tsx:283`,
     `new-removal-dialog/submission-checks.tsx:26`) therefore emit a no-op
     query param.
   - `CERTIFICATION_SETTINGS_EMISSION_ESTIMATES_ANCHOR` is still live — it is the
     section `id` (`certification-settings.tsx:175`) — but nothing links to the
     anchor any more.
7. **Design-system deviations.** `/admin/page.tsx` and
   `/admin/organizations/page.tsx` hand-roll an eyebrow + `<h1>` instead of
   `PageHeader`, which `/settings/organization/page.tsx:28-36` uses correctly.
   `docs/design-system.md:392-406` calls a deviating main return "a bug" and
   says routes should be 5-10 line wrappers; `/admin/page.tsx` is 119 lines of
   inline shell. This was already logged as findings #9 and #14 in
   `docs/archive/2026-06-13-frontend-ux-qa-pass.md:113,118` and never fixed.

## Q3 — Hardcoded defaults that are candidates for a settings UI

Verdict key: **strong** = clear per-org/per-facility operator preference re-typed
today; **weak** = plausible but low value or better solved elsewhere; **no** =
must stay hardcoded (protocol/derivation/structural).

### Strong

| Constant / field | Value & location | Feeds | Why |
|---|---|---|---|
| Order & credit-batch **currency** | `"TZS"` in `src/schemas/credit-batches.ts:148`, `src/schemas/orders.ts:54`, `src/components/orders/order-form.tsx:102`, `src/db/schema/credits.ts:69`, `src/db/schema/logistics.ts:88` | Order value, credit-batch value | Five independent literals encode one org fact. A non-Tanzanian org retypes it on every order. Allow-list `currencyCodes = ["TZS","USD","EUR","GBP","KES"]` (`credit-batches.ts:47`) is itself org-blind. **strong** |
| Default **country** | `'UNKNOWN'` in `src/db/schema/facilities.ts:23`, `src/db/schema/parties.ts:105,167`; applied at `src/data-access/customers.ts:554` | Facility, supplier, customer records | Almost every org operates in one or two countries; `"UNKNOWN"` is persisted as real data. **strong** |
| Default **facility timezone** | `'UTC'` in `src/db/schema/facilities.ts:22`, `src/lib/date-utils.ts:16` (`DEFAULT_FACILITY_TIMEZONE`), `src/data-access/credit-batch-samples.ts:13` | Zoneless date/time construction, sampling-day bucketing | Three copies of one org fact; wrong zone silently shifts sampling-day attribution (see `dates/zoneless-instants` in `docs/open-questions.md:843`). **strong** |
| Transport **trip type** | `DEFAULT_TRIP_TYPE = "return"`, `src/schemas/trip-type.ts:28`; consumed by `src/schemas/transport-legs.ts:81`, `src/components/deliveries/delivery-form.tsx:122`, `src/db/schema/logistics.ts:144,245` | ×2 distance multiplier in `aggregateTransportMassDistance` | Emissions-affecting and fleet-specific. Conservative default is correct as a *fallback*; an org that evidences one-way hauls re-picks it every leg. **strong** (default only — the per-leg field must stay) |
| Application **evidence method** | `.default("visual")`, `src/schemas/applications.ts:92`; `src/db/schema/application.ts:53` | Application evidence requirements / readiness | An org standardised on GIS boundary evidence overrides this on every application. **strong** |
| **Map center / zoom** | `DEFAULT_MAP_CENTER = [35.74, -6.17]` (Dodoma), `DEFAULT_MAP_ZOOM = 5`, `src/config/geo.ts:111-114` | Every position picker and map with no coordinates yet | Hardcoded to one operator's country in a multi-tenant app. Cheapest fix: derive from the org's first facility rather than a settings field. **strong** |
| **Starter feedstock catalog** | `STARTER_FEEDSTOCK_TYPES` (9 rows, codes `FT-26-001…009`), `src/db/org-defaults.ts:8-73`, seeded by `seedOrgDefaults` (line 78) | Every newly created org | Dark Earth Carbon's own catalog is injected into every tenant. Belongs behind a Platform-Admin toggle or an onboarding choice, not a constant. **strong** (Platform-Admin scope, not operator) |
| **Plausibility rule thresholds** | *No implementation exists.* ADR 0026 specifies "a versioned system default and … an Admin-managed Organization override" | Advisory warnings on data entry | The only ADR that explicitly mandates an org-level settings surface, and it is unbuilt. **strong** |

### Weak

| Constant / field | Value & location | Feeds | Judgement |
|---|---|---|---|
| `METHOD_B_MINIMUM_METHOD_A_SAMPLES = 30` | `src/config/certification.ts:15` | Method-B eligibility gate (ADR 0022) | Protocol-derived (`G-F74T-0`); an org override would let an operator weaken a certification gate. **weak → prefer no** |
| Order **packaging** | `"loose"`, `src/components/orders/order-form.tsx:100`; `packagingTypes` `src/schemas/orders.ts:21` | Order records | Real per-org habit, but a 2-value toggle. Low value. **weak** |
| Feedstock-type **usage** | `"pyrolysis"`, `src/components/feedstock-types/feedstock-type-form.tsx:135` | New feedstock types | Correct majority default; rarely wrong. **weak** |
| Transport **method** | `.default("road")`, `src/schemas/transport-legs.ts:87` | Emission-factor selection metadata | Road dominates; only matters for rail/water orgs. **weak** |
| Biochar product **status** | `"testing"`, `src/components/biochar-products/biochar-product-form.tsx:217`; `src/db/schema/products.ts:100` | Product lifecycle | Workflow state, not a preference. **weak** |
| List **page size** | `DEFAULT_LIST_PAGE_SIZE = 10` (`src/config/list-controls.ts:5`) vs **12** list schemas independently hardcoding `.default(20)` | Server-side pagination vs client table | A genuine drift bug worth fixing, but as one shared constant — **not** a settings field. **weak** |
| Facility **durability tier default** | `"1000_year"` (`src/schemas/facilities.ts:174`, `src/db/schema/facilities.ts:36`) | New facilities | Already per-facility and editable in `facility-form.tsx:228-247`; the tier picker is single-option today (ADR 0021), so a configurable default adds nothing yet. **weak** |
| `ORS_ROUTING_PROFILE = "driving-car"`, `ORS_SNAP_RADIUS_METERS = 5000` | `src/config/geo.ts:24,46` | Route distance calculation | Distance is emissions-affecting, so a per-org routing profile is defensible — but it is an integration tunable, not operator config. **weak** |

### No — must stay hardcoded

| Constant | Value & location | Why it must not be configurable |
|---|---|---|
| `SOIL_TEMPERATURE_FLOOR_C = 7` | `src/lib/calculations/biochar-removal.ts:77` | Protocol floor (Soil Storage module §5.1.1.3.1); the UI helper text already tells operators values below 7 °C are floored (`emission-estimates-form.tsx:123`). |
| `F_DURABLE_200_COEFFICIENTS`, `F_DURABLE_MAX = 0.95`, `F_DURABLE_1000_CAP` | `biochar-removal.ts:61,64,71` | Woolf 2021 / Sanei 2024 equation constants pinned to Soil Storage module v1.2 (`SOIL_STORAGE_MODULE_VERSION`, line 36). |
| `CO2_C_MOLAR_RATIO`, `KG_PER_TONNE` | `biochar-removal.ts:58`, `src/lib/calculations/unit-conversions.ts:1` | Physical constants. |
| `H_TO_C_ORG_ELIGIBILITY_MAX = 0.5`, `O_TO_C_ORG_ELIGIBILITY_MAX = 0.2`, `MINIMUM_REPLICATES_PER_BATCH = 3` | `src/lib/calculations/biochar-eligibility.ts:28,31,39` | Protocol eligibility thresholds. Making them org-editable would let an operator self-certify ineligible biochar. |
| `SOIL_TEMPERATURE_MIN_C/MAX_C = -50/60` | `src/schemas/helpers.ts:306-307` | Input sanity bounds, not a preference. |
| `CARBON_RECONCILIATION_TOLERANCE_PCT = 0.1`, `H_TO_CORG_RECONCILIATION_TOLERANCE = 0.05`, `MASS_COMPARISON_EPSILON_KG = 0.001` | `biochar-removal.ts:91`, `src/lib/isometric/utils/durability-aggregation.ts:47`, `src/lib/calculations/mass-dry.ts:4` | Reconciliation tolerances; loosening them hides data errors. |
| `MAX_BUCKET_SECONDS = 60` | `src/lib/isometric/transformers/data-upload.ts:89` | Isometric hard cap. |
| Sample form `durabilityOption` `.default("200_year")` | `src/schemas/samples.ts:197`, `src/components/samples/sample-form.tsx:140` | Derived from the chosen credit batch's tier (issue #309, comment at `samples.ts:193-196`) — the literal is a placeholder, not a preference. |
| `calculationMethodType` `.default("distance_based")` | `src/schemas/transport-legs.ts:100`; `src/db/schema/logistics.ts:253` | The enum has one member; the EF lives in the Isometric component blueprint, not here. |
| `DEFAULT_PROTOCOL_SLUG = "biochar"` | `src/config/certification.ts:23` | One protocol supported; `protocolSlug`/`protocolVersion` are deliberately not exposed (`src/data-access/certification.ts:297`: "The supported settings form does not expose protocol version"). |

### Stored config columns with no UI at all

Found by sweeping `src/db/schema/**` against forms:

| Column | Location | Status |
|---|---|---|
| `certifier_projects.gensetEnergyYieldKwhPerLitre` | `src/db/schema/certification.ts:96` | Vestigial; hidden round-trip field only (`emission-estimates-form.tsx:115`). ADR 0015 amendment says removal is a follow-up migration. |
| `certifier_projects.webhookSecret` | `src/db/schema/certification.ts:117` | **Zero references anywhere outside the schema file.** Dead column. |
| `certifier_projects.metadata` (jsonb) | `certification.ts:125` | No writer, no UI. |
| `certifier_projects.protocolSlug` / `protocolVersion` | `certification.ts:86-87` | Deliberately not exposed; advisory-only preflight (`src/fn/certification/protocol-version-preflight.ts:36`). |
| `organizations.logo`, `organizations.metadata` | `src/db/schema/auth.ts:134-135` | No reader, no writer. `logo` is the natural hook for the deferred white-label work (`tenancy/white-label`, `docs/open-questions.md:251`). |
| `organizations.name` / `slug` | `auth.ts:132-133` | Settable only at creation (`organizations-admin.tsx:124-147`); **no rename path exists** — `src/data-access/organizations.ts` has no `updateOrganization`. |
| `certifier_organization_settings.provider`, `certifier_projects.provider` | `certification.ts:59,84` | Fixed `'isometric'`; correct until a second registry exists. |

## Q4 — What the repo's own documentation says the IA should be

| Source | Decision | Current code |
|---|---|---|
| `docs/adr/0007-certification-workspace-consolidation.md` §Decision 4 | "Settings consolidates config." Facility↔project link's primary home is Certification → Settings; emission/LCA config moves there; `/admin/emission-estimates` redirects; facility side-sheet keeps only a read-only summary. | **Honoured.** This is why registry config must NOT be moved into `/settings` — ADR 0007 owns that placement. |
| ADR 0007 §Amendment 2026-06-13 | Certification sidebar exposes exactly three routes: Removals · GHG Statements · Settings. | Honoured (`sidebar-content.tsx:146-153`). |
| `docs/adr/0001-emission-estimate-config.md` | Per-facility emission-estimate config (genset yield + stage splits) stored on `certifier_projects`, edited "in an admin page". Marked **"Accepted, partly superseded"**. | Stage splits removed by ADR 0015; genset yield made vestigial by ADR 0015's #319 amendment. ADR 0001's phrase "an admin page" is the origin of the `/admin` tile and is now historical. |
| `docs/adr/0015-energy-single-combined-measurement-point.md` | Genset yield stays admin config **because it is emissions-affecting**… then the 2026-07-03 amendment reverses that: "no longer emissions-affecting — the column and admin form remain as a vestigial local estimate… removal is a follow-up migration." | Column and hidden field still present. The follow-up migration is outstanding. |
| `docs/adr/0021-durability-tier-is-facility-scoped.md` | Tier declared once per facility, inherited downward; "**1000-year is the available tier**; 200-year is surfaced but disabled". | Honoured — and this is exactly what makes the Emission-estimates section unreachable, since it renders only for `200_year`. Not a contradiction, but an unnoticed consequence. |
| `docs/adr/0026-plausibility-warnings-are-advisory.md` | "Each rule has a versioned system default and may have an **Admin-managed Organization override**." | **Unimplemented.** No plausibility module exists under `src/`. This is the clearest documented requirement for an org-level defaults page. |
| `docs/organization.md` §Documentation Hygiene | Deferred work belongs in `open-questions.md`, never a code TODO. | `docs/open-questions.md` contains **no** entry about admin/settings IA — the ambiguity has never been recorded. Adjacent entries exist: `certification/blueprint-key-gaps` (line 815, "decide whether blueprint resolution belongs in Certification Settings or stays an admin escalation") and `tenancy/white-label` (line 251). |
| `docs/design-system.md:392-436` | Canonical page shell; routes are 5-10 line wrappers; `PageHeader` with area eyebrow. | `/admin/page.tsx` and `/admin/organizations/page.tsx` deviate (see Q2.7). |
| `docs/auth.md` (Tenancy section, last line) | "Registry credentials are owned per organization and **managed only by Platform Admins**." | **Contradicted by code** — org Owners/Admins manage them (`src/fn/certifier-credentials.ts:56` + `viewerCanManage`). Doc needs a one-line fix. |

## Q5 — Recommendation

### Principle

Separate the two axes the current IA conflates:

1. **Platform administration** (cross-tenant, `users.role === "admin"`): create
   and enter organizations. One page's worth of surface. Keep under `/admin`.
2. **Organization configuration** (org Owner/Admin, `requireOrgRole(ctx,
   "admin")`): members, operating defaults, org identity. Belongs under
   `/settings` — where operators can actually reach it.
3. **Registry configuration** (facility-scoped): stays at
   `/certification/settings` per ADR 0007. **Do not move it.**

### Target pages

| Route | Contents | Gate |
|---|---|---|
| `/admin/organizations` | Org directory, Enter, Create, per-org credentials. Becomes the Admin section's only nav item, labelled "Organizations". | `requireAdmin()` (layout) |
| `/settings` *(new)* | Settings hub: Organization · Operating defaults. Uses `PageHeader` + card grid — i.e. what `/admin` is today, moved to the right audience. | `requireAuth()`; sections self-gate |
| `/settings/organization` | Unchanged (members). Add org name/slug rename for Owners once `updateOrganization` exists. | any member reads; Owner/Admin manages |
| `/settings/defaults` *(new)* | Org operating defaults: currency, default country, default trip type, default application evidence method, default packaging. Each written to a new `organization_settings` table and read as the fallback wherever the literal is hardcoded today. | `requireOrgRole(ctx, "admin")` |
| `/certification/settings` | Unchanged, minus the dead `?tab=` param. | as today |

`/settings` is also the natural future home for the ADR 0026 plausibility-rule
overrides and the deferred white-label fields (`organizations.logo`).

### Disposition of `/admin`

**Fold it in — do not keep the hub.** Delete `src/app/(app)/admin/page.tsx` and
point the sidebar's Admin item straight at `/admin/organizations` (relabel "Admin
Panel" → "Organizations"). Rationale: two of its three tiles are cross-links to
pages already in the sidebar, the third is its only real content, and its
"Emission estimates" tile currently leads to an empty section. If a hub is
wanted later, it should be `/settings`, not `/admin`, because the settings that
matter are org-scoped and Platform Admins are not the audience.

### Migration list, ranked by value

**1 — Highest value: give defaults a home (new work)**
- Add `organization_settings` table (`src/db/schema/auth.ts` or a new
  `settings.ts`): `defaultCurrency`, `defaultCountry`, `defaultTripType`,
  `defaultEvidenceMethod`, `defaultPackaging`. Org-scoped, one row per org.
- Add `src/data-access/organization-settings.ts` (`requireOrgScope`, filter on
  `organizationId`), `src/fn/organization-settings.ts`
  (`requireOrgRole(ctx, "admin")` on write), `src/hooks/use-organization-settings.ts`.
- Add `src/app/(app)/settings/defaults/page.tsx` + a thin
  `src/components/settings/organization-defaults-form.tsx`.
- Thread the values through as *form defaults only* — the per-record fields stay
  editable, and the existing literals become the last-resort fallback.

**2 — Delete dead surface (pure subtraction, no risk)**
- Delete `src/app/(app)/admin/emission-estimates/` (zero source references).
- **Do not** delete `certificationEmissionEstimatesHref()` — it has live callers
  and is tier-correct (see Q2.6).
- Drop the `tab` parameter from `certificationSettingsHref()` and update its two
  callers + tests — the settings page has no tabs.
- Drop `certifier_projects.webhook_secret` (no references at all) in the same
  migration as the ADR 0015 genset-yield removal.

**3 — Fix `/admin` itself**
- Delete `src/app/(app)/admin/page.tsx`; change
  `src/components/navigation/sidebar-content.tsx:161-172` to point at
  `/admin/organizations` with label "Organizations".
- Keep `src/app/(app)/admin/users/page.tsx` (cheap redirect, covered by
  `tests/e2e/security.spec.ts:47`).
- Update `tests/e2e/mobile-responsive.spec.ts:49` if `/admin` stops rendering a
  page.
- Convert `/admin/organizations/page.tsx` to `PageHeader` per
  `docs/design-system.md:392-406`.

**4 — De-duplicate the repeated literals (mechanical, do alongside 1)**
- One source for currency (`TZS`), country (`UNKNOWN`), timezone (`UTC`) instead
  of 3-5 copies each; reconcile `DEFAULT_LIST_PAGE_SIZE = 10` with the twelve
  schemas that hardcode `.default(20)`.
- Derive `DEFAULT_MAP_CENTER` from the org's first facility position, falling
  back to `src/config/geo.ts:111`.

**5 — Documentation corrections**
- `docs/auth.md`: registry credentials are managed by org Owners/Admins, not
  only Platform Admins.
- `docs/adr/0001-emission-estimate-config.md`: note that the "admin page" is now
  Certification → Settings and the genset half is vestigial per ADR 0015's
  amendment.
- Add an `open-questions.md` entry for the settings IA if items 1-3 are not
  taken now, and one for `organizations.name`/`slug` having no rename path.

**6 — Deferred, decide separately**
- Implement ADR 0026's org-level plausibility overrides on `/settings/defaults`
  once the rule engine exists.
- Move `STARTER_FEEDSTOCK_TYPES` (`src/db/org-defaults.ts:8-73`) behind a
  Platform-Admin choice at org creation, so new tenants stop inheriting Dark
  Earth Carbon's catalog.
