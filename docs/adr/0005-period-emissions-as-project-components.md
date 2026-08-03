# Period-level emissions live as Project-scope Components; noma is the LCA journal, not the publisher

> **Superseded by [ADR 0018](./0018-isometric-owns-project-emissions.md)**
> (2026-07-02). The `PROJECT`-scope placement stands; the noma-side LCA journal
> + drift panel this ADR introduced were removed — Isometric is the sole
> system-of-record for project emissions. Kept as the historical record.

> **Current route note:** The period-emissions journal described here was
> removed by ADR 0018. There is no current period-emissions route. The surviving
> facility configuration lives at
> `/certification/settings?section=emission-estimates&facility=<id>` (see
> `src/lib/certification/links.ts`).

> **Amended 2026-07-29**: the `miscellaneous/mass_based_ci_emissions/mass`
> tuple gained a named-component exception — the template component `Safety
> margin` (a per-tonne conservatism deduction that must track each removal's
> biochar mass, so PROJECT-scope amortization would mis-state it) is
> REMOVAL-scope and mapped in `INPUT_MAPPING`. The scope guard itself stands
> for every other component (`docs/isometric/changes.md`, 2026-07-29).

> **Status: Accepted, design-only** (2026-05-24). Resolves
> `isometric/phase-3.7-period-inputs` (originally raised 2026-05-21,
> scope-revised 2026-05-22 under ADR 0003). Implementation tracked under
> integration-plan Phase 3.7 "period-inputs follow-up". Extends the
> [ADR 0001](./0001-emission-estimate-config.md) admin-config precedent
> onto per-reporting-period emissions.

## Context

Five emission categories — staff travel, pyrolyzer direct emissions
(CH₄/CO concentration + gas mass flow), biochar-storage fuel,
miscellaneous mass-based CI, lab electricity + sampling consumables —
are sourced annually from an external LCA. They currently emit hardcoded
`0` magnitudes in `INPUT_MAPPING` (see `transformers/datapoint.ts:226`
"Remaining zero stubs"), guarded by `assertProductionConfirmed` so a
zero-stub template cannot be promoted to a production Isometric project
(integration-plan pre-deploy gate #4). The open question
`isometric/phase-3.7-period-inputs` asked where these inputs should
live, with sub-decisions on source model and client-side apportionment
across operator-chosen GHG Statement windows.

The Certify OpenAPI surface — read for this decision — answered the
sub-decisions before they were asked.

1. **`ComponentScope` enum** (`certify.d.ts:1455`):
   `REMOVAL | GHG_STATEMENT | PROJECT | NET_NEGATIVITY`. A Component can
   be attached to any of four scopes; today's `INPUT_MAPPING` only models
   `REMOVAL`.
2. **`POST /project_components`** (`certify.d.ts:641`) creates Components
   attached to the Project, not a Removal or Statement.
3. **`ProjectComponentAmortizationStrategy` enum** (`certify.d.ts:3113`)
   — `ESTIMATED_PROJECT_TONNAGE | MANUAL | CUSTOM_TIME_PERIOD |
   ESTIMATED_PROJECT_LIFETIME`. Isometric apportions a project-scope
   value across child Removals + GHG Statements server-side according to
   the declared strategy.

Period-level emissions are a textbook fit for `PROJECT` scope: they are
not attributable to a specific Removal or to a single Statement's
intra-period window; they are the operator's overhead for the LCA's
measurement window. Server-side amortization removes the client-side
apportionment problem the open question was structured around.

## Decision

Period-level emissions become **`PROJECT`-scope Components in Isometric**,
not Removal datapoints and not GHG Statement components. Two sub-decisions:

### 1. Posture — noma is the LCA journal, not the publisher

noma extends `/admin/emission-estimates` with a "Period emissions
(LCA-derived)" section: one row per
`(facility, lca_window_start, lca_window_end, category) →
{magnitude, unit, source_document_id, allocation_strategy_recommendation,
notes, recorded_by, recorded_at}`. `source_document_id` FKs into the
existing `documents` table (the LCA PDF). `allocation_strategy_recommendation`
is informational text the admin copy-pastes when posting in Isometric
(default `"CUSTOM_TIME_PERIOD; target_date = <lca_window_end>"`).

noma **does not** POST to `/project_components`. The operator
publishes Project Components directly in the Isometric registry UI. A
read-only drift panel on the Certification surface fetches
`getProject().components` and flags:

- ⚠️ noma row with no matching Isometric Project Component →
  "Promote this value in the Isometric UI."
- ⚠️ Isometric Project Component with no matching noma row →
  "Add this to /admin/emission-estimates for the audit trail."

### 2. Allocation strategy default — `CUSTOM_TIME_PERIOD`

The recommended strategy surfaced to the operator is
`CUSTOM_TIME_PERIOD` with `target_date = lca_window_end`. Per-category
overrides are an admin-edit on each row, deferred until a verifier
requests one.

### 3. Removal Template hygiene — scope-conflict `SafeError`

The five period-input tuples currently in `INPUT_MAPPING` as
`zeroStub: true` (`staff-travel/distance_based_ci_emissions/distance`,
`direct-emissions/ghg_direct_emissions/{concentration,mass_flow}`,
`biochar-storage/fuel_usage_by_volume/volume_of_fuel`,
`miscellaneous/mass_based_ci_emissions/mass`, and the lab/sampling
tuples once surfaced) move to a new `PERIOD_INPUT_TUPLES` set.
`buildCreateDatapointRequest` checks `PERIOD_INPUT_TUPLES` before the
generic missing-entry error and raises a custom `SafeError` that names
the tuple AND the canonical scope:

```text
This input belongs to a Project-scope Component (`PROJECT` scope).
Remove `staff-travel/distance_based_ci_emissions` from your Removal
Template; the staff-travel emission is tracked separately via a Project
Component published in the Isometric UI from a row in
/admin/emission-estimates.
```

The `noma-mvp` template per `sandbox-template-authoring.md` already
omits these components, so this is a contract enforcer for templates
authored later or for the default sandbox templates used during
exploration.

## Why

- **The OpenAPI surface answered the apportionment sub-decision.**
  `ProjectComponentAmortizationStrategy` removes client-side
  apportionment from noma's responsibility. Building the apportionment
  logic locally would be re-implementing a Certify-side feature, with
  the integrity risk of two implementations drifting.
- **Posture B right-sizes the surface to once-a-year admin work.**
  LCA-derived values change annually. Building a Removals-style publish
  pipeline (admin form + Publish button + ledger rows + status badges +
  supersede semantics) is wildly out of proportion to that cadence.
  Posture B costs an admin form section, a sentinel set, a `SafeError`
  branch, and a read-only drift panel.
- **The ADR 0001/0015 precedent is "LCA-transcribed values = admin config,
  not a published artifact."** Genset yield lives as config and is consumed at
  submit time; ADR 0015 later removed stage splits when the active template no
  longer needed them. This decision applies the same posture to period
  emissions. Originated artifacts (Removals, GHG Statements — ADR 0003 / 0004)
  get the full publish pipeline; transcribed values do not.
- **The drift panel is the "consistent mapping" guarantee operators
  asked for.** Anything Isometric carries that noma doesn't know about
  (or vice versa) is surfaced; the audit trail lives in noma's row;
  remediation is one-click obvious. This is the inverse of an automated
  publish flow with quieter failure modes.
- **The scope-conflict `SafeError` is documentation that runs.**
  Whoever authors a template that mistakenly includes a period-input
  component sees exactly which scope it belongs in and where its data
  lives. The error message replaces a section of
  `sandbox-template-authoring.md` that would otherwise rot.
- **Posture C remains an upgrade path.** If the operator finds the
  manual two-step (transcribe to noma → publish to Isometric) painful
  enough that values get out of sync, a future ADR can land the publish
  flow. Posture B doesn't close that door.

## Consequences

- **New table** `certifier_project_emissions` (provisional name):
  facility-scoped, LCA-window-keyed, FK to `documents` for the source
  PDF, FK to `users` for `recordedBy`. Additive migration.
- **`/admin/emission-estimates` page** grows a "Period emissions"
  section sharing the existing form patterns. The genset-yield config and the
  period-emission rows live on the same page because they share the
  "LCA-transcribed admin config" mental model.
- **`INPUT_MAPPING` loses the five `zeroStub: true` families.** They
  move to a new `PERIOD_INPUT_TUPLES` constant set used by the
  scope-conflict `SafeError`.
- **The `zeroStub: true` flag itself becomes unused for these families.**
  It remains a valid concept for genuine zero-magnitude inputs (e.g.
  metered consumption deltas where `initial_readout = 0` is correct),
  but no period-input entry uses it post-cutover.
- **Drift panel on `/certification/`** issues one `GET /projects/{id}` +
  `getProject().components` per page load (cached briefly). The
  components list is bounded by the project's actual component count
  (<20 in current sandbox); no pagination needed.
- **Pre-deploy gate #4 in `docs/isometric/integration-plan.md`
  (no-zero-stub-in-prod) is replaced** by a per-category check: every
  category present in any Removal Template the facility uses must have
  a matching noma row in `certifier_project_emissions` AND a Project
  Component in Isometric. The nightly coverage check (Thread B) runs
  this assertion headless.
- **The five categories ship with placeholder rows seeded from the
  Moshi LCA** (separate seed step in the implementation). No production
  promotion until the seed is replaced with real LCA-extracted values.
- **`docs/isometric/sandbox-template-authoring.md` "Omitted from MVP"
  list keeps its current omissions and gains a note**: these
  components are deliberately omitted because their data flows through
  Project Components, not Removal datapoints. A template author who
  adds them anyway will trip the scope-conflict `SafeError`.
- **The previously-deferred apportionment work (mass-weighted vs
  time-weighted vs hybrid) is fully obviated** by the
  `ProjectComponentAmortizationStrategy`-on-Isometric model. No client
  apportionment logic ships.
