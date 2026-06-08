# Plan: Certifier-readiness (Tier-2 validation) + dead transport-leg cleanup

**Date:** 2026-06-05
**Status:** Approved, not started
**Owner:** unassigned (handoff doc — pick up in a fresh context)

---

## 1. Why this exists

Two implicit field-validation tiers exist in the app, but only one is expressed:

- **Tier 1 — save-required:** fields a Zod form schema demands before an entity can be persisted. Enforced and visible (`src/schemas/*`).
- **Tier 2 — certifier-required:** fields not needed to *save* but needed to *submit* a removal to the Isometric verifier (e.g. `biocharOutputKg`, `loadMassKg`, fuel/electricity, sample carbon, per-stage energy config). Today this is **scattered and implicit** — it only surfaces late, as aggregation warnings (`aggregation.ts`) and the removal/batch readiness classifiers (`readiness.ts`, `batch-health.ts`). When a user fills in a production-run/sample/feedstock form, nothing tells them "saved, but not enough to certify."

Goal: make Tier 2 a **first-class, marked** concept — a per-entity "certifier-ready vs incomplete" state plus inline form marking of certifier-required fields — anchored to the one place that already knows what gets submitted (`INPUT_MAPPING`). Lifecycle states (`upcoming`/`delivered`, `draft`/`complete`, `delivered`/`applied`) stay **user-controlled and independent**, but certifier-readiness *requires* a terminal-ish state.

Also: remove a confirmed dead code path (`delivery`-type transport legs).

## 2. Decisions already made (do not re-litigate)

1. **Tier-2 source of truth = INPUT_MAPPING-anchored registry.** A declarative per-entity registry of certifier-required fields, kept honest against `INPUT_MAPPING` (the real source of what's submitted) by a test, so it can't drift. A generic readiness helper + a form-field `certifyRequired` marker read from it. Chosen over (a) per-entity hand-listed readiness fns and (b) parallel strict Zod schemas — both duplicate the required-field knowledge.
2. **Remove the `delivery` transport-leg path now via reseed.** No prod data exists (project is pre-launch), so per the repo's *reseed-not-migrate* convention this is safe.

## 3. Findings that ground the plan (verified 2026-06-05)

### 3a. Sandbox data is currently complete — nothing is actually missing
Direct query of the dev DB:

| Category | cargo entities | entities w/ leg | legs | missing load_mass | missing distance | mixed methods |
|---|---|---|---|---|---|---|
| feedstock | 3 | 3 | 3 | 0 | 0 | no |
| biochar | 3 | 3 | 3 | 0 | 0 | no |
| sample | 3 | 3 | 3 | 0 | 0 | no |
| **delivery** | 3 | **0** | **0** | — | — | — |

All three *required* categories are fully covered with `load_mass_kg` + `distance_km` and a single calc method ⇒ no readiness blocker, no aggregation warning. (Earlier hypothesis that "sample legs are the gap" was wrong for the seed — `seed-chain-data.ts` seeds sample legs. The general point — sample legs can't auto-derive — still holds but isn't biting.)

The only anomaly: deliveries have zero legs, which is expected because the delivery leg path is dead.

### 3b. `delivery`-type legs are dead (remove)
- `transportEntityType` has had `delivery` since the **initial commit `d8fe5bb`** as part of a polymorphic "any entity can have legs" design.
- When legs were wired into submission (commit `6bb0576`), `collectTransportEntityIds` only gathers **feedstock / biochar-product / sample** — never delivery (`src/lib/isometric/utils/transport-lineage.ts`).
- UI: biochar-products and samples mount a `TransportLegsEditor`; **deliveries show only a read-only summary** — a user cannot create a delivery-type leg today (`src/components/deliveries/delivery-list.tsx:139-144`).
- Rationale: emissions transport attaches to the **cargo** (biochar *product*), not the **sales transaction** (delivery). Deliveries keep operational metadata (`driverId`, `vehicleId`) which are not emissions inputs. So `delivery` in the enum is redundant leftover scaffolding.

### 3c. Existing readiness machinery to mirror (do NOT rebuild)
The removal/batch level already uses the target pattern — **pure facts → pure classifier → checklist UI**:
- `src/lib/certification/readiness.ts` — `deriveRemovalReadiness`, `buildRemovalPreflightChecklist`, `buildRemovalRequirementsChecklist`; `RemovalReadinessFacts.requiredTransport`.
- `src/lib/certification/batch-health.ts` — `deriveBatchHealth` → `{ state, issueCount, checks[] }`; the closest template for an **entity-level** readiness fn.
- `src/lib/certification/readiness-facts.ts:17-40` — `toRemovalReadinessFacts` assembles facts.
- Required transport categories are **template-derived, not hard-coded**: `deriveRequiredTransportCategories` (`src/fn/certification/certify-context.ts:159-181`) walks `template.groups`→`components`→monitored `inputs`, maps each via `lookupInputMapping` + `TRANSPORT_SOURCE_TO_CATEGORY`. For the sandbox `noma-mvp` template all three categories are required.
- Coverage facts built in `buildCoverage` (`certify-context.ts:183-212`); `count` from leg arrays, `hasAggregationWarning` from `aggregateTransportLegs`.

### 3d. Where "what gets submitted" lives (the anchor)
- `src/lib/isometric/transformers/datapoint.ts:43-265` — `INPUT_MAPPING` maps `(group_key, blueprint_key, input_key) → { source: <field of AggregatedProductionData>, datapointType }`. This is the authoritative set of submitted fields. `lookupInputMapping` / `lookupPeriodInputTuple` are the accessors.
- `src/lib/isometric/utils/aggregation.ts:6-47` — `AggregatedProductionData` (the submission shape); `aggregateTransportLegs` (lines 69-106) enforces per-leg `load_mass_kg` + single method (Isometric v1.1 §5); `enrichWithTransportLegs`, `enrichWithFacilityConfig`.
- `docs/isometric/condition-registry.md` — documents conditional_required fields (e.g. `transport.distance_based` ⇒ `load_mass_kg`) but is **not currently enforced in code** — it's a doc artifact. Use it as input when authoring the registry.

### 3e. Tier-1 expression today (for contrast)
- `src/schemas/helpers.ts` — `toNumberOrUndefined` (required numbers), `toNumberOrNull`/`optionalNumber`/`optionalPositiveNumber`/`optionalPercent` (optional). Never `valueAsNumber`.
- Representative: `transport-legs.ts` (`distanceKm`, `loadMassKg` already save-required), `production-runs.ts` (`biocharOutputKg`, fuel, electricity all `.optional()` — these are the Tier-2 fields), `feedstocks.ts`, `samples.ts` (only schema with conditional `.superRefine()` — 1000-year durability path).
- Derived (never user-entered): dry masses (`src/lib/calculations/mass-dry.ts`), transport distances + mass-weighted averages (`src/lib/calculations/transport-leg.ts`, `aggregateTransportLegs`), per-stage energy splits (`enrichWithFacilityConfig`), sample-weighted carbon. The registry must mark these as "derived — satisfied upstream," not as form fields to fill.

### 3f. Lifecycle state enums (`src/db/schema/common.ts`)
`feedstockStatus` (`missing_data`/`complete`), `productionRunStatus` (`draft`/`running`/`complete`/`void`), `deliveryStatus` (`upcoming`/`delivered`), `applicationStatus` (`delivered`/`applied`), `creditBatchStatus` (`draft`/`pending`/`verified`/`issued`/`rejected`). Submission-readiness is **not** currently keyed off these. The plan: readiness requires a terminal-ish state as one input, while state stays user-controlled.

## 4. Phased work

> Phases 1–4 are independent of Phase 0 and can proceed in parallel, but doing Phase 0 first keeps the enum/schema stable while the registry is authored.

### Phase 0 — Remove dead `delivery` transport-leg path  *(small, mechanical)*
1. `src/db/schema/common.ts` — remove `'delivery'` from the `transportEntityType` pgEnum. (Leave `deliveryStatus` and the `deliveries` table untouched — only the *leg entity-type* value goes.)
2. `src/schemas/transport-legs.ts` — remove `'delivery'` from the `transportEntityTypes` array (and any derived union/type).
3. `src/components/deliveries/delivery-list.tsx:139-144` — remove the read-only `TransportLegsSummary` mount (`viewModeChildren`) and its import.
4. `src/components/transport-legs/transport-legs-summary.tsx` + `transport-legs-editor.tsx` — drop the `delivery` entry from `DEFAULT_TITLES` / any entity-type switch.
5. Grep for residual references: `rg -n "'delivery'|\"delivery\"|delivery" src/lib/isometric src/data-access/transport-legs.ts src/schemas/transport-legs.ts` — confirm nothing in the submission/aggregation path expects it (it already doesn't).
6. `pnpm db:generate` to produce the enum migration, then **reseed**: `pnpm db:reset` (drops + migrates + ensure-admin) followed by the chain seed used in dev (`pnpm db:seed` / the e2e `seed-chain-data.ts` path). Verify with a quick `transport_legs` group-by that `delivery` is gone and the three real categories still seed cleanly.
7. `pnpm lint` + `pnpm test` (vitest) — fix any type fallout from the narrowed enum.

**Done when:** enum no longer contains `delivery`, no code references it, dev DB reseeds, lint+unit tests green.

### Phase 1 — Tier-2 field registry, anchored to INPUT_MAPPING
1. New module `src/lib/certification/certify-field-registry.ts`. Declarative map: per submittable entity (`productionRun`, `sample`, `feedstock`, `transportLeg`, `facilityEmissionConfig`) → list of certifier-required field descriptors `{ key, label, kind: 'entered' | 'derived', condition?, mapsToSource }`. `mapsToSource` names the `AggregatedProductionData` field (and its `INPUT_MAPPING` tuple) the entity field feeds.
2. Author entries from: `INPUT_MAPPING` (`datapoint.ts`), `AggregatedProductionData` (`aggregation.ts`), and `docs/isometric/condition-registry.md` (conditional triggers — e.g. 1000-year durability fields, `transport.distance_based ⇒ load_mass_kg`).
3. **Drift guard:** new test `tests/certify-field-registry-coverage.test.ts` (mirror `scripts/isometric-coverage-check.ts`'s logic): every `INPUT_MAPPING` `source` that traces back to a user-entered entity field MUST appear in the registry, and every registry `mapsToSource` MUST be a real `AggregatedProductionData` key. Fails loud on drift. Consider wiring into the daily isometric-health workflow.

**Done when:** registry compiles, every submitted field is accounted for (entered or derived), coverage test green.

### Phase 2 — Per-entity certifier-readiness layer
1. New `src/lib/certification/entity-readiness.ts` mirroring `batch-health.ts`: pure `deriveEntityCertifyReadiness(entityKind, entity, lifecycleState) → { state: 'ready'|'incomplete', gaps: FieldGap[] }`. Reads the Phase 1 registry; evaluates conditions; treats `kind:'derived'` fields as satisfied (they're computed upstream). Lifecycle state is **one input** — incomplete if not terminal-ish (e.g. delivery must be `delivered`, run `complete`, application `applied`).
2. Unit tests covering: all-filled ⇒ ready; missing entered field ⇒ gap; conditional field (1000-year durability) on/off; non-terminal lifecycle ⇒ incomplete.

**Done when:** pure fn + tests green; no DB/UI coupling in this module (keep it client-safe like `readiness.ts`).

### Phase 3 — UI surfacing
1. **Entity badge:** a small "Certifier-ready / Incomplete (n)" badge component reading `deriveEntityCertifyReadiness`, shown on list rows + detail headers for the submittable entities. Match the brutalist token system (square corners, design tokens — see `docs/design-system.md`). Distinct visual from Tier-1 validation errors.
2. **Form marking:** extend `FormField`/`SectionLabel` (`src/components/forms/*`) with a `certifyRequired` marker (visually distinct from the save-required `*`), driven by the registry. On save of an entity with Tier-2 gaps, show a **non-blocking** summary ("Saved. Still needed to certify: …") — saving must still succeed (that's the whole point of two tiers).
3. Accessibility: badge needs an accessible name; marker can't rely on color alone (4.5:1, non-color cue). 44×44 touch targets per project a11y rules.

**Done when:** badges render from real data, forms mark Tier-2 fields, save still works with gaps, a11y checks pass.

### Phase 4 — Reconcile levels
1. Have the batch/removal facts loaders (`certify-context.ts` `buildCoverage` / `readiness-facts.ts`) consume the Phase 2 entity-readiness output instead of recomputing transport/carbon completeness independently, so entity badges and the removal pre-flight never disagree.
2. Regression test: an entity marked incomplete ⇒ its batch shows the corresponding gap; entity ready across a removal's members ⇒ removal pre-flight transport/carbon checks pass.

**Done when:** entity, batch, and removal readiness agree by construction (single source), regression test green.

## 5. Verification checklist (all phases)
- `pnpm lint` clean.
- `pnpm test` (vitest) green, incl. new registry-coverage + entity-readiness + reconcile tests.
- Dev DB reseeds without the `delivery` enum value.
- Manual: open a production run with missing `biocharOutputKg` ⇒ form marks it Tier-2, saves OK, badge shows "Incomplete"; fill it ⇒ badge flips to "Certifier-ready."
- `pnpm test:e2e` for the certify flow still passes (requires dev server + `DISABLE_RATE_LIMIT=true`).

## 6. Guardrails / project conventions to honor
- `pnpm` only; layered imports (Component→hooks→fn→data-access→db); `fn/` has `"use server"` + Zod + `ActionResult`; every `data-access/` fn calls an auth guard.
- Keep new pure modules **client-safe** (like `readiness.ts`) — no server-only imports, no logger in client paths.
- No file >1000 lines; kebab-case files; constants not magic numbers; design tokens not hardcoded values.
- Don't add `useMemo`/`useCallback` (React Compiler); avoid `useEffect`.
- Reseed-not-migrate for the enum change (pre-launch, no prod data).

## 7. Key file index (for the picking-up agent)
- Enum + lifecycle states: `src/db/schema/common.ts`
- Transport legs table/schema: `src/db/schema/logistics.ts:158`; form schema `src/schemas/transport-legs.ts`
- Submission anchor: `src/lib/isometric/transformers/datapoint.ts` (`INPUT_MAPPING`, `lookupInputMapping`)
- Aggregation shape + warnings: `src/lib/isometric/utils/aggregation.ts`; lineage `…/utils/transport-lineage.ts`
- Readiness pattern to mirror: `src/lib/certification/readiness.ts`, `batch-health.ts`, `readiness-facts.ts`
- Facts loader: `src/fn/certification/certify-context.ts` (`deriveRequiredTransportCategories` 159-181, `buildCoverage` 183-212), `shared.ts:92-102`, `submit-removal.ts:398-418`
- Leg UI: `src/components/transport-legs/*`, `…/deliveries/delivery-list.tsx`, `…/biochar-products/biochar-product-list.tsx`, `…/samples/sample-list.tsx`
- Schema helpers + example schemas: `src/schemas/helpers.ts`, `production-runs.ts`, `samples.ts`, `feedstocks.ts`, `facilities.ts`
- Derived calcs: `src/lib/calculations/mass-dry.ts`, `transport-leg.ts`
- Conditional-field doc: `docs/isometric/condition-registry.md`
- Coverage-test precedent: `scripts/isometric-coverage-check.ts`, `tests/fixtures/isometric-coverage.json`
- Seeds: `tests/e2e/fixtures/seed-chain-data.ts`, `src/db/seed-data.ts`

## 8. Open questions deferred (not blockers)
- Whether `facilityEmissionConfig` (admin-entered per-stage energy splits, not in any RHF form today) needs its own readiness surface or just feeds the facility-level pre-flight. Decide during Phase 2.
- Whether to fold the conditional-field logic in `condition-registry.md` fully into the registry now or incrementally. Start with the fields the sandbox `noma-mvp` template actually submits.
