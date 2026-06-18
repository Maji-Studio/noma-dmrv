# Remaining work to close the 200-year durability epic (+ adjacent P0s)

**Opened:** 2026-06-18 · **Branch context:** `feat/200yr-durability-submission`

Tracks what's left **after** Phases A–H of the durability build landed. This is a
work list, not a design doc — the design lives in:
- Build plan: [`2026-06-18-200yr-durability-submission-and-sampling-method-enforcement.md`](./2026-06-18-200yr-durability-submission-and-sampling-method-enforcement.md)
- Decision record: [`../adr/0013-registry-computed-durable-fraction.md`](../adr/0013-registry-computed-durable-fraction.md)
- Changelog: [`../isometric/changes.md`](../isometric/changes.md) (2026-06-18 entry, Phases A–F)
- Live gates / confirms: [`../open-questions.md`](../open-questions.md)
  (`isometric/durability-measurement-samples`)
- Compliance status: [`../isometric/p0-compliance-checklist.md`](../isometric/p0-compliance-checklist.md)
  (P0-03, P0-06), [`../isometric/condition-registry.md`](../isometric/condition-registry.md)

## Status of the build (for orientation)
Phases A–D (engines), G (docs), H (integration tests) and the Phase E **offline**
measurement-samples path are committed. Phase F (UI surfaces) is browser-verified
and committed (`8207862`). **The live submit path is fail-closed** — the stale
`carbon_rich_substance_sequestration` `INPUT_MAPPING` entry references a blueprint
the operator deleted when re-authoring the template, so durability removals cannot
complete until R1 lands.

---

## R1 — Phase E live measurement-samples submit wiring  **[blocks crediting]**
**Sandbox-gated; needs the operator (interactive 1Password).**

1. Run `NODE_ENV=development pnpm isometric:coverage-check -- --source=db` against the
   sandbox (project `prj_1K9YJ33RKSBX9FFF`, template `rvt_1KS4S43VPSBXA26X`).
2. Confirm the two empiricals (tracked in the open-questions entry). Doc evidence
   gathered 2026-06-18 (non-authoritative) gives a lean to verify against, not accept:
   - **H/C unit** — evidence leans **dimensionless (~0.5), NOT %**: Certify
     measurement-samples lists `H:C = DIMENSIONLESS_RATIO`; module §3 Table 2 treats
     molar H/C_org as a dimensionless *Ratio* (<0.5). So the current ×100
     `toHcMolarRatioPercent` in `src/lib/isometric/transformers/measurement-sample.ts`
     is **probably wrong** — confirm the blueprint *input* unit before flipping.
   - **Datapoint↔component-input binding** — evidence leans **explicit reference**
     (not auto-link by type/property). Confirm the exact field against `certify.d.ts` /
     `post-datapoint` or the live sandbox.
3. Wire the live path in `src/fn/certification/submit-removal.ts` (blueprint selection
   via `selectSequestrationBlueprintKey`, D6) and **replace the stale
   `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry**.
4. Record the conservative soil-temp method string on the `biochar_soil` datapoint
   (the `CreateMeasurementSampleRequest` body has no description field — confirm where
   it lands).
5. **Done when:** a sandbox durability removal submits end-to-end and the registry
   computes `F_durable,200` from the submitted datapoints; close the open-questions
   entry; append the decision to `changes.md`.

## R2 — coverage-check script papercut  **[trivial; do alongside R1]**
`scripts/isometric-coverage-check.ts` doesn't default `NODE_ENV`. Add
`process.env.NODE_ENV ??= "development"` so the operator's invocation doesn't depend
on an exported env. (Flagged in the build plan §6 Phase E.)

## R3 — P0-03 DB-layer guardrail for Method B  **[defense-in-depth]**
App-layer enforcement exists (`validateReactorSamplingMethodFn` 30-sample switch check;
`deriveSamplingRequirement` cadence engine; `evaluateDurabilitySubmissionGates` fail-
closed gates). **Missing:** a DB trigger/function so direct SQL that violates the
30-sample minimum or the ≥1/10 cadence fails at the DB layer. Tracked `in_progress` in
`p0-compliance-checklist.md`. Coordinate with [[never-edit-applied-migrations]] — new
migration, never an in-place edit.

## R4 — P0-06 DB-layer guardrail for durability completeness  **[defense-in-depth]**
Removal submission already fail-closes on incomplete durability evidence. **Missing:** a
`verified`/`issued`-transition DB guardrail ensuring linked applications carry the
required temperature + source evidence for 200-year batches. Tracked `in_progress` in
`p0-compliance-checklist.md`.

## R5 — ADR-0005 project-emissions scope conflict  **[separate P0; plan exists]**
The coverage-check surfaced a pre-existing bug: project-establishment emissions declared
removal-scope. Independent of the durability build. Plan already drafted:
[`2026-06-17-remove-project-emissions-journal.md`](./2026-06-17-remove-project-emissions-journal.md).
Sequence after R1 or in parallel — it touches the same submit path, so land R1 first to
avoid conflicts.

## R6 — 1000-year durability quantification  **[deferred, D7]**
Inputs (R₀ mean/std, non-reactive carbon) are captured on samples, but
`computeFDurable1000` is unimplemented and there's no 200/1000 pathway segregation. Lowest
priority — no current demand. Build plan §7 records the deferral.

---

## Suggested sequence
1. **R1 + R2** together (unblocks crediting; R2 is a one-liner the operator needs).
2. **R3, R4** (DB guardrails) — can run in parallel with R5; both are additive migrations.
3. **R5** after R1 (shares the submit path).
4. **R6** when 1000-year demand appears.

## Suggested skills for the next session
- **`isometric` MCP** (`how_to` first) — R1 confirms once the coverage-check is run.
- **`add-migration`** — R3/R4 DB guardrails.
- **`fix-bug`** / the existing R5 plan — project-emissions scope conflict.
