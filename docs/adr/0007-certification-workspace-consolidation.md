# Certification is a first-class workspace; submission consolidates into one entry point

> **Status: Accepted, delivered** (2026-06-03). Reverses the dual-entry of
> ADR 0003 (credit-batch Certify panel as a second submit surface). Builds on
> ADR 0004 (GHG Statement as an independent, period-anchored artifact) and
> ADR 0006 (telemetry as its own sub-status). Does **not** change the submission
> domain model — only where submission lives in the UI and how status is read.
> **Amendment (2026-06-04) — sidebar nav, no in-page tabs.** The in-page
> `CertificationTabBar` was removed; the workspace routes were promoted back to
> a titled **Certification** group in the left sidebar, mirroring the
> Verification section, per operator preference for one persistent nav. This
> changed only the *nav topology* of decisions 1 and 5 below — a sidebar group
> instead of a single entry + tab bar. The 2026-06-13 amendment below later
> retired the standalone Overview route.
> **Amendment (2026-06-08) — New-Removal wizard replaces the review route.**
> The workspace remains the only submission entry point, but the complex path is
> now the New-Removal wizard (`select ready batches -> registry requirements ->
> submit`) rather than `/certification/removals/[id]/review`. Credit-batch health
> and entity-readiness surfaces push completeness earlier in the workflow.
> **Amendment (2026-06-13) — Overview route retired.** The standalone Overview
> work-queue page did not earn a permanent navigation slot once Removals and GHG
> Statements became full DataTable hubs and Settings became the durable setup
> home. The sidebar now exposes three concrete routes: Removals · GHG Statements
> · Settings. `/certification` remains as a compatibility redirect to Removals
> and preserves `?facility=`.

## Context

The certification area grew phase-by-phase (ADR 0002 → 0003 → 0004 →
telemetry/0006). The UI showed it:

- **Submission was fragmented across three surfaces** — grouping happened in the
  Removals hub, blocker-resolution + submit in the credit-batch **Certify
  panel** (`certify-panel.tsx`), and evidence (sources/telemetry) on a separate
  removal detail page. No single place showed a removal's full picture.
- **Two parallel submit entry points** — the credit-batch panel *and* the
  Removals hub both ran `submit`. ADR 0003 deliberately allowed this dual-entry;
  in practice it muddied the flow and created a cross-area dependency: the
  credit-batch side-sheet duplicated the blocker / coverage / readiness logic.
- **Scattered config** — the facility↔Isometric-project link lived in the
  *facility* side-sheet; emission/LCA config lived under `/admin/emission-estimates`.
- **A local-only status badge** — `SubmissionStatusBadge` read only the local
  ledger status, so it could never show the states operators care about most
  (*Awaiting verifier*, *Credits issued*), which live on the GHG Statement's
  remote overlay.

## Decision

Make certification a **first-class section** alongside `facilities` /
`production-runs`, using the same primitives, and consolidate **all submission
into that workspace**.

1. **Sidebar workspace under `/certification`** — a persistent Certification
   sidebar group exposes three concrete routes (Removals · GHG Statements ·
   Settings), with no in-page tabs. The root `/certification` route redirects
   to Removals for old bookmarks and broad entry points. Lists are
   **DataTables** (the `production-runs` idiom); Removal quick view is a
   **read-only side-sheet** (`?removal=`), while GHG Statement detail and
   creation use centered dialogs (`?statement=`). The complex removal path is
   the **New-Removal wizard**:
   select ready ungrouped credit batches, review registry requirements, then
   submit. Evidence upload and transport-document completion are handled on the
   relevant entity surfaces before a batch is selectable.

2. **One submit entry point.** The credit-batch **Certify panel is demoted to a
   read-only bridge**: it shows the removal's **own local** status only — never a
   verifier status attributed to the removal (P1-b) — lists member batches
   read-only, and deep-links **"Open in Certification →"**. The inline blocker /
   coverage / submit logic it carried is deleted; that logic is canonical in
   `lib/certification/readiness.ts`, `lib/certification/batch-health.ts`, and the
   New-Removal wizard. This **reverses ADR 0003's dual-entry**.

3. **Shared status model** (`lib/certification/status.ts`, client-safe, unit
   tested). One pure mapper per artifact folds `(local, lockInFlight, remote)`
   into one badge, read by every surface (queue, table, sheet):
   - **Removal** — local-only. Lifecycle ends at *Submitted* / *Superseded*
     (no remote Removal status exists in this integration).
   - **GHG Statement** — local base + a **remote overlay** from
     `latestSubmission.metadata.remoteStatus` (*Awaiting verifier → Verified →
     Credits issued / Verification failed*). The list/table reads the persisted
     overlay — **never** a per-row live verifier fetch (N+1).

4. **Settings consolidates config.** The facility↔project link's primary home is
   Certification → Settings (Registry connection), split admin/read-only **by
   data**. Emission/LCA config moves here (ADR 0005 unchanged, import-only);
   the retired `/admin/emission-estimates` route no longer exists. The facility
   side-sheet shows only a **read-only registry summary** + "Manage in
   Certification → Settings". A new read-only **Environment & health** panel
   surfaces non-secret integration status. The route-consolidation history is
   archived in
   [`2026-07-28-admin-settings-consolidation.md`](../archive/2026-07-28-admin-settings-consolidation.md).

5. **Three-item sidebar group.** Certification is a titled sidebar group with
   Removals, GHG Statements, and Settings entries under the same section; there
   is no `CertificationTabBar` and no standalone Overview nav item.

## Consequences

- **Provider-neutral shell.** The sidebar workspace is neutral; the Isometric
  connector is labeled inside Settings. A future registry slots in as another
  route under the Certification group (consistent with ADR 0004).
- **No domain-model change.** Removal-as-submission-unit (ADR 0003) and
  GHG-Statement-as-independent-artifact (ADR 0004) stand. Membership stays
  Isometric-owned and read-only (ADR 0004); telemetry stays its own sub-status
  (ADR 0006). What changed is UI topology and the single submit entry point.
- **The credit-batch panel no longer submits.** Operators submit from the
  workspace through the New-Removal wizard. `useSubmitCreditBatchRemoval` (the
  lazy ensure-then-submit hook) is retired; direct credit-batch submission should
  not be reintroduced.
- **Deferred:** the demoted panel does not yet inline the linked GHG Statement's
  verifier status (it points to the GHG Statements route instead) — threading that
  through the submission-context loader is tracked in `docs/open-questions.md`.
- **Verification:** the pure status mappers, entity-readiness classifier, and
  batch-health classifier are unit tested (too many surfaces depend on them for
  E2E alone); sidebar nav, settings round-trip, and the New-Removal wizard are
  covered by E2E.

Rollout was staged (status foundation → settings → sidebar workspace + Overview →
Removals → GHG Statements → this bridge + nav + cleanup); each stage was
independently shippable and never broke the old routes.
