# Certification is a first-class workspace; submission consolidates into one entry point

> **Status: Accepted, delivered** (2026-06-03). Reverses the dual-entry of
> ADR 0003 (credit-batch Certify panel as a second submit surface). Builds on
> ADR 0004 (GHG Statement as an independent, period-anchored artifact) and
> ADR 0006 (telemetry as its own sub-status). Does **not** change the submission
> domain model — only where submission lives in the UI and how status is read.
> **Amendment (2026-06-04) — sidebar nav, no in-page tabs.** The in-page
> `CertificationTabBar` was removed; the four sub-routes (Overview · Removals ·
> GHG Statements · Settings) are promoted back to a titled **Certification**
> group in the left sidebar, mirroring the Verification section, per operator
> preference for one persistent nav. This changes only the *nav topology* of
> decisions 1 and 5 below — a sidebar group instead of a single entry + tab bar.
> Everything else stands unchanged: the workspace routes, the work-queue
> Overview, the one submit entry point (decision 2), the shared status model
> (decision 3), and Settings consolidation (decision 4). Overview's sidebar item
> matches on its exact path (`/certification`) since that href prefixes every
> sibling route.

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

1. **Sidebar workspace at `/certification`** — a persistent Certification
   sidebar group exposes four routes (Overview · Removals · GHG Statements ·
   Settings), with no in-page tabs. The Overview is a **work queue** ("needs
   attention"), not a dashboard. Lists are **DataTables** (the `production-runs`
   idiom); quick view is a **read-only side-sheet** (`?removal=` /
   `?statement=`). The complex removal path is a **guided full-width Review flow**
   (`/certification/removals/[id]/review`: Assemble → Review → Evidence →
   Pre-flight → Submit) — Sources + telemetry become the **Evidence** step, so
   the old removal detail page goes away (it redirects to `?step=evidence`).

2. **One submit entry point.** The credit-batch **Certify panel is demoted to a
   read-only bridge**: it shows the removal's **own local** status only — never a
   verifier status attributed to the removal (P1-b) — lists member batches
   read-only, and deep-links **"Open in Certification →"** (the removal's Review
   flow, or the Removals route when ungrouped). The inline blocker / coverage /
   submit logic it carried is deleted; that logic is canonical in
   `lib/certification/readiness.ts` + the Review flow. This **reverses ADR 0003's
   dual-entry**.

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
   `/admin/emission-estimates` redirects. The facility side-sheet shows only a
   **read-only registry summary** + "Manage in Certification → Settings". A new
   read-only **Environment & health** panel surfaces non-secret integration
   status.

5. **Four-item sidebar group.** Certification is a titled sidebar group with
   Overview (`/certification`), Removals, GHG Statements, and Settings entries
   under the same section; there is no `CertificationTabBar`.

## Consequences

- **Provider-neutral shell.** The sidebar workspace is neutral; the Isometric
  connector is labeled inside Settings. A future registry slots in as another
  route under the Certification group (consistent with ADR 0004).
- **No domain-model change.** Removal-as-submission-unit (ADR 0003) and
  GHG-Statement-as-independent-artifact (ADR 0004) stand. Membership stays
  Isometric-owned and read-only (ADR 0004); telemetry stays its own sub-status
  (ADR 0006). What changed is UI topology and the single submit entry point.
- **The credit-batch panel no longer submits.** Operators submit from the
  workspace (sheet one-click for a ready 1:1 removal, or the guided Review flow).
  `useSubmitCreditBatchRemoval` (the lazy ensure-then-submit hook) is retired;
  the underlying `submitCreditBatchRemoval` server action is left in place but
  orphaned (flagged for later removal).
- **Deferred:** the demoted panel does not yet inline the linked GHG Statement's
  verifier status (it points to the GHG Statements route instead) — threading that
  through the submission-context loader is tracked in `docs/open-questions.md`.
- **Verification:** the pure status mappers + readiness classifier are unit
  tested (too many surfaces depend on them for E2E alone); sidebar nav, settings
  round-trip, and the removal Review happy path are covered by E2E.

Rollout was staged (status foundation → settings → sidebar workspace + Overview →
Removals → GHG Statements → this bridge + nav + cleanup); each stage was
independently shippable and never broke the old routes.
