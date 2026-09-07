# Simplification rollout plan (2026-09-07)

- **Owner:** Kenji Nguyen
- **Status:** proposed. Phase A is ready to hand to an implementation agent once approved. Phase B is a decision list for the owner.
- **Last reviewed:** 2026-09-07 (against `origin/staging` at `ecbfb16a`)

This plan is the review of, and the execution plan for, the [simplification analysis](./2026-09-07-simplification-analysis.md). Two reviewers re-checked that analysis against the code: Claude Fable 5.1 (spot checks of every phase-1 item) and gpt-6-astra at very high reasoning (all 56 findings, read-only). Where the two agreed with each other and with the code, the item is listed below without comment. Where they corrected the analysis, the correction is stated and was verified by hand before it was adopted.

## Review verdict

The analysis is directionally right and its counts hold within about five percent. Its weakness is the word "mechanical". Roughly half of the items it labels as safe for a bulk agent carry an exception that a blanket transform would break: a field-error branch, a log context, a live test in a "dead" test file, a helper whose call is real work rather than a passthrough. None of those exceptions makes the item wrong. They make the manifest the deliverable, not the transform.

Re-measured counts: 76 dead hook exports plus 20 query-key factories (analysis said 74 plus 19), 221 hand-rolled unwraps (218), 138 catch blocks across 23 `src/fn` files (129), 12 pagination sites (12), 5 dead skeletons (4), 15 dead data-access exports (13).

### Corrections adopted from the reviews

Each of these was checked against the file named and changes what goes into Phase A.

1. **Finding 34 is partly wrong.** `src/fn/certification/certify-entity-readiness.ts` is not a field-for-field passthrough. It calls `buildEntityReadinessResult` and has a live caller at `certify-context-core.ts:698`. Keep it. Only `removal-grouping.ts`, the two unused `ensure*EvidenceLedgerSource` loaders and `buildEntityReadinessGaps` are dead.
2. **Finding 14 is not a one-for-one test retarget.** The dead preflight builder checks transport completeness through `transportGapReasons`; the live requirements builder checks transport presence and uniformity as two separate rows. The deletion is safe because nothing calls the clone, but the tests must be rewritten against the live builder's own semantics, not renamed.
3. **Finding 4 names a live test file as compute-only.** `ghg-statement-breakdown.test.ts:42` tests `hasExactGhgEntryMembership`, which is live. Delete only the `computeGhgStatementBreakdown` describe blocks.
4. **Finding 2 has non-equivalent sites.** `use-bin-movements.ts:87` and `:104` throw typed field errors, and other hooks project the result rather than return it. Rewrite only bodies that match the five-line form exactly. About seven sites stay as they are.
5. **Finding 3's seam needs two things, not one.** The per-entity mappers pass both a message (`"reactor action failed"`) and an `op` context. `withAction` logs a flat `"server action failed"`. The new option must carry both. Seven actions branch on custom error classes (`StockTakeIncreaseError`, `StockOverdrawError`, `ProductionRunOverlapError` twice, `ProductionRunDependencyError`, `SafeError` twice) and need an explicit `mapError` hook, and `dashboard-overview.ts:55` has a schema-mismatch branch of its own.
6. **Finding 6 is a behaviour change, not a swap.** `useRemovalPreflightSummaries` gives every row its own `retry` and a `refetchInterval` poll. `loadCertificationOverview` is an all-or-nothing `Promise.all`. Pointing the hub at it removes per-row retry and polling. Moved to Phase B.
7. **Finding 29's cache would weaken the submission.** `compileBiocharApplicationIntents` re-reads mutable application, location and project rows. Reusing the first result across the three hash assertions makes all three hash the same possibly-stale values. Moved to Phase B with a recommendation to drop it.
8. **Finding 30 has a reflective consumer.** `src/lib/cli/verify-db-schema.ts:91` iterates `Object.values(schema)` for `pgEnum`s. Deleting the declarations without a `DROP TYPE` migration makes that check inconsistent. Ship the declaration removal and the migration together in their own PR.
9. **Finding 36 is refuted as written.** `docs/archive` is fully tracked (247 files), `docs/README.md` preserves it by policy, and active docs link into it (`docs/adr/0008-submission-ledger-internal-seam.md:12`, `docs/open-questions-isometric.md:584`). Markdown-only volume is 32,154 lines, not 67,314. Moved to Phase B as a policy question.
10. **Finding 1's query-key privatisation is per key.** `productionRunKeys` is imported by five other hook files. Drop `export` only where a grep shows no external importer.
11. **Finding 27's gap constants are live** inside `tests/helpers/application-evidence-fixtures.ts` (22 uses). Delete the six unused helpers and the 14-line namespace block only.
12. **Appendix A13 and A14 are refuted.** `CustomerLocationDetail` extends the database row and requires a nested `customer`, so it is not the 14-field shape; `CustomerDetail["locations"][number]` is. The phone schemas differ (facilities has a regex, suppliers only a length, drivers allow null), so sharing them changes accepted input.
13. **Finding 24 needs a mapping layer.** `getStatusState` in `src/lib/status-state.ts` does not recognise `met`, `unmet`, `skipped`, `warning` or `active`. Routing the check rows through it unchanged renders them neutral.
14. **The line-count target is not additive.** Hook deletions overlap the unwrap rewrite, schema deletions overlap the update-schema work, and the carbon and diagnostic estimates include tests while the baseline excludes them. A realistic Phase A net is 6,000 to 8,000 source lines. Do not use a line count as an acceptance criterion.

### Where the two reviewers disagree

- **Finding 5 (`/schema`).** gpt-6-astra calls it a product decision. Fable agrees on deletion but would gate the route now: removing `"/schema"` from `PUBLIC_ROUTES` is one line, reversible, and closes anonymous disclosure of the full schema. Listed in Phase B with that as the recommended default.
- **Appendix A19 (one-off scripts).** Both scripts document a manual entry point and `isometric-link-demo.ts` is referenced twice from an archived doc. gpt-6-astra wants an explicit retention decision. Fable considers them safe to delete (issue #104 is closed, the demo job is now self-serve UI) but the question costs nothing, so it is in Phase B.

### Housekeeping before any branch is cut

- The local `codex/fix-submission-progress` checkout holds uncommitted edits to `ghg-statement-report/pdf.ts` and `pdf.test.ts` (its two commits are already in staging as PRs #731 and #738). Decide whether those edits land before A4 touches the GHG report folder. Every Phase A branch cuts from `origin/staging`.
- Both plan docs land on staging through their own docs PR so the implementation PRs can link to them.

## Phase A: autonomous, no owner input

Every item here has an outcome fully determined by the code: dead code with no consumer, or a rewrite whose before and after are provably identical. Rules for the whole phase:

- Branch from `origin/staging`, one PR per numbered item, base `staging`, per `CLAUDE.md`.
- No user-facing copy changes, no behaviour changes, no new error messages. If an item cannot be finished without one, stop and move that slice to Phase B.
- Gate for every PR: `pnpm lint`, `pnpm typecheck`, `pnpm check:org-scoping`, `pnpm check:spacing-scale`, `pnpm check:ux-copy`, `pnpm docs:check`, `pnpm exec vitest run`. `wc -l` on every touched file stays under 1000.
- Deletion PRs start with a manifest file in the PR description: symbol, defining file, and the grep that proves no consumer across `src`, `tests`, `scripts`, `.github` and `docs` (excluding `docs/archive`). Grep for string references and mocks (`vi.mock`) as well as imports.

### A1. Dead-code sweep

Findings 1, 13, 15, 16, 17, 20, 27, appendix A2 and A18, and the rendering half of 4. Split into four commits by area (hooks, schemas, data-access and fn, components and tests).

- Hooks: all `usePrefetch*` (18), `use*CacheInvalidation` (11), `use*CodeCheck` (12), the 11 `use-entities` convenience wrappers, and the remaining per-entity detail and by-facility hooks with no importer. Delete the options vertical (finding 17) in the same commit: `getSupplierOptions`, `getFormulationOptions`, `getFeedstockOptions`, `getSampleOptions`, `getBiocharProductOptions` and their `fn/` wrappers, plus the mock at `tests/biochar-product-update.test.ts:20`. Drop `export` from query-key factories only where no other file imports them. Do not touch `use-production-run-reading-imports.ts` or `use-telemetry-submission.ts` (Phase B).
- Schemas: nine `*SelectSchema`, the vehicle, driver and operator create, update and delete schemas, `hasCompleteGpsPair`, `GPS_PAIR_MESSAGE`, `optionalMassKgInputSchema`, `optionalStoredPercentValue`, `documentMetadataSchema`, `addressSchema` with its block in `tests/facilities-schema.test.ts`, and the 23 dead `Delete<Entity>Data` aliases. Leave the `createXSchema = xFormSchema` alias renaming out; it is wide and adds nothing.
- Data-access and fn: the 15 uncalled exports (the analysis's 13 plus `getTransportLegById` and `getProductionRunBiocharPreviewFn`), `removal-grouping.ts`, the two unused `ensure*EvidenceLedgerSource` loaders, `buildEntityReadinessGaps`. Make `generateNextCode` module-private rather than inlining it. Fix the stale comments at `status.ts:57`, `readiness.ts:868` and `certify-field-registry.ts:394` to name `assertCreditBatchNotCertificationLocked`. Appendix A2 symbols in `src/lib/isometric` and `src/lib/certification` go here too, except `SEQUESTRATION_1000_YEAR_COMPONENT_CONTRACTS` and `buildBiocharUnsampledBatchSample`, which encode protocol content and wait for Phase B.
- Components and tests: `blueprint-list.tsx`, `certify-panel.tsx`, the stale docstring at `sources-panel.tsx:11`, the cert barrel cut to what its six importers use; `view-related-link/`, `src/stores/`, `src/utils/`, five dead skeletons; `zustand` and `bcryptjs` removed with `pnpm remove` so the lockfile follows; the six dead E2E helpers and the 14-line namespace block at `tests/fixtures/submit-removal-orchestrator.ts:165`. `carbon-breakdown.tsx` shrinks to `Shell` and `CarbonBreakdownSkeleton` (rename to `carbon-breakdown-skeleton.tsx`), `removal-breakdown.ts` and its two tests go, and only the compute describe blocks leave `ghg-statement-breakdown.test.ts`. `sync-event-log.tsx` loses its table branch, `Th` and `Td`, keeping the five-event slice at line 41. Update `removal-detail-sheet.test.ts` for the renamed import in the same commit.

Risk: low. Gate: manifest plus the standard gate. Expected net: about 4,000 lines.

### A2. Unwrap rollout (finding 2)

After A1. Rewrite every `queryFn` and `mutationFn` body that is exactly the five-line `if (!result.success) throw new Error(result.error); return result.data;` form to `unwrap(await xFn(args))`. Skip any body that inspects `result.field`, `result.conflict`, or returns anything other than `result.data`. Record the skipped sites in the PR. Gate: `grep -rn "throw new Error(result.error)" src/hooks` returns only the excluded sites and the helper. Risk: low.

### A3. `withAction` seam and migration (finding 3)

Two PRs. First, extend `WithActionOptions` with `log?: { message: string; context?: Record<string, unknown> }` threaded into `logActionError`, and `mapError?: (error: unknown) => ActionResult<never> | undefined` consulted before the generic fallback. Add tests to `tests/with-action.test.ts` for both. Second, one entity per commit, convert the 23 hand-rolled files and delete the 13 private mappers, passing the entity's existing message and `op` so the log output is byte-identical. The seven custom-class branches become `mapError` callbacks returning the same `{ success: false, error, field? }` shapes they return today. Gate: `grep -c "} catch (error) {" src/fn/*.ts` under 20, and every converted action's existing test still passes without edits to its assertions. Risk: medium. This is the PR to review most carefully.

### A4. Small exact extractions

- Finding 14: delete `buildRemovalPreflightChecklist` and its four private helpers; rewrite the `describe("buildRemovalPreflightChecklist")` block and the five scattered calls against `buildRemovalRequirementsChecklist`, asserting the presence and uniformity rows separately.
- Finding 23: add a `QueryState` render-prop in `src/components/ui/` and use it only where the loading and error branches are byte-identical to the two in `facility-certifier-section.tsx:229` and `:314`. The copy is passed in by the caller. Sites whose error branch keeps stale data (`ghg-statement-workflow.tsx:149`) stay as they are.
- Finding 31: delete the seven `useMemo` and `useCallback` calls in the six list files. Leave `form-spine.tsx` and `data-table/index.tsx`.
- Appendix A15: one `mockWithAction(orgCtx)` helper shared by the four byte-identical test preambles. The diagnostic test keeps its own.
- Appendix A16: extract the submit dialog's flag and title derivation into a pure function beside `ghg-statement-workflow-state.ts` with a table-driven test that pins every current output. No label changes. Do this only if the `pdf.ts` working-tree edits have landed, since the folder is in flux.

Risk: low. Gate: standard, plus render tests where the touched component has one.

### A5. Data-access consolidation, behaviour-identical

Findings 8, 26, the expression half of 22, appendix A3 and A7. One PR per entity for 8 and 26 together.

- Per entity: hoist one selection object and one join chain shared by the list and getById queries. Where the selection references a scoped aggregate built inside the function (`biochar-products.ts:392`), parameterise it rather than hoisting. Every join keeps its `organizationId` predicate and its executor.
- Paging: `resolvePaging(filters)` and `countRows(ctx, executor, table, where)` in `src/data-access/utils.ts`. The count helper takes `ctx`, calls `requireOrgScope`, and composes the org predicate itself, so the single waiver lives in one place with a real reason. Sort defaults differ per entity (`reactors.ts:102`, `production-runs/queries.ts:141`) and stay in the caller.
- Finding 22: export the `coalesce(deliveries.biocharProductId, orders.biocharProductId)` expression from one module and import it at the 12 sites. Do not merge the queries around it; they count different things.
- Appendix A3: move `samplingDayOf` and `formatDayInZone` into one module imported by both durability files.
- Appendix A7: replace the chunked per-removal loop at `certify-context-core.ts:920` with `getCreditBatchSummariesByRemovalIds` and `getLatestSubmissionsForEntities` plus `Map` lookups. Add a test for empty input and for two removals in different facilities.

Risk: medium, because every moved query is an org-scoping seam. Gate: standard, plus a cross-organisation fixture test for each moved list and getById, and `tests/bin-stock-guards-concurrency.test.ts` and `tests/bin-reconciliation-integrity.test.ts` green for the coalesce change. Finding 25 (folding satellites back) is optional afterwards and only where a file has real headroom; a single importer is not on its own a reason to fold.

### A6. Dead enums with migration (finding 30)

Its own PR. Delete `userRole`, `lossEntityType` and `lossTypeCode` from `src/db/schema/common.ts`, run `pnpm db:generate`, inspect the generated SQL for anything beyond three `DROP TYPE` statements, and run `pnpm db:reset` on a local database to prove the chain. Do not edit historical migrations. Risk: low, but tell the owner before merge because `migrate.yml` applies it to the shared staging database.

## Phase B: needs the owner

Each row is one decision, phrased as the question an agent cannot answer from the code, with the recommended answer and what can be prepared in advance so the decision takes minutes.

| # | Finding | Question | Recommended | Prepared in advance |
|---|---------|----------|-------------|---------------------|
| B1 | 5 | Keep `/schema` public, gate it to platform admins, or delete it? | Gate now, delete later | Two ready patches: the one-line `PUBLIC_ROUTES` removal, and the full deletion (3,235 lines) |
| B2 | 9, 1 (reading imports) | Wire telemetry submission and reading imports into the UI, or retire both verticals? ADR 0006 and `open-questions-isometric.md:579` track telemetry as parked with a resolution path. | Ask; do not guess from protocol memory | Dependency graph for both verticals, a retirement manifest, and the sandbox steps the ADR requires to call it resolved |
| B3 | 10 | Keep both diagnostic views, keep only the trace view, or replace the pane with the `isometric-smoke.ts inspect-template` report? | Trace view only | Side-by-side list of what each view answers that the CLI cannot |
| B4 | 35, protocol A2 | Wire the 12 contaminant columns into the sample form, or drop them with `numeric-precision.test.ts`? Same question for the two protocol-bearing isometric constants. | Decide after the registry check | Run `how_to` on the isometric MCP and quote the biochar module text on contaminant reporting, verbatim, with the escape branch if one exists |
| B5 | 6 | Batch the hub's shared facts while keeping per-row retry and polling, or accept a blocking facility-wide load? | Batch shared facts, keep per-row rows | Design note comparing both, including partial registry failure and the invalidation test at `use-certification-invalidation.test.ts:76` |
| B6 | 29 | Keep the three builds, or design an immutable guarded snapshot that permits reuse? | Keep the three builds; drop the finding | A mutation-between-builds test case showing why caching defeats the hash checks |
| B7 | 18 | Which error copy for the ~31 hand-rolled existence checks: keep each site's current message, or standardise? | Keep each message via a message-preserving helper; then the migration is Phase A work | Enumerated list of the 31 sites with their current message and whether they check `archivedAt` |
| B8 | 7, 11, 24, 32, A8 to A11, A17 | Standardise or preserve the current UI differences: amber versus red unmet checks, six deep-link toast strings, Escape dismissal on the data table, shared party fields? | Standardise the deep-link guard and copy; keep the rest | A discrepancy matrix with markup for each difference, so behaviour-preserving extraction can be separated from the chosen changes |
| B9 | 33, A14 | Apply the facility phone regex everywhere, or keep entity-specific validation? Same for nullable-versus-optional on update. | Keep entity-specific; extract only exact matches | Input examples accepted by one schema and rejected by another |
| B10 | 36 | Keep the archive policy in `docs/README.md`, or relocate history with replacement links? Commit the 133 untracked QA reports, or gitignore `docs/qa/`? | Keep archive; gitignore generated QA artifacts, commit the reports worth keeping | Tracked-versus-untracked inventory and the list of active backlinks into the archive |
| B11 | 37 | Leave the day-boundary compat in place? | Yes | Read-only audit spec for the sandbox project covering timestamp equivalence, not just the `T00:00:00.000Z` suffix |
| B12 | A19 | Delete the two one-off scripts? | Yes | Nothing; one-line answer |
| B13 | 28 | Introduce a composite CI action? It cannot own the checkout, and `migration-gate.yml` checks out a base revision that will not yet contain it. | Yes, in two stages | Workflow diff with unchanged refs, permissions and cache keys |
| B14 | 21 | Two-phase the bin picker aggregates? | Only with a measured plan improvement | `EXPLAIN` on a seeded local database before and after, on the same file as its A5 projection extraction |

## Sequencing

A1 and A2 first, in that order, since A2 rewrites sites A1 deletes. A3's seam PR can land in parallel with A2; its per-entity PRs follow. A4 and A6 are independent and can run alongside. A5 last within Phase A. Phase B decisions B1, B7 and B12 are one-liners and unblock the most follow-on work, so ask them first. Nothing in Phase B blocks anything in Phase A.
