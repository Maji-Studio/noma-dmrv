# Handoff — Certification (Isometric) UI Remodel · after Stage 3

## What this is

Remodelling the noma-dmrv **Certification / Isometric** UI from a phase-grown,
"alienated" set of surfaces into a native, first-class tabbed workspace. The
full design and rationale live in the approved plan — **read it first**:

- **Plan:** `~/.claude/plans/i-d-like-to-remodel-scalable-moler.md`
  (8 locked decisions, status model, IA/routes, surfaces, staged rollout,
  risks, verification).
- **Domain truth:** `CONTEXT.md` (glossary) + `docs/adr/0003`–`0006`.
- **Branch:** `feature/isometric-api`. **Stack/rules:** `.claude/CLAUDE.md`.
- **Prior handoff (Stage 1):** superseded by this file.

Locked corrections already folded into the plan — **don't re-litigate**:
removals have **no** remote status (lifecycle ends at "Submitted"); GHG remote
status comes from `metadata.remoteStatus`; telemetry stays a separate
sub-status; the status model is strictly client-safe (type-only generated
imports, no schema runtime); Settings splits admin vs read-only **by data**.

## User directives in force (from this session)

- **Migrations: don't sweat them — not live yet.** For any schema change in
  later stages, **just adjust the seed and reseed** (`pnpm db:reset` /
  `tests/e2e/fixtures/seed-chain-data.ts`) rather than authoring safe
  multi-phase migrations. (Stages 2–3 added **no** schema changes, so nothing
  to reseed yet.)
- Hand off again at natural milestones (this doc = after Stage 3).

## Progress: tasks #1–#6 (TaskList is session-scoped — recreate if needed)

- **Stage 1 — Status foundation: DONE** (prior session).
- **Stage 2 — Settings consolidation: DONE & verified (this session).**
- **Stage 3 — Tabbed shell + Overview queue: DONE & verified (this session).**
- **Stages 4–6: PENDING, not started.**

### Stage 2 — what shipped (all additive; old surfaces unchanged)

- **`src/hooks/use-is-admin.ts`** (NEW) — hydration-safe `useIsAdmin()`
  (`useSyncExternalStore`, server snapshot `false`). UX gate only; server
  guards remain the boundary. **Refactored `app-sidebar.tsx`** to consume it
  (kept its own `useSession()` for the footer name/email).
- **`src/fn/certification/facility-mapping.ts`** (MOD) — added
  **`loadFacilityCertifierSummary(facilityId)`** + type
  `FacilityCertifierSummary`: a **DB-only** read-only summary (`{ mapping,
  isProduction }`), no Isometric API, no cross-facility link query. This is the
  P2-d data split — a non-managing viewer never pulls the management payload.
  Exported from `fn/certification/index.ts`. Hook
  **`useFacilityCertifierSummary`** + key `certificationKeys.facilitySummary`
  in `use-certification.ts`.
- **`src/components/certification/facility-certifier-section.tsx`** (REWRITE) —
  added **`canManage`** (default `true`) and **`embedded`** (default `false`)
  props. `canManage` switches between `FacilityCertifierManage` (full payload +
  Edit/Unlink/Link) and `FacilityCertifierReadOnly` (summary loader, no
  controls). `embedded` drops the section's own border-top + "Certification"
  title for use inside a titled card. **Backward-compatible:** the facility
  side-sheet mount (`facility-list.tsx:408`, no props) is unchanged.
- **`src/components/certification/certification-health-panel.tsx`** (NEW) —
  `CertificationHealthPanel` over `useCertificationHealth()`; renders
  environment / credentials-configured / upload + redirect allowlist
  mode+count. **No secrets.**
- **`src/components/certification/certification-settings.tsx`** (NEW) —
  `CertificationSettings`: (A) Registry connection — Isometric (reuses
  `FacilityCertifierSection embedded canManage={isAdmin}`), (B) Emission
  estimates (admin-only — `EmissionEstimatesForm` + `PeriodEmissionsSection`,
  **import-only, ADR 0005 untouched**), (C) Environment & health (admin-only).
  B/C gated client-side on `useIsAdmin()`. **B's form is gated on
  `!summaryLoading`** so RHF `defaultValues` capture the loaded mapping (the
  admin page's original behaviour — don't regress this).
- **`src/app/(app)/certification/settings/page.tsx`** (NEW) — thin route →
  `<CertificationSettings/>`. **NOT** admin-gated (operators read section A).
- **`src/app/(app)/admin/emission-estimates/page.tsx`** (REPLACED) — now an
  async server component that `redirect()`s to `/certification/settings`,
  preserving `?facility=`.

### Stage 3 — what shipped (all additive; old routes still resolve)

- **`src/lib/certification/readiness.ts`** (NEW) — the **pure, client-safe
  readiness classifier** `deriveRemovalReadiness(facts) → { state, reasons[] }`,
  state ∈ `submitted | inProgress | blocked | ready`. Extracts the inline logic
  that lived in `certify-panel.tsx` (`templateResolved` + `analyzeCoverage` +
  `submitReady`). **The single source reused by the Overview now, and by the
  Removals table hint + Review pre-flight in Stage 4** — keep it canonical.
- **`src/lib/certification/readiness.test.ts`** (NEW) — 19 Vitest cases
  (precedence, ready, every blocker class). All green.
- **`src/lib/certification/from-submission.ts`** (NEW) — extracted
  `readRemoteStatus` + `deriveSubmissionStatus(row, lockInFlight, artifact)`
  from the badge so list/queue surfaces filter on the **exact** verdict the
  badge renders. **`submission-status-badge.tsx` refactored** onto it (behaviour
  identical). Reuse this in Stage 4/5 DataTable status columns.
- **`src/fn/certification/overview.ts`** (NEW) —
  **`loadCertificationOverview(facilityId)`** → `{ removals:
  RemovalPreflightSummary[], ungroupedBatchCount, isProduction }`. Per removal
  it calls the existing `loadRemovalSubmissionContext` (same blocker inputs the
  submit pipeline uses) and runs the classifier. Exported from
  `fn/certification/index.ts`. Hook **`useCertificationOverview`** + key
  `certificationKeys.overview` in `use-certification.ts`. **Known cost** (per-
  removal Isometric refetch) logged in `docs/open-questions.md`
  → `perf/overview-facility-refetch`.
- **`src/components/certification/certification-tab-bar.tsx`** (NEW) —
  route-segment tabs (Overview / Removals / GHG Statements / Settings); active
  via `usePathname` (exact for `/certification`, prefix for the rest, so the
  Stage-4 review route keeps "Removals" lit); `?facility=` preserved via
  `useFacilityContext` (mirrors the sidebar — **not** raw `useSearchParams`, so
  no Suspense de-opt).
- **`src/app/(app)/certification/layout.tsx`** (MOD) — renders the tab band
  (`bg-white` + `container-max` + `<CertificationTabBar/>`) above `{children}`.
  Each page keeps its own `container-max py-32` + header → siblings (no nested
  container). **NOT admin-gated** (plan risk).
- **`src/components/certification/certification-overview.tsx`** (NEW) —
  `CertificationOverview` work queue: page EnvBanner → 4-stat strip → **Needs
  attention** (removals ready/blocked with reasons + statements awaiting/failed,
  each deep-linked) → `ProjectEmissionsDriftPanel`. Statement attention derived
  client-side via `deriveSubmissionStatus`. Select-a-facility EmptyState.
- **`src/app/(app)/certification/page.tsx`** (REWRITE) — tile grid → renders
  `<CertificationOverview/>`. Barrel exports added for the new components.

### Verification (end of Stage 3)
- `pnpm typecheck` → **exit 0**.
- `pnpm exec eslint <changed files>` (Stages 2 + 3) → **0 errors**.
- `pnpm vitest run` → **359 passed / 5 pre-existing skips (47 files)** — +19
  from `readiness.test.ts`.
- `pnpm build` → **compiles (16s) + build's full TypeScript pass (14.2s)
  succeed**. It then fails at *page-data collection* on a **pre-existing env
  safeguard** (`STORAGE_PROVIDER=local-fs` rejected in a production-mode build,
  per CLAUDE.md), via the unrelated `/api/storage-local/[...key]` route — **not
  a certification change**. Anyone building with the dev `.env.local` hits this;
  ignore for this work, or set production-shaped storage env to get a clean run.
- **Nothing committed** (user hasn't asked). Working tree carries Stages 1–3.

## Next: Stage 4 — Removals migration

Per the plan's rollout. Build, in order:

1. **`StepFlow`** shared primitive (CREATE) — minimal stepped-flow chrome (step
   rail, next/back, per-step validation). Used full-width by the removal review
   route and as a drawer by GHG create (Stage 5).
2. **Removals DataTable** — rewrite `removals/page.tsx` (currently `RemovalsHub`,
   card grid) to the `production-runs` DataTable idiom. Columns: removal (id +
   reporting window — **note: `certifier_removals` has NO `code`**, see
   `db/schema/certification.ts:240`), status badge (`SubmissionStatusBadge`
   `artifact="removal"`), member batches, **readiness hint from
   `useCertificationOverview` / `deriveRemovalReadiness`** (don't recompute).
3. **Side-sheet** via `?removal=<id>` (nuqs `useQueryState`) — read-only summary
   + history; **one-click Submit** when ready & 1:1, else **Review & submit** →
   the review route.
4. **`/certification/removals/[removalId]/review/page.tsx`** (CREATE) — guided
   full-width `StepFlow`: **Assemble → Review → Evidence → Pre-flight →
   Submit**. Evidence absorbs `SourcesPanel` + `TelemetryPanel` (telemetry stays
   its OWN status block — do not fold into the removal badge). Pre-flight = the
   classifier's `reasons` rendered as a checklist (this is where `certify-panel`
   logic finally migrates onto `deriveRemovalReadiness`, killing the
   duplication noted below). Assemble must **block regrouping a non-terminal
   removal** (ADR 0003).
5. **Redirect old `removals/[removalId]/page.tsx`** (currently Sources detail) →
   the review flow's **Evidence step** (so old Sources/telemetry links work —
   P2-c).

### Key reference points (file:line)
- Canonical blocker logic now in `lib/certification/readiness.ts`; the **inline
  copy still lives in `certify-panel.tsx`** (`analyzeCoverage`, `deriveBlocker`,
  `templateResolved`, `submitReady`) — Stage 4 migrates the panel/pre-flight
  onto the classifier and removes the dup. **Don't touch `certify-panel.tsx`
  until Stage 4/6** (cross-area credit-batch sheet risk).
- Removal row shape: `db/schema/certification.ts:240` (no code; `startedOn` /
  `completedOn` / `ghgStatementId` / `metadata`).
- Submission context (blocker inputs): `fn/certification/certify-context.ts`
  (`buildRemovalContext` ~259; `loadRemovalSubmissionContext` 427 — exported,
  used by the overview loader).
- Existing Removals UI to replace: `components/certification/removals-hub.tsx`.
- Existing submit wiring to reuse: `useSubmitRemoval` /
  `useSubmitCreditBatchRemoval` / `useAssignCreditBatchToRemoval` /
  `useEnsureRemovalForCreditBatch` in `hooks/use-certification.ts`.
- DataTable idiom reference: the `production-runs` list. nuqs side-sheet pattern:
  per CLAUDE.md `?removal=` + `useQueryState`.
- No `ui/tabs` primitive — route segments only (already done for the workspace).

### Then Stages 5–6
- **5 (GHG):** Statements DataTable + `?statement=` side-sheet; create upgraded
  to `StepFlow` drawer; **read-only membership** (ADR 0004); status from
  `deriveStatementStatus` fed by `metadata.remoteStatus` (**no per-row live
  fetch** — reuse `deriveSubmissionStatus`).
- **6 (Bridge + nav + cleanup):** credit-batch certify panel → read-only bridge
  + "Open in Certification →" (reverses ADR 0003 dual-entry → **write ADR
  0007**); sidebar single Certification entry (`app-sidebar.tsx:108-119`, accent
  `--clr-pink`); facility side-sheet certifier block → read-only summary +
  "Manage in Certification → Settings" (`facility-list.tsx:406-408`); remove dead
  wrappers; **sharpen Overview deep-links to the `?removal=` sheet / review
  route** (today they point at the hub/settings — `certification-overview.tsx`
  `removalAttention`/`blockedHref`); update `CONTEXT.md` submit-target
  distinction; **sync the stale `/admin/emission-estimates` reference** in
  `docs/open-questions.md:35`.

## Suggested skills / process for the next session
- **`frontend-design`** — for the DataTable + side-sheet + `StepFlow` surfaces
  (stay within the brutalist tokens; reference `production-runs`/`facilities` as
  the native layout).
- After each stage: `pnpm typecheck` · `pnpm lint` · `pnpm vitest run`. Add
  Vitest for any new pure logic (Assemble guard, pre-flight assembly).
- Before any PR: `/code-review` + `pr-review-toolkit:review-pr` (the last review
  pass caught real correctness bugs).

## Open choices deferred to implementation (sensible defaults in the plan)
Removal review step granularity; statement-create as a drawer; whether the
side-sheet's "Review & submit" and the table row deep-link to the same target.
Adjust during the build.
