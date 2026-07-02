# Isometric owns project emissions: the journal is deleted, only the scope guard remains

Status: accepted (2026-07-02)

> **Supersedes ADR 0005** (period emissions as Project Components; noma as LCA journal).
> The *scope* half of 0005 stands — period-level emissions live as `PROJECT`-scope
> Components in Isometric, never as Removal datapoints. What flips is the *journal*
> half: noma no longer keeps a transcription copy of those values. Execution plan
> (approved 2026-06-17, reconfirmed 2026-07-02):
> [`docs/archive/plans/2026-06-17-remove-project-emissions-journal.md`](../archive/plans/2026-06-17-remove-project-emissions-journal.md).

## Context

ADR 0005 chose "Posture B": noma journals LCA-derived emission magnitudes per
category (`certifier_project_emissions`), the operator publishes the same values
as `PROJECT`-scope Components in the Isometric UI, and a drift panel plus the
nightly coverage check reconcile the two copies.

In practice the journal is a rot-prone duplicate. The verifier audits through
**Isometric**, not noma — the audit trail belongs on the Isometric Project
Components themselves, where it is actually inspected. noma's second copy adds a
duplicate data-entry surface and a drift panel that raises false alarms as soon
as the copy drifts. For the current stage it is unneeded burden; the operator
confirmed on 2026-07-02 that period emissions are not something noma should
track from its side yet.

## Decision

Delete the project-emissions journal subsystem end-to-end:

- `certifier_project_emissions` table + `project_emission_category` enum
- schemas / data-access / fn / hooks for project emissions
- the "Period emissions (LCA-derived)" section and the registry-reconciliation
  drift panel on `/certification/settings`
- the `CATEGORY_TO_BLUEPRINT` matcher (`project-emission-match.ts`) and the
  drift half of `scripts/isometric-coverage-check.ts`

**Keep the one piece that maintains no data and protects submission integrity:**
the scope-conflict guard in `src/lib/isometric/transformers/datapoint.ts`
(`PERIOD_INPUT_TUPLES` + its `SafeError` branch in
`buildCreateDatapointRequest`). It statically stops a future template author
from wiring a project-scope emission (e.g. pyrolyzer CH₄) onto a **Removal**
datapoint, which would silently double-count it into the carbon math. The tuple
table is self-contained string literals — it no longer references the deleted
enum or matcher. The template-coverage half of `isometric-coverage-check.ts`
(INPUT_MAPPING drift + scope-conflict detection against the live template)
survives for the same reason and still runs in `isometric-health.yml`.

## Operational expectation (load-bearing)

Because the audit trail now lives **only** in Isometric: the operator MUST
attach the source LCA PDF to the **Sources** field of each Project Component
(the "No sources / 1 source" chips in the registry UI). This replaces noma's
`sourceDocumentId` FK as the system-of-record for "what justifies this figure".
This matters most for the one potentially material category, `pyrolyzer_direct`
(CH₄/CO): with the journal gone, noma holds no audit copy for it — accepted on
the basis that the figure is sourced in Isometric.

## Consequences

- One source of truth; no drift surface, no duplicate data entry.
- noma cannot display project-scope emission values without asking the
  registry. **Reversible-forward:** the read primitive already exists
  (`listComponents({ projectId, scope: 'PROJECT' })`, previously used by the
  drift panel) — a future read-only view can be rebuilt from the registry
  without reintroducing a local copy.
- The sandbox 0-stub escape hatch (`allowPeriodInputStub`) is unchanged:
  production still fails closed when a template wrongly declares a period
  input as REMOVAL-scope.
