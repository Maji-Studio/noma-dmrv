# Remove the project-emissions journal (supersede ADR 0005)

> **Type:** execution plan / handoff · **Created:** 2026-06-17
> **Decision owner:** @kenji · **Status:** approved in principle, ready to execute
> **Do NOT execute on** `test/evidence-gap-parity-followups` or `staging` — cut a
> fresh branch (suggest `refactor/remove-project-emissions-journal`).

## TL;DR

Delete noma's **project-emissions journal** (the LCA-value transcription
subsystem from [ADR 0005](../adr/0005-period-emissions-as-project-components.md))
entirely. **Keep** the one piece that maintains no data and protects
submission integrity: the scope-conflict guard in the Removal transformer.
Record the posture flip in a new **ADR 0013** that supersedes 0005.

This is **Option C-keep-the-guard** from the design discussion.

## Why (one paragraph)

ADR 0005 chose "Posture B": noma journals LCA-derived emission magnitudes per
category, the operator publishes the same values as PROJECT-scope Components in
the Isometric UI, and a drift panel + nightly coverage check reconcile the two.
The decision now: that journal is a **rot-prone duplicate**. The verifier audits
through **Isometric**, not noma — so the audit trail belongs on the Isometric
Project Components (LCA PDF attached to each component's **Sources** field), where
it is actually inspected. noma's second copy adds a duplicate data-entry surface
and a drift panel that throws false alarms once the copy drifts. For MVP it is
unneeded burden. Project emissions can be **read back from Isometric later** if
desired — the read primitive already exists (`getProject().components`, used today
by the drift panel) — so deferring is cheap and reversible-forward.

## What survives the removal (do NOT delete)

1. **The scope guard** — `PERIOD_INPUT_TUPLES` + the `SafeError` branch in
   `src/lib/isometric/transformers/datapoint.ts` (~lines 287–420). It maintains
   **zero data**; it statically stops a future template author from wiring a
   project-scope emission (e.g. pyrolyzer CH₄) onto a **Removal** datapoint, which
   would silently double-count it into the carbon math. Two edits:
   - Rewrite the error message (currently points at the deleted journal /
     `/admin/emission-estimates`) to: *"publish this as a Project Component in the
     Isometric UI."*
   - Make `PERIOD_INPUT_TUPLES` **self-contained** (string literals) so it no
     longer imports the deleted `projectEmissionCategory` enum or matcher.
2. **The ADR-0001 emission-estimate config** (genset yield, stage-split, soil
   temp) — lives in the *same* `src/db/schema/certification.ts` file but is a
   different feature. **Stays.** Remove only the `certifier_project_emissions`
   table from that file.

## Operational expectation to record in ADR 0013

Because the audit trail now lives **only** in Isometric: the operator MUST attach
the LCA PDF to the **Sources** field of each Project Component (the
"No sources / 1 source" chips in the registry UI). This replaces noma's
`sourceDocumentId` FK as the system-of-record for "what justifies this figure."
State this explicitly in the ADR — it is the load-bearing assumption that makes
full removal safe, especially for the one potentially-material category
(`pyrolyzer_direct`, CH₄/CO).

## Open confirmation (carry into execution)

- **Pyrolyzer CH₄ source-of-record.** With full removal noma holds no audit copy
  for the one category that may be materially large. User chose C anyway, on the
  basis that it's sourced in Isometric. Treat as **accepted**; the ADR's
  "attach Sources in Isometric" expectation is the mitigation. (Last reconfirm was
  outstanding when the session paused — re-confirm verbally before merging.)

## Execution order

1. **Write ADR 0013** *first* (decision recorded before code moves):
   `docs/adr/0013-isometric-owns-project-emissions.md` (or similar slug).
   Capture: the posture flip, the kept guard, the "attach Sources in Isometric"
   expectation, and the future read-back path. Then add a
   `> **Superseded by ADR 0013**` banner to the top of ADR 0005 (keep 0005 as the
   historical record — do not delete it).
2. **Run the removal** as a clean feature removal (see footprint below).
3. **Edit the surviving guard** (`transformers/datapoint.ts`) per "What survives".
4. **Docs scrub** — references to the journal in:
   `docs/isometric/integration-plan.md` (Phase 3.7 period-inputs),
   `docs/isometric/sandbox-template-authoring.md` ("Omitted from MVP" note),
   `docs/open-questions.md` (the apportionment / `phase-3.7-period-inputs` thread).
   `CONTEXT.md` likely needs **no** change — it has no "project/period emission"
   glossary term; "Emission estimate" there = the ADR-0001 config, which stays.
   Verify "Zero stub" definition still reads correctly.
5. **Schema drop = reseed, not migration** — no prod data (per the
   `not-live-reseed-not-migrate` convention). Drop the table + enum via the schema
   change and let `pnpm db:reset` rebuild. Generate a migration only if the team
   wants the drop captured in migration history.
6. **Verify:** `pnpm lint` + `pnpm typecheck` + relevant tests (see below).

## Removal footprint

**Delete files:**
- `src/schemas/project-emissions.ts`
- `src/data-access/project-emissions.ts`
- `src/fn/certification/project-emissions.ts`
- `src/hooks/use-project-emissions.ts`
- `src/components/admin/period-emissions-section.tsx`
- `src/components/admin/period-emission-source-upload.ts`
- `src/components/certification/project-emissions-drift-panel.tsx`
- `src/lib/isometric/utils/project-emission-match.ts` (`CATEGORY_TO_BLUEPRINT` + matcher)
- `scripts/isometric-coverage-check.ts`

**Edit (remove the project-emissions parts only):**
- `src/db/schema/certification.ts` — drop the `certifier_project_emissions` table
  (~lines 136–208); keep everything else in the file.
- `src/db/schema/common.ts` — drop the `projectEmissionCategory` enum (~lines 229–251).
- `src/schemas/certification.ts` — drop any project-emission re-exports/schemas.
- `src/fn/certification/index.ts` — remove the `./project-emissions` re-export block
  (lines ~94–104: `createProjectEmission`, `editProjectEmission`,
  `loadProjectEmissionById`, `loadProjectEmissionsForFacility`,
  `loadProjectEmissionDrift`, `removeProjectEmission`, `type ProjectEmissionDriftRow`,
  `type ProjectEmissionDriftState`, …).
- `src/components/certification/certification-settings.tsx` — remove
  `<PeriodEmissionsSection>` and `<ProjectEmissionsDriftPanel>` (and their imports
  at lines ~34 / ~272–276); keep the `EmissionEstimatesForm` (ADR 0001) in the same
  SettingsSection.
- `package.json` — remove the `"isometric:coverage-check"` script (line ~37).
- `.github/workflows/isometric-health.yml` — remove the coverage-check step;
  **preserve** any other read-only health ping in that workflow (inspect first —
  it may do more than the coverage check).

**Keep / edit, do NOT delete:**
- `src/lib/isometric/transformers/datapoint.ts` — keep guard, edit message + tuples.
- `src/db/errors.ts` — `isPgUniqueViolation` only; the guard's `SafeError` is
  defined elsewhere (verify: likely `src/lib/errors.ts`). Keep it.

**Verify-then-handle (not yet confirmed):**
- `src/lib/isometric/utils/aggregation.ts` — appeared in the original blueprint-key
  grep; confirm whether it references the journal/matcher and clean up if so.
- `src/lib/certification/certify-field-registry.ts` — same: confirm it doesn't
  depend on the removed categories.

## Verification

```bash
pnpm lint
pnpm typecheck
# tests touching the removed/edited surfaces:
#  - transformer guard (datapoint.ts) — message + tuple self-containment
#  - any project-emissions unit tests (delete alongside their subjects)
#  - submission transformer tests must still pass with the guard kept
pnpm db:reset   # confirm schema rebuilds cleanly without table/enum
```

Grep for dangling references after deletion:
```bash
grep -rn "projectEmission\|project-emissions\|certifier_project_emissions\|CATEGORY_TO_BLUEPRINT\|PeriodEmissions\|DriftPanel\|isometric-coverage-check" src scripts .github docs
```
Expect zero hits outside ADR 0005 (historical) and ADR 0013 (the new record).

## Suggested skills for the next session

1. **`grill-with-docs`** (resume) → write **ADR 0013** + mark ADR 0005 superseded.
   The ADR is the gate; do it before touching code.
2. **`remove-feature`** → execute the deletion footprint above with proper
   dependency-order removal and a verification pass.
3. **`sync-docs`** → scrub `integration-plan.md`, `sandbox-template-authoring.md`,
   `open-questions.md` references in-place.
4. **`commit`** / **`open-pr`** (base = `staging`) once green — fresh branch only.

## Key references

- Existing decision being superseded: `docs/adr/0005-period-emissions-as-project-components.md`
- Domain glossary: `CONTEXT.md` (terms: Emission estimate, Monitored input, Fixed
  constant, Zero stub — none name the journal directly)
- The kept guard: `src/lib/isometric/transformers/datapoint.ts:287` (`PERIOD_INPUT_TUPLES`), `:416` (SafeError)
- Isometric model confirmation: these three lines ("Sampling consumables",
  "Lab analysis electricity", "sample transport to EU") are PROJECT-scope
  Components, amortized server-side (`ProjectComponentAmortizationStrategy`,
  default `CUSTOM_TIME_PERIOD`) — confirmed via the `isometric` MCP `how_to` +
  `protocols_analyze` (biochar protocol → ghg-accounting / energy-use-accounting
  modules). Not per-sample; nothing attaches to the `samples` table.
