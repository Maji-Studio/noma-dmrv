# Simplification and optimization analysis (2026-09-07)

- **Owner:** Kenji Nguyen
- **Status:** proposed. No finding has been implemented; phase 1 is ready for a bulk implementation agent once the owner approves it.
- **Last reviewed:** 2026-09-07 (against branch `codex/fix-submission-progress`)

## Summary

Four analysts covered the server data layer, the certification and Isometric stack, the client UI layer, and the cross-cutting tooling. Their findings converge on one story: this codebase is architecturally sound and its shared primitives are well built, but the good abstractions were written and then never rolled out, so the same five or six shapes are typed by hand once per entity. The excess comes from three places in roughly equal measure: per-entity copy-paste (the list scaffold in 15 files, the hook file in 20 files, the data-access projection written twice per entity), boilerplate that a helper already solves elsewhere in the same directory (218 hand-rolled `ActionResult` unwraps beside `unwrap()` in `src/hooks/types.ts`, 129 hand-rolled try/catch blocks beside `withAction()` in `src/fn/with-action.ts`), and code that stopped being reachable when a design was superseded but still compiles and still has tests. If the confirmed items are done, a realistic reduction is 12,000 to 15,000 lines of the roughly 201,000 lines of source, with no behaviour change, plus about 108,000 lines of markdown that can leave the working tree.

The three highest-leverage moves are: replace the 218 hand-rolled unwraps and delete the 74 dead hook exports (both purely mechanical, together about 2,300 lines, verified exactly); migrate the 19 remaining `src/fn/*.ts` files onto `withAction()` after giving it a `logContext` option (about 1,400 lines, and it collapses 13 identical per-entity error mappers into one seam); and point the Removals hub at the already-written batched loader `loadCertificationOverview`, which is dead today, cutting a 10-removal hub from about 10 server actions and 30 uncached Isometric HTTP calls to 1 and 3.

The main thing not to do is treat the Isometric gates and the registry-facing compat code as removable. Every submission gate the certification analyst inspected has exactly one implementation and a live call site, and the day-boundary production-batch reconciliation in `src/fn/certification/production-batches.ts` guards state that lives on the remote registry, not in our database, so the pre-production rule does not apply to it. Second warning: do not delete anything on knip's word alone. Across every case checked here, knip was flagging a barrel re-export line while the underlying symbol was alive via a direct import.

## Themes

**The abstraction exists but was never rolled out.** This is the single largest source of volume, and it is unusual in being cheap to fix. `src/hooks/types.ts:7` exports `unwrap<T>(result)`; three hook files use it and 20 do not, leaving 218 five-line copies of its body. `src/fn/with-action.ts` resolves org context, catches `ZodError` and `ActionConflictError`, logs, and formats `ActionResult`; 16 fn files use it and 23 do not, leaving 129 hand-rolled catch blocks and 13 byte-identical `*ActionError` mappers. `src/data-access/utils.ts:32` exports `assertSameOrg`; 19 data-access files import it and about 31 sites still write the eight-line select-and-throw by hand. In every case the newer files use the helper and the older ones predate it, so this is accretion order, not disagreement about design.

**Per-entity copy-paste instead of a factory.** The project was grown by copying a reference entity (documented in `TEMPLATE_USAGE.md`) about 15 times. That produced 15 list components sharing roughly 180 lines of scaffold each, 20 hook files each carrying a full prefetch / cache-invalidation / code-check suite that nothing calls, 12 data-access files each repeating a 30-line pagination scaffold, and 12 entity-select adapters in `src/data-access/entities/` that differ only in the table name and one column. The cost is not only lines: the copies have drifted. `src/components/customers/customer-list.tsx` renders a hand-rolled `role="alert"` div where `src/components/reactors/reactor-list.tsx` uses `<ServerError>`, and six deep-link error effects across the list files carry six different in-flight guards, two of which can fire mid-fetch and drop a valid link.

**Superseded designs left standing.** Certification carries two whole pipelines that nothing reaches. The local carbon-estimate path (`CarbonBreakdownCard` plus `computeRemovalBreakdown` and `computeGhgStatementBreakdown`, about 1,800 lines) became unreachable when both surfaces switched to `RegistryCarbonResultCard`, but its tests still pass so nothing flagged it. `src/lib/certification/readiness.ts` carries a 190-line dead clone of its own live checklist builder. The Removals hub has three parallel implementations of one facility walk, and the efficient one is the dead one. The pattern is consistent: the replacement landed, the old path kept its tests, and the tests kept it alive.

**The 1000-line cap is producing splits that are not concept boundaries.** `src/data-access/credit-batches.ts` is 990 lines, `samples.ts` 990, `deliveries.ts` 997, `biochar-products.ts` 987, `credit-batch-accounting.ts` 981. Around them sit satellites with a single importer each: `credit-batch-delete-slices.ts` (43 lines), `credit-batch-lineage-types.ts` (83), `delivery-distance-projections.ts` (29), and a `src/data-access/samples/` directory holding one file. These are relief valves, not seams. The fix is not to raise the cap but to remove the duplication inside the parents first, at which point several satellites can fold back in and the files still fit.

**Tests that assert file text rather than behaviour.** Twelve test files across `src/` and `tests/` use `readFileSync` plus `toContain` on component source, 845 lines in total. `src/components/certification/removal-detail-sheet.test.ts` pins an exact import statement; the two `*-location-form-parity.test.ts` files exist only to hand-check that the customer and supplier forks stayed in sync. These fail on any rename and pass through any behavioural regression, which is the exact failure mode this project already recorded once for the onboarding E2E. The repo has the right pattern next door in `src/components/party-location-dialog-submit.test.tsx`, whose own header calls the grep tests out.

## Findings, ranked by value/risk

All LOC figures are estimates. Where I re-measured, the corrected number is given in the verification note.

| # | id | title | region | category | est. LOC | risk | effort | verdict |
|---|----|-------|--------|----------|----------|------|--------|---------|
| 1 | dead-hook-exports | 74 dead hook exports plus 11 dead `use-entities` wrappers | hooks | dead-code | -1,700 | low | M | confirmed |
| 2 | inline-unwrap-duplication | 218 hand-rolled `ActionResult` unwraps beside the existing `unwrap()` | hooks | duplication | -700 | low | M | confirmed |
| 3 | fn-withaction-migration | 19 `fn/` files hand-roll what `withAction()` already does | fn | over-abstraction | -1,400 | low | M | confirmed |
| 4 | dead-carbon-breakdown-card | Local carbon-estimate pipeline reachable only from its own tests | certification | dead-code | -1,800 | low | M | confirmed |
| 5 | public-schema-explorer | `/schema` DB explorer, unauthenticated, no consumers | cross-cutting | dead-code | -3,200 | low | S | confirmed |
| 6 | hub-readiness-three-walks | Three hub walks; the batched one is dead, the live one is 3N registry calls | certification | performance | -70 | medium | M | confirmed |
| 7 | entity-list-scaffold | 15 list components repeat the same ~180-line scaffold | components | duplication | -1,400 | medium | L | confirmed |
| 8 | da-list-getbyid-projection | Every entity data-access file writes its projection twice | data-access | duplication | -700 | low | M | confirmed |
| 9 | dead-telemetry-stack | Telemetry / parquet feature has no UI entry point | certification | dead-code | -1,660 | medium | M | downgraded |
| 10 | removal-template-diagnostic-cluster | 2,356 lines serving one platform-admin read-only pane | certification | over-abstraction | -1,400 | medium | L | confirmed |
| 11 | party-customer-supplier-fork | `customers/` and `suppliers/` are a copy-paste fork | components | duplication | -800 | medium | L | downgraded |
| 12 | entities-adapter-factory | 12 of 16 entity-select adapters are one file with a different table | data-access | duplication | -620 | medium | M | downgraded |
| 13 | schemas-dead-scaffolding | Never-imported schema scaffolding | schemas | dead-code | -450 | low | S | confirmed |
| 14 | readiness-preflight-checklist-dead-clone | 190-line dead clone of the live checklist builder | certification | dead-code | -270 | low | M | confirmed |
| 15 | cert-barrel-and-dead-components | 21 of 30 cert barrel exports unused; 3 dead components | certification | dead-code | -470 | low | S | confirmed |
| 16 | da-dead-exports | 13 uncalled data-access and fn exports | data-access | dead-code | -250 | low | S | confirmed |
| 17 | da-dead-options-vertical | Dead dropdown-options vertical superseded by the entities dispatcher | data-access | dead-code | -250 | low | S | confirmed |
| 18 | da-assert-same-org-migration | ~31 hand-rolled row-exists checks beside `assertSameOrg` | data-access | duplication | -250 | medium | M | downgraded |
| 19 | grep-as-test-files | 12 test files assert file source text | tests | tests | -300 | low | M | confirmed |
| 20 | dead-files-and-primitives | `view-related-link`, `ui-store`, `zustand`, `bcryptjs`, duplicate `cn` | client + deps | dead-code | -780 | low | S | confirmed |
| 21 | entity-select-storage-location-cost | Bin picker runs 11 org-wide joins per keystroke | data-access | performance | +20 | medium | M | confirmed |
| 22 | da-delivered-mass-query | The delivered-mass rule is written 10 times across 7 files | data-access | duplication | -120 | medium | M | confirmed |
| 23 | cert-query-state-boilerplate | 15 cert components hand-roll the same loading/error branch | certification | duplication | -140 | low | M | confirmed |
| 24 | three-checkrow-implementations | Three checklist rows, six local status colour tables | certification | duplication | -180 | medium | M | confirmed |
| 25 | credit-batch-cluster-oversplit | Micro-files split to stay under the 1000-line cap | data-access | over-splitting | -60 | low | S | confirmed |
| 26 | da-pagination-scaffold | 12 list queries repeat the page/count/offset scaffold | data-access | duplication | -180 | low | S | confirmed |
| 27 | dead-e2e-fixture-helpers | Dead E2E fixture helpers and a dead namespace re-export block | tests | dead-code | -320 | low | S | confirmed |
| 28 | ci-setup-block-duplication | The checkout/pnpm/node/install block is pasted 16 times | CI | duplication | -240 | low | M | downgraded |
| 29 | submit-removal-recompiles | One submit runs the full build 4 times | certification | performance | -40 | medium | M | confirmed |
| 30 | db-dead-enums | Three `pgEnum`s with no table behind them | db | dead-code | -25 | low | S | confirmed |
| 31 | unmemoizable-memo-calls | 7 `useMemo`/`useCallback` calls that can never hit | components | react-antipattern | -20 | low | S | confirmed |
| 32 | quick-add-dialog-registry | 6 quick-add dialogs are config written as components | components | over-abstraction | -270 | medium | M | downgraded |
| 33 | schemas-update-restates-form | 21 `update*Schema` restate their form schema | schemas | duplication | -200 | med-high | M | downgraded |
| 34 | fn-cert-passthrough-modules | Five thin forwarding modules in `fn/certification` | certification | over-abstraction | -90 | low | S | downgraded |
| 35 | db-unwired-sample-contaminants | 12 contaminant columns nothing reads or writes | db | dead-code | -15 | medium | S | downgraded |
| 36 | docs-archive-weight | 108,000 lines of markdown, 96 percent untracked or historical | docs | other | -67,000 | low | S | confirmed |
| 37 | legacy-production-batch-window-compat | Day-boundary production-batch reconciliation | certification | defensiveness | 0 | high | M | downgraded |

---

### 1. dead-hook-exports

**Files:** `src/hooks/use-*.ts` (18 files), notably `src/hooks/use-customers.ts`, `use-storage-locations.ts`, `use-facilities.ts`, `use-reactors.ts`, `use-suppliers.ts`, `use-samples.ts`, `use-entities.ts`, `use-production-run-reading-imports.ts`.

**Evidence.** Enumerating every `export function|const` in `src/hooks/use-*.ts` and grepping each symbol across `src`, `tests` and `scripts` returns exactly 74 whose only occurrence is their own definition line. They fall into template families: `usePrefetch<Entity>` and `usePrefetch<Entity>s` (11), `use<Entity>CacheInvalidation` (11, each a 30 to 40 line object of closures), `use<Entity>CodeCheck` (9), plus per-entity detail and by-facility hooks the lists never call. `src/hooks/use-production-run-reading-imports.ts` is dead in full and its own header says "Orphaned: no mounted operator entry point."

**Verification result: confirmed, and larger than reported.** The 74 count reproduced exactly. On top of it, the only symbols anyone imports from `src/hooks/use-entities.ts` are `useEntityById` and `useEntityOptions` (six importers, all in `src/components/forms/entity-select/`, `src/components/ui/entity-detail-value.tsx` and four forms). All 11 convenience wrappers in that file (`useFacilities`, `useReactorOptions`, `useSuppliers`, `useCustomers`, `useDrivers`, `useOperators`, `useStorageLocations`, `useVehicles`, `useFeedstockTypes`, `useFeedstocks`, `useProductionRunOptions`) are therefore dead; six of them appear in the 74 and five do not, because same-named hooks live in `use-facilities.ts`, `use-customers.ts`, `use-suppliers.ts`, `use-storage-locations.ts` and `use-feedstocks.ts` and mask them in a naive grep.

**Proposal.** Delete family by family so the diff stays reviewable: all `usePrefetch*` and `use*CacheInvalidation` first, then the 11 `use-entities` wrappers, then the unused detail / by-facility / code-check hooks. Separately, drop the `export` keyword (not the code) from the ~19 `*Keys` query-key factories, which are used inside their own files. Ask the owner about `use-production-run-reading-imports.ts` before deleting it with its `fn/` and `data-access/` halves, since `docs/open-questions.md` tracks it.

**Rollout note.** Do this before `entity-list-scaffold` (finding 7): a smaller hook surface makes it obvious which hooks the controller actually needs.

### 2. inline-unwrap-duplication

**Files:** `src/hooks/types.ts` (the helper), and 32 `src/hooks/use-*.ts` files. This merges the client analyst's finding with the certification analyst's `cert-hooks-hand-rolled-unwrap`; the 36 sites in `src/hooks/use-certification.ts` are a subset of the 218, not additive.

**Evidence.** `src/hooks/types.ts:7` exports `unwrap<T>(result: ActionResult<T>): T`, which throws `new Error(result.error)`, exactly what the inline form does. `src/hooks/use-organizations.ts`, `use-organization-settings.ts` and `use-certifier-credentials.ts` already write `queryFn: async () => unwrap(await listMembersFn())`. Everywhere else the five-line form persists.

**Verification result: confirmed.** The count is 218 (217 real sites plus one hit on the helper definition itself). Top files: `use-certification.ts` 36, `use-suppliers.ts` 15, `use-customers.ts` 15, `use-facilities.ts` 14, `use-storage-locations.ts` 12. Sampled `src/hooks/use-reactors.ts:56-63`, which is the canonical five-line block collapsing to one line.

**Proposal.** Mechanically rewrite each site to `unwrap(await xFn(args))`, importing `unwrap` from `@/hooks/types`. Nineteen hook files already import from `./types` for `MutationCallbacks`, so most need no new import. Zero behaviour change: the thrown error is constructed identically.

**Rollout note.** Run this after finding 1, so you do not rewrite 200 lines you are about to delete.

### 3. fn-withaction-migration

**Files:** `src/fn/with-action.ts`, plus 19 hand-rolled files including `src/fn/suppliers.ts`, `customers.ts`, `facilities.ts`, `production-runs.ts`, `deliveries.ts`, `samples.ts`, `reactors.ts`, `storage-locations.ts`, `feedstocks.ts`, `formulations.ts`, `biochar-products.ts`, `credit-batches.ts`, `applications.ts`, `production-samples.ts`, `production-incidents.ts`, `bin-movements.ts`, and `src/fn/action-errors.ts`.

**Evidence.** `grep -c '} catch (error) {' src/fn/*.ts` returns 129 across 23 files; `grep -c 'withAction(' src/fn/*.ts` returns 57 calls across 16 files. Of the 75 catch blocks with a branch, 74 branch only on `error instanceof z.ZodError`, which `withAction` already handles. Thirteen files each declare an identical private mapper differing only by an entity string.

**Verification result: confirmed, with one gap that must be closed first.** I read `src/fn/with-action.ts` in full and `src/fn/reactors.ts:38-185` side by side. `withAction` does everything claimed, including the `ActionConflictError` arm and a `rateLimit` option. The gap: the per-entity mappers call `toLoggedActionError(error, fallbackMessage, { message: "reactor action failed", context: { op } })`, while `withAction` logs a flat `{ message: "server action failed" }` with no op. Migrating as-is silently drops per-operation log context on every CRUD action. Add `logContext?: Record<string, unknown>` to `WithActionOptions` and thread it into the `logActionError` call before touching any call site.

**Proposal.** Extend `withAction` with `logContext` and an optional `mapError` hook for the seven genuine custom-class branches (`SafeError` x2, `ProductionRunOverlapError` x2, `StockTakeIncreaseError`, `StockOverdrawError`, `StorageError`, `ProductionRunDependencyError`). Then convert each action body to `return withAction(async (ctx) => { ... }, { zodErrorPrefix, fallbackMessage, logContext })` and delete the 13 mappers. `src/fn/stock-availability.ts` and `src/fn/entities.ts` are the shape to copy.

**Rollout note.** One entity per commit. This is the best candidate in the whole report for a bulk implementation agent, but only after the `logContext` option lands as a separate reviewed change.

### 4. dead-carbon-breakdown-card

**Files:** `src/components/certification/carbon-breakdown.tsx` (669 lines), `carbon-breakdown.test.tsx`, `src/lib/certification/removal-breakdown.ts` (270), `src/lib/certification/ghg-statement-breakdown.ts` (196), plus `removal-breakdown.test.ts`, `ghg-statement-breakdown.test.ts` and `tests/removal-breakdown.test.ts`.

**Evidence and verification result: confirmed.** `CarbonBreakdownCard` (`carbon-breakdown.tsx:661`) is referenced only by its own test file. The two live surfaces, `src/components/certification/removal-carbon-breakdown.tsx:11` and `ghg-statement-carbon-breakdown.tsx:9`, import only `CarbonBreakdownSkeleton` from that file and render `RegistryCarbonResultCard` instead; `removal-carbon-breakdown.tsx`'s own docstring says "No local carbon calculation or reconciliation enters this workflow." `computeGhgStatementBreakdown` (`ghg-statement-breakdown.ts:165`) is referenced only by its own test. I checked what the fn layer actually consumes: `src/fn/certification/ghg-statement-breakdown.ts:11-12` imports exactly one symbol, `hasExactGhgEntryMembership`. `computeRemovalBreakdown` reaches app code only through the dead card and through the dead `computeGhgStatementBreakdown`.

**Proposal.** Keep `Shell` and `CarbonBreakdownSkeleton` (about 35 lines) and rename the file `carbon-breakdown-skeleton.tsx`. Delete the rest of `carbon-breakdown.tsx` and its test, `src/lib/certification/removal-breakdown.ts`, `computeGhgStatementBreakdown` and its input types from `ghg-statement-breakdown.ts` (keep `hasExactGhgEntryMembership`), and the three compute-only test files.

**Rollout note.** This is the cleanest large deletion in the report. Nothing in the app reaches it, so it can go in phase 1.

### 5. public-schema-explorer

**Files:** `src/app/schema/page.tsx`, `src/app/schema/[table]/page.tsx`, `src/app/schema/links/page.tsx`, `src/components/schema/schema-table-view.tsx` (620), `src/components/schema/schema-explorer.tsx` (239), `src/lib/schema/catalog.ts` (417), `src/lib/schema/column-descriptions.json` (731), `src/lib/schema/column-examples.json` (769), `src/lib/auth/middleware.ts`.

**Evidence and verification result: confirmed.** `src/lib/auth/middleware.ts:11` lists `"/schema"` as the first entry in `PUBLIC_ROUTES`, so the route renders with no session. Measured 3,235 LOC across the three directories plus 1,500 lines of JSON. Grepping `components/schema` and `lib/schema` from anywhere outside those three directories returns nothing, and nothing under `src/components/navigation` or `src/config` links to the route. `src/components/schema/schema-explorer.tsx` is the dead half inside the already-orphaned feature: `/schema` renders `SchemaTableView`. This merges the client analyst's separate `schema-explorer.tsx` item.

**Proposal.** Delete `src/app/schema/**`, `src/components/schema/**`, `src/lib/schema/**` and remove `"/schema"` from `PUBLIC_ROUTES`. `docs/schema-overview.md` and `pnpm db:studio` already cover the need. If the browser is wanted internally, the minimum change is to move it under `(app)` and gate it on the platform-admin check used at `src/components/certification/certification-settings.tsx:254`, which also stops anonymous disclosure of the full schema.

**Rollout note.** This one is a product decision on a security-adjacent surface, so put it to the owner rather than bundling it into a mechanical sweep. The unauthenticated exposure is the argument, not the line count.

### 6. hub-readiness-three-walks

**Files:** `src/fn/certification/overview.ts`, `src/fn/certification/certify-context-core.ts`, `src/hooks/use-certification.ts`, `src/components/certification/removals-list.tsx`.

**Evidence and verification result: confirmed, and more valuable than its LOC delta suggests.** Three code paths produce the same hub payload. `loadCertificationOverview` (`overview.ts:210`) resolves `loadFacilityCertifierFacts` once and builds every removal's summary in bounded chunks; it reaches only `useCertificationOverview` (`use-certification.ts:227`), which has no component consumer, so the efficient path is dead. `removals-list.tsx:234` calls `useRemovalsForFacility` and `:242` calls `useRemovalPreflightSummaries`, which issues one `useQueries` entry per removal against `loadRemovalPreflight` (`overview.ts:173`). Each of those calls `loadFacilityCertifierFacts`. I read `certify-context-core.ts:440-495` looking for a cache and there is none: no `unstable_cache`, no memo, no request-scoped map. The function issues `listProjects`, `listGhgEntryTemplates` and `listComponentBlueprints` every time. A 10-removal hub therefore fires 10 server actions and 30 uncached registry HTTP calls where the dead loader would use 1 and 3.

**Proposal.** Extend `loadCertificationOverview`'s return with the `removals[].memberBatches` identities and `ungroupedBatches` rows that `removals-list.tsx` currently gets from `loadRemovalsForFacility`, point the component at `useCertificationOverview`, then delete `loadRemovalPreflight`, `useRemovalPreflightSummaries` and `certificationKeys.removalPreflight`.

**Rollout note.** Needs a human. It changes what the hub renders and `src/hooks/use-certification-invalidation.test.ts:76` asserts on `useRemovalPreflightSummaries`, so the invalidation contract moves with it. Do this before the separate `removals-for-facility-n-plus-1` item, which it subsumes.

### 7. entity-list-scaffold

**Files:** the 15 `src/components/*/[a-z]*-list.tsx` files, 8,444 LOC in total. Largest: `samples/sample-list.tsx` (823), `applications/application-list.tsx` (810), `production-runs/production-run-list.tsx` (753), `credit-batches/credit-batch-list.tsx` (755), `deliveries/delivery-list.tsx` (721), `feedstocks/feedstock-list.tsx` (718).

**Evidence and verification result: confirmed.** Diffing `src/components/reactors/reactor-list.tsx` against `src/components/customers/customer-list.tsx` with the entity noun normalized gives 265 differing lines out of 795 combined, so roughly 530 lines are the same program twice. Outside `createColumns()` and two `StatCard`s the files share: the `sideSheet` state object, three separate error `useState`s, `searchInput` plus `useDebounce`, `useListPagination`, `openCreate/openView/openEdit/closeSideSheet`, `useOpenCreateIntent`, four try/catch handlers, `useReconcileListPage`, the fetch-error early return, and the whole `PageHeader` / `StatCard` grid / `DataTable` with 14 identical props / `DeleteConfirmDialog` / `EntitySideSheet` block.

**Proposal.** Extract two pieces whose dependencies all exist: `useEntityListController({ useList, useCreate, useUpdate, useDelete, labels, facilityScoped })` in `src/hooks/`, and `<EntityListPage>` in `src/components/ui/` taking header, stat cards, columns, controller, empty icon, delete message, side-sheet sections and a form renderer. Each list file then keeps only `createColumns`, its stat cards, its side-sheet sections and its form.

**Rollout note.** Needs a human for the first two migrations, then a bulk agent for the rest. Migrate reactors, formulations, customers and suppliers first to prove the shape; leave applications, production-runs and credit-batches until last because they also carry deep-link and filter logic. Do finding 31 (`unmemoizable-memo-calls`) inside this work rather than separately, and settle the deep-link effect divergence (unverified, see below) before the controller absorbs six different guards.

### 8. da-list-getbyid-projection

**Files:** 16 data-access files including `src/data-access/biochar-products.ts`, `reactors.ts`, `samples.ts`, `storage-locations.ts`, `customers.ts`, `facilities.ts`, `orders.ts`, `credit-batches.ts`, `transport-legs.ts`, `applications.ts`, `production-runs/queries.ts`, and five under `src/data-access/entities/`.

**Evidence and verification result: confirmed.** `diff <(sed -n '115,140p' src/data-access/reactors.ts) <(sed -n '179,204p' src/data-access/reactors.ts)` differs on exactly two hunks: the first line (`const reactorList = await db` vs `const [reactor] = await db`) and the trailing where/orderBy. The 13-field projection between them is byte-identical. `src/data-access/entities/storage-locations.ts:684` against `:849` is the same pattern at 131 lines; `biochar-products.ts:226` against `:394` at 81 lines with a seven-join chain that repeats `eq(<rel>.organizationId, ctx.organizationId)` in every join.

**Proposal.** Per entity, hoist one `const <entity>Selection = { ... }`, one `with<Entity>Relations(qb, ctx)` applying the join chain, and one `to<Entity>WithRelations(row)`. List and getById then differ only in where/order/limit. Drizzle infers the row type from the shared selection object, so this is type-safe and mechanical.

**Rollout note.** Do this before finding 25 (`credit-batch-cluster-oversplit`): removing 150 to 250 lines per parent is what makes the satellite files foldable without breaching the cap.

### 9. dead-telemetry-stack (downgraded to an owner decision)

**Files:** `src/components/certification/telemetry-panel.tsx` (164), `src/hooks/use-telemetry-submission.ts`, `src/fn/certification/submit-telemetry.ts` (772), `src/lib/isometric/parquet/writer.ts` (132), `tests/isometric-submit-telemetry-retry.test.ts` (527), plus the `hyparquet-writer` dependency and two `TODO(telemetry-migration)` exports in `src/data-access/certification-submissions.ts:806,826`.

**Evidence and verification result: deadness confirmed, framing downgraded.** `TelemetryPanel` has no importer in `src`, `tests` or `scripts`. `use-telemetry-submission` has exactly one importer, the dead panel. `src/lib/isometric/parquet/writer.ts` is imported by `submit-telemetry.ts:59` and two test files, and is the only consumer of `hyparquet-writer`. So nothing in the running app reaches any of it. But it is not forgotten code: `docs/adr/0006-data-upload-submission-idempotency.md:7` records that "The UI remains dark: `TelemetryPanel` exists but is [not mounted]", and `docs/open-questions-isometric.md:579-585` tracks it as an open item with an explicit "Resolve via: re-home and barrel-export `TelemetryPanel`". Deleting it would resolve a tracked open question by fiat.

**Proposal.** Put the wire-or-delete choice to the owner. If telemetry submission is still on the roadmap the cheaper move is to mount the panel in the removal detail sheet; if not, delete the five files, the dependency, and make the two `TODO(telemetry-migration)` data-access exports module-private. Either way, do not decide on the basis that the protocol does not need it: that is a registry question, and this repo has a four-incident history of hallucinated Isometric requirements.

### 10. removal-template-diagnostic-cluster

**Files:** `src/components/certification/removal-template-diagnostic-panel.tsx` (310), `removal-template-mapping-view.tsx` (342), `removal-template-trace-view.tsx` (241), `removal-template-diagnostic-status.tsx` (130), `removal-template-views.test.tsx` (201), `src/lib/certification/removal-template-diagnostic.ts` (712), `removal-template-diagnostic-resolution.ts` (124), `removal-template-diagnostic.test.ts` (296). Measured total: 2,356.

**Evidence and verification result: confirmed as described.** Single mount at `src/components/certification/certification-settings.tsx:276`, inside `if (isAdmin)`, with `access: "Platform Admins"` and `readOnly: true` (lines 270-278). The only other reference is a stub in `certification-settings.test.tsx:93`. It renders two alternative visualisations of one `RemovalTemplateDiagnosticModel` plus a third status and tone module.

**Proposal.** A product call, not a cleanup. Preferred: keep `removal-template-trace-view` (the view that answers "why did this Removal compile that way") and delete `removal-template-mapping-view` plus the tone and colour layer, folding the eight statuses into text labels. Alternative: replace the whole pane with a `pnpm tsx scripts/isometric-smoke.ts inspect-template <prj>` report, which already exists and which the `isometric-gap-check` skill already consumes. Do not delete it silently: it is real debugging capability for an integration with a documented hallucination history.

### 11. party-customer-supplier-fork (downgraded)

**Files:** `src/components/customers/` (customer-form 473, customer-detail 282, customer-location-fields 265, customer-location-dialog 118, customer-location-form) and `src/components/suppliers/` (supplier-form 564, supplier-detail 300, supplier-location-form 293, supplier-location-dialog 101, supplier-detail-fields.ts, supplier-locations-read-state.tsx), plus the shared `src/components/party-location-detail-fields.ts`.

**Evidence and verification result: fork confirmed, numbers and rollout order corrected.** Noun-normalized diffs: detail pair 96 differing lines of 582 (17 percent divergent), form pair 235 of 1037 (23 percent), dialog pair 39 of 219 (18 percent), and location-fields vs location-form 248 of 558 (44 percent). The analyst's advice to start with the location trio "where the diff is smallest" is wrong: that pair is the most divergent of the four. Non-test LOC across both directories is 3,476 (measured), and `suppliers/` carries `supplier-detail-fields.ts` and `supplier-locations-read-state.tsx` with no customer twin, so unification is not a pure merge. The two `*-location-form-parity.test.ts` files (24 and 42 lines) are hand-written source-grep sync checks, which is corroborating evidence that the fork is maintained by hand.

**Proposal.** Create a new src/components/parties/ folder with one config record per party kind and one implementation each of `PartyForm`, `PartyDetail`, `PartyLocationFields`, `PartyLocationDialog`, following the pattern `buildPartyLocationDetailFields` already established. Keep the existing files as thin adapters so routes and barrels do not move. Estimate lowered from -1,200 to roughly -700 to -900.

**Rollout note.** Start with the detail pair (17 percent divergent), then the dialogs, then the forms, and treat the location fields last since they have genuinely diverged. Delete the two parity tests as part of the merge, not before it.

### 12. entities-adapter-factory (downgraded)

**Files:** the 12 simple adapters under `src/data-access/entities/` (suppliers 69, customers 69, drivers 68, operators 63, vehicles 70, facilities 72, reactors 79, feedstock-types 81, feedstocks 91, formulations 69, credit-batches 83, applications 125) plus `entities/index.ts` (222).

**Evidence and verification result: confirmed, estimate corrected.** `diff src/data-access/entities/suppliers.ts src/data-access/entities/customers.ts` is exactly the table identifier, one `ilike` column, and the subtitle field. Measured the 12 files at 939 LOC, not the 814 reported. The special cases are real and must be counted: `reactors.ts` adds `isNull(archivedAt)` and a `facilityId` filter; `applications.ts` needs an `innerJoin(deliveries)` because applications carry no `archived_at`, and exports a shared `toApplicationOption` mapper. A factory plus 12 configs lands near 250 to 300 LOC, so the honest delta is about -620.

**Proposal.** Add a new src/data-access/entities/adapter.ts module exporting `defineEntityAdapter({ table, columns, searchColumns, baseConditions?, filters?, join?, toOption })` returning `{ list, byId }` with `requireOrgScope` and the `organizationId` predicate baked in, which puts the org-scoping seam in one place instead of 24. Turn `entities/index.ts`'s switch into a `Record<EntityType, Adapter>`. Keep `storage-locations`, `biochar-products`, `orders` and `production-runs` hand-written.

**Rollout note.** Only 6 of the 16 adapters have colocated tests. Write a table-driven test against the factory before deleting any file, because the org predicate moves.

### 13. schemas-dead-scaffolding

**Files:** `src/schemas/vehicles.ts`, `drivers.ts`, `operators.ts`, `facilities.ts`, `reactors.ts`, `suppliers.ts`, `customers.ts`, `orders.ts`, `deliveries.ts`, `formulations.ts`, `production-runs.ts`, `biochar-products.ts`, `helpers.ts`, `isometric.ts`.

**Evidence and verification result: confirmed, one correction.** Checked each name individually against `src`, `tests` and `scripts`. The nine `*SelectSchema`, all vehicle/driver/operator create/update/delete action schemas, `hasCompleteGpsPair`, `GPS_PAIR_MESSAGE`, `optionalMassKgInputSchema`, `optionalStoredPercentValue` and `documentMetadataSchema` each occur in exactly one file, their own. Correction: `addressSchema` is also referenced by `tests/facilities-schema.test.ts`, so that deletion takes a test block with it. The ~20 `Delete<Entity>Data` type aliases are dead while the underlying `deleteXSchema` values are live via `z.infer<typeof deleteXSchema>` in `fn/`, exactly as the analyst warned.

**Proposal.** Delete the select schemas, the unused action schemas, `addressSchema` (with its test), and the helper constants. Delete the dead type aliases and keep the schema values. For the 14 `export const createXSchema = xFormSchema` pure aliases, pick one name per schema.

### 14. readiness-preflight-checklist-dead-clone

**Files:** `src/lib/certification/readiness.ts`, `readiness.test.ts`.

**Evidence and verification result: confirmed.** `buildRemovalPreflightChecklist` appears only at `readiness.ts:507` and in its own test file. Grepping `PreflightCheck` outside `lib/certification/readiness` returns nothing at all, so the exported interface has no consumer either. It is a near-verbatim clone of the live `buildRemovalRequirementsChecklist` (`readiness.ts:709-863`), with `withPreflightMeta` byte-identical to `withRequirementMeta` modulo the type name.

**Proposal.** Delete `buildRemovalPreflightChecklist`, `durabilityPreflightCheck`, `PreflightCheck`, `PreflightCheckBase` and `withPreflightMeta`. Keep `PreflightCheckStatus` and `RemovalFixTarget`, both referenced by `RemovalRequirementCheck`. Retarget the `describe("buildRemovalPreflightChecklist")` block and the five scattered calls at `readiness.test.ts:312/344/361/746/784` onto `buildRemovalRequirementsChecklist`, which produces the same rows plus one.

**Rollout note.** The test retarget is the whole job. Do it in the same commit as the deletion so the checklist stays covered.

### 15. cert-barrel-and-dead-components

**Files:** `src/components/certification/index.ts`, `blueprint-list.tsx` (44), `certify-panel.tsx` (236), `telemetry-panel.tsx` (164).

**Evidence and verification result: confirmed.** Exactly five files import `@/components/certification`: `src/app/(app)/certification/layout.tsx`, `src/app/(app)/certification/settings/page.tsx`, `src/components/facilities/facility-form.tsx`, `facility-list.tsx`, and `src/components/onboarding/wizard-registry-step.tsx`. Every other component in the folder is imported by relative path from inside it, so the remaining 21 barrel lines are re-export noise. `BlueprintList` and `CertifyPanel` appear only in their own file plus the barrel line; `CertifyPanel`'s only other mention is a stale docstring at `sources-panel.tsx:11`.

**Proposal.** Delete `blueprint-list.tsx` and `certify-panel.tsx` (leave `telemetry-panel.tsx` to finding 9), cut `index.ts` to the symbols the five external importers use, and fix the stale `sources-panel.tsx:11` comment.

**Warning.** knip flags all 21 barrel exports, but only three of the underlying components are dead. Deleting components on knip's word would break the app.

### 16. da-dead-exports

**Files:** `src/data-access/certifier-removals.ts`, `transport-legs.ts`, `credit-batch-accounting.ts`, `credit-batches.ts`, `applications.ts`, `storage-locations.ts`, `certification.ts`, `certifier-document-uploads.ts`, `certifier-sensors.ts`, `feedstock-types.ts`, `suppliers.ts`, `production-runs/queries.ts`, `code-generator.ts`, `src/fn/production-runs.ts`.

**Evidence and verification result: confirmed, all 13 checked by name.** Every one resolves to its own file, and in three cases to prose only: `removalHasBlockingSubmission` appears in `src/lib/certification/status.ts:57` and `readiness.ts:868` as comment text; `syncBiocharProductTransportLeg` only in a comment at `src/lib/certification/certify-field-registry.ts:394`; `assignCreditBatchToRemoval` only in the `readiness.ts:868` comment and nowhere as code. `getFacilityCertifier` is re-exported by `credit-batches.ts:85` and imported by nobody, while `credit-batches.ts` itself calls `getFacilityCertifierWithExecutor`.

**Proposal.** Delete the 13 exports. Collapse `generateNextCode` into its single internal call site at `code-generator.ts:219`. Fix the stale comments to name `assertCreditBatchNotCertificationLocked`, which is the live gate at `credit-batch-certification-lock.ts:65-118`. Do not weaken that lock.

### 17. da-dead-options-vertical

**Files:** `src/data-access/suppliers.ts`, `formulations.ts`, `feedstocks.ts`, `samples.ts`, `biochar-product-lookups.ts`; `src/fn/suppliers.ts`, `formulations.ts`, `feedstocks.ts`, `biochar-products.ts`; and the hooks in `src/hooks/use-suppliers.ts`, `use-formulations.ts`, `use-feedstocks.ts`, `use-biochar-products.ts`, `use-entities.ts`.

**Evidence and verification result: confirmed.** `getSupplierOptions`, `getFormulationOptions` and `getFeedstockOptions` exist only in their data-access file plus an `fn/` wrapper; `getSampleOptions` exists only in `src/data-access/samples.ts`. The hooks that consumed them (`useSupplierOptions`, `useFormulationOptions`, `useFeedstockOptions`, `useBiocharProductOptions`, `useReactorOptions`, `useProductionRunOptions`) all appear in the independently verified 74-dead-hook list, so the vertical is dead end to end. `getBiocharProductOptions`'s only extra hit is a `vi.fn()` mock stub at `tests/biochar-product-update.test.ts:20`, which goes with it. Every searchable dropdown in the app goes through `useEntityOptions` and `src/data-access/entities/`.

**Rollout note.** Delete this together with finding 1 (the hooks) so no half-deleted vertical exists between commits.

### 18. da-assert-same-org-migration (downgraded)

**Files:** `src/data-access/utils.ts` and about 31 sites across `storage-locations.ts` (8), `reactors.ts` (4), `customers.ts` (4), `facilities.ts` (3), `biochar-products.ts`, `suppliers.ts`, `credit-batches.ts`, `orders.ts`, `feedstocks.ts`, `applications.ts`, `documents.ts`, `production-incidents.ts`, `production-runs/mutations.ts`.

**Evidence and verification result: duplication confirmed, one-line-swap framing refuted.** I read `src/data-access/utils.ts:32-53` and three claimed sites (`customers.ts:291-299`, `reactors.ts:236-244`, `storage-locations.ts:316-324`). The eight-line select-and-throw block is identical across them. But grepping the string `not found in this organization` outside `utils.ts` returns zero hits: the hand-rolled sites throw `SafeError("Customer not found")`, `SafeError("Facility not found")`, `SafeError("Facility not found or archived")`. So swapping in `assertSameOrg` changes user-facing error copy at every site, which `docs/ux-writing.md` governs, and the archived variants (`storage-locations.ts:358`) need a separate `assertActiveSameOrg` or the existing `lockActiveFacilityReference`. LOC delta holds at about -250; risk raised from low to medium.

**Proposal.** Decide the copy first (arguably "not found in this organization" is worse copy anyway, since it discloses tenancy), then migrate the plain cases and leave the archived-parent cases on a dedicated helper.

### 19. grep-as-test-files

**Files:** `src/components/customers/customer-location-form-parity.test.ts`, `src/components/suppliers/supplier-location-form-parity.test.ts`, `src/components/suppliers/supplier-distance-parity.test.tsx`, `src/components/forms/resolved-error-revalidator-coverage.test.ts`, `src/components/location-management-actions.test.ts`, `src/components/organizations/organization-certifier-credentials-lifecycle.test.ts`, `src/components/orders/order-product-bin-selection.test.ts`, `src/components/deliveries/delivery-form.test.ts`, `src/components/certification/removal-detail-sheet.test.ts`, `src/data-access/stock-availability.test.ts`, plus three under `tests/`.

**Evidence and verification result: confirmed.** `grep -rln readFileSync src tests --include='*.test.ts*'` returns 12 files totalling 845 lines. Assertions are string greps over component source: `expect(source).toContain('import { SyncEventLog } from "./sync-event-log"')`, `expect(source).not.toContain("truckMassOnArrivalKg")`, `expect(source).toContain('idPrefix="pending-loc"')`. `removal-detail-sheet.test.ts` pins an exact import statement that other findings here recommend changing, and `resolved-error-revalidator-coverage.test.ts` hardcodes a 13-entry form list so any form added after it was written gets no coverage at all.

**Proposal.** Delete the purely structural ones (`delivery-form.test.ts`, `removal-detail-sheet.test.ts`, both `*-location-form-parity.test.ts`). Convert `resolved-error-revalidator-coverage.test.ts` into a glob-driven check or an ESLint rule so new forms are actually covered. For the three that guard a real invariant (`stock-availability`, `order-product-bin-selection`, `location-management-actions`), replace the source grep with a render-and-assert or a direct call. Leave `tests/ghg-statement-report-model.test.ts` and the two contract tests alone until someone reads them; they read fixtures, not source, in places.

**Rollout note.** Delete the two parity tests only as part of finding 11, not before, since today they are the only sync check on that fork.

### 20. dead-files-and-primitives

**Files:** `src/components/ui/view-related-link/index.tsx` (214), `src/components/forms/entity-select/quick-add-dialog.tsx` (the 148-line generic component; keep `useQuickAddDialog`), `src/components/ui/loading-skeleton/index.tsx` (4 of the skeletons, ~115 lines), `src/stores/ui-store.ts` (15), `src/utils/cn.ts`, `src/components/chain-of-custody/map/viewer-constants.ts` (two constants), `package.json`.

**Evidence and verification result: confirmed.** `view-related-link` has no external reference of any kind and is not even re-exported from `src/components/ui/index.ts`. `zustand` appears exactly once in the tree, at `src/stores/ui-store.ts:5`, and `useUIStore` has no importer, so both the store and the dependency go. `bcryptjs` appears only in `package.json` (Better Auth does the hashing). `src/utils` has no importers at all, so `src/utils/cn.ts` is a byte-duplicate of `src/lib/utils.ts` with zero consumers. This merges the client analyst's dead-files item with the tooling analyst's unused-deps item.

**Proposal.** Delete the files, drop `zustand` and `bcryptjs` from `package.json`, and delete the `src/stores/` and `src/utils/` directories. Move `useQuickAddDialog` out of `quick-add-dialog.tsx` before deleting the generic component around it.

### 21. entity-select-storage-location-cost

**Files:** `src/data-access/entities/storage-locations.ts` (993), `src/data-access/lane-stock-derivation.ts`.

**Evidence and verification result: confirmed.** I read `buildInventoryAggregates` at lines 169-215 and the query assembly at 750-820. Each of the nine grouped subqueries filters only on `eq(<table>.organizationId, ctx.organizationId)` and groups by `storageLocationId`, so every one aggregates the entire organization's feedstocks, production runs, biochar products and deliveries. `getStorageLocations` then applies 11 `leftJoin`s, puts the search predicate at the outer level, calls `.limit(limit)` last, and afterwards makes a separate `deriveLaneStock` roundtrip. `getStorageLocationById` runs the identical nine-subquery plan to resolve one row. This is the hot path for every keystroke in the bin picker via `fn/entities.ts`.

**Proposal.** Two-phase the read: select candidate ids with the cheap predicates and the limit, then compute the aggregates with `inArray(<fk>, candidateIds)` pushed into each subquery's where, folding `deriveLaneStock` into the same phase. `getStorageLocationById` passes a one-element array. Expect a small positive LOC delta.

**Rollout note.** Combine with finding 8's projection extraction on the same file, which is what gets it under the 1000-line cap in one pass. EXPLAIN the generated SQL against a seeded local database before and after; the file has a colocated test (`entities/storage-locations.test.ts`, 208 lines).

### 22. da-delivered-mass-query

**Files:** `src/data-access/bin-stock-guards.ts`, `storage-location-lane-summary.ts`, `storage-location-enrichment.ts`, `entities/storage-locations.ts`, `delivery-dry-biochar.ts`, `delivery-stats.ts`, `deliveries.ts`, `credit-batch-accounting.ts`.

**Evidence and verification result: confirmed and wider than reported.** Grepping the product-resolution rule `COALESCE(deliveries.biocharProductId, orders.biocharProductId)` returns 10 occurrences across 7 files, not the 4 in 4 that the analyst counted: `bin-stock-guards.ts:118,287,321`, `delivery-dry-biochar.ts:86`, `delivery-stats.ts:47`, `deliveries.ts:263`, `storage-location-lane-summary.ts:85`, `credit-batch-accounting.ts:278`, `storage-location-enrichment.ts:320,366`. That is ten independent copies of the rule deciding which product a delivery drew from, one of which is the overdraw guard.

**Proposal.** Move the join into one exported builder, for example `deliveredWetMassFromProductBins(ctx, executor, { binIds })` in a new a new src/data-access/product-bin-delivered-mass.ts module, returning a grouped result the call sites reuse. Cover with `tests/bin-stock-guards-concurrency.test.ts` and `tests/bin-reconciliation-integrity.test.ts` before and after.

**Rollout note.** Needs a human. The copies are not all doing the same thing (single-id vs `inArray` vs subquery-with-groupBy, `tx` vs `db`), and the overdraw guard is correctness-critical.

### 23. cert-query-state-boilerplate

**Files:** 15 components under `src/components/certification/`, including `facility-certifier-section.tsx`, `facility-certifier-summary.tsx`, `certification-health-panel.tsx`, `sources-panel.tsx`, `ghg-statement-workflow.tsx`, `new-removal-dialog/index.tsx`.

**Evidence and verification result: confirmed (15 files, not 16).** Each pairs `if (isLoading) return <p className="body-small text-[var(--color-text-tertiary)]">Loading …</p>` with a `color-signal-red` error paragraph; 9 files carry the error half. The two branches are byte-identical inside `facility-certifier-section.tsx` between the read-only branch (about lines 228-248) and the manage branch (about 312-332), which is the self-clone jscpd reports.

**Proposal.** Add one `<QueryState query={q} loading="Loading certifier mapping…">{(data) => …}</QueryState>` render-prop in `src/components/ui/`, carrying the canonical copies from `docs/ux-writing.md`, and replace all 15 sites.

### 24. three-checkrow-implementations

**Files:** `src/components/certification/check-row.tsx`, `src/components/certification/new-removal-dialog/submission-checks.tsx`, `src/components/credit-batches/credit-batch-health-strip.tsx`, `src/lib/status-state.ts`.

**Evidence and verification result: confirmed, including the stale docstring.** Three implementations exist: the exported `CheckRow` (`check-row.tsx:67`, whose only consumer is `ghg-statement-workflow.tsx`), a private `CheckRow` at `submission-checks.tsx:121`, and `OpenCheckRow` at `credit-batch-health-strip.tsx:133`. `check-row.tsx`'s own header claims it is shared by the wizard submit step and the health strip, which is false today. Separately, grepping for `status-state` importers returns 13 files across credit-batches, chain-of-custody, dashboard and the styleguide, and not one of them is under `src/components/certification`, confirming that the canonical seam is bypassed there.

**Proposal.** Keep one `CheckRow` in `src/components/ui/` that resolves colour through `getStatusState` / `getStatusStateColor` from `@/lib/status-state`, and pass the two extra behaviours (multi-line detail bullets, multiple fix links) as props. Fix or delete the stale docstring either way.

### 25. credit-batch-cluster-oversplit

**Files:** `src/data-access/credit-batch-delete-slices.ts`, `credit-batch-lineage-types.ts`, `credit-batch-accounting-types.ts`, `delivery-distance-projections.ts`, `biochar-product-create.ts`, `samples/carbon-reconciliation.ts`, and the parents `credit-batches.ts`, `credit-batch-accounting.ts`, `samples.ts`, `deliveries.ts`, `biochar-products.ts`.

**Evidence and verification result: confirmed, one correction.** Measured parents at 990, 981, 990, 997 and 987 lines, all pinned just under the 1000-line cap, which is direct evidence that the splits are line-count relief. Importer counts verified: `credit-batch-delete-slices.ts` (43 lines, 1 importer), `credit-batch-lineage-types.ts` (83, 1), `delivery-distance-projections.ts` (29, 1), `biochar-product-create.ts` (405, 1), and `src/data-access/samples/` holds one file with one importer. Correction: `credit-batch-production-window.ts` has three importers (`src/schemas/credit-batches.ts`, `credit-batches.ts`, `credit-batch-membership.ts`), so leave that one where it is.

**Proposal.** Do this last, after findings 8 and 26 shrink each parent. Then fold `credit-batch-delete-slices.ts` into `credit-batches.ts`, `credit-batch-lineage-types.ts` into `credit-batch-accounting-types.ts`, `delivery-distance-projections.ts` into `deliveries.ts`, and `samples/carbon-reconciliation.ts` into `samples.ts`. Keep the genuinely shared satellites (`biochar-product-source-mass.ts` with 7 importers, `delivery-order-balance.ts` with 4, `biochar-product-composition.ts` with 4).

### 26. da-pagination-scaffold

**Files:** the 12 data-access files that own a paginated list query: `reactors.ts`, `suppliers.ts`, `customers.ts`, `facilities.ts`, `samples.ts`, `deliveries.ts`, `biochar-products.ts`, `storage-locations.ts`, `orders.ts`, `feedstocks.ts`, `formulations.ts`, `production-runs/queries.ts`.

**Evidence and verification result: confirmed.** `grep -rn 'totalPages = Math.ceil' src/data-access` returns exactly 12 non-test hits, one per file, each surrounded by the same destructure / conditions array / sortColumn map / orderFn / counted query / offset block, and each carrying its own copy of the `// org-scope-ok:` waiver comment.

**Proposal.** Add `resolvePaging(filters)` and `countRows(table, whereClause)` to `src/data-access/utils.ts`, keeping the single `org-scope-ok` waiver inside `countRows` instead of 12 copies. Each list function then keeps only its conditions, its sortColumn map and its projection.

**Rollout note.** Pair with finding 8 in the same per-entity commit; together they are what frees the cap pressure for finding 25.

### 27. dead-e2e-fixture-helpers

**Files:** `tests/e2e/fixtures/test-data-helpers.ts`, `tests/e2e/fixtures/auth-fixtures.ts`, `tests/e2e/fixtures/index.ts`, `tests/fixtures/submit-removal-orchestrator.ts`, `tests/helpers/application-evidence-fixtures.ts`.

**Evidence and verification result: confirmed.** `TestDataBuilder`, `bulkCleanup`, `createDirectSession`, `setAuthCookies`, `createTestApplication` and `deleteTestApplication` each resolve to their defining fixture file plus the `tests/e2e/fixtures/index.ts` barrel line, with no spec consuming them. Meanwhile `createTestFacility` (22 uses), `createTestStorageLocation` (11), `generateTestId` (18) and `selectFirstEntity` (14) are live, so this is surgical, not a directory delete.

**Proposal.** Delete the dead helpers, the 14-entry namespace re-export block at `tests/fixtures/submit-removal-orchestrator.ts:165-180` (the four consuming specs re-import those namespaces directly from `@/...`), the unused gap constants in `tests/helpers/application-evidence-fixtures.ts`, and prune the barrel to what specs import.

### 28. ci-setup-block-duplication (downgraded)

**Files:** `.github/workflows/ci.yml`, `e2e.yml`, `e2e-live.yml`, `migrate.yml`, `migration-gate.yml`, `isometric-health.yml`, `storage-health.yml`.

**Evidence and verification result: real but smaller than claimed.** `grep -c 'pnpm/action-setup'` sums to 16, not 17, across 7 files (migrate.yml 7, ci.yml 3, migration-gate.yml 2, four others 1 each). Total workflow lines are 1,386, so a composite action saves roughly 240 lines, and more importantly reduces 16 independent pins of the pnpm major and the Node major to one.

**Proposal.** Add a new composite action at .github/actions/setup-repo/action.yml (checkout with `persist-credentials: false`, `pnpm/action-setup`, `setup-node` with cache, `pnpm install --frozen-lockfile`) and replace the 16 blocks. Keep per-job overrides (migration-gate needs two different checkouts) as inputs.

### 29. submit-removal-recompiles

**Files:** `src/fn/certification/submit-removal.ts`, `removal-submission-build.ts`, `biochar-application-intents.ts`.

**Evidence and verification result: confirmed.** Four build entries verified at `submit-removal.ts:368`, `:411`, `:439` and `:509`, with the `:368` call's output explicitly discarded by its own comment. `buildRemovalSubmissionBuild`'s first action is `compileBiocharApplicationIntents`, which is read-only, deterministic in `ctx.memberBatchClaims`, and issues the five-table join in `src/data-access/certifier-biochar-applications.ts`. That join therefore runs three or four times per submit with identical inputs.

**Proposal.** Compute the intents once in `submitRemovalCore` (or attach them to `RemovalSubmissionContext`) and pass them in as an optional arg, the way `sourceIds` already is. Then split the build into a pure `validateRemovalInputs(ctx)` run once and a `resolveRemovalSources(...)` re-run after mirroring. Keep all three hash re-assertions: they compare different snapshots at different points and are the freshness guard, not redundancy.

**Rollout note.** Needs a human. This is the submit pipeline for registry submissions; do not hand it to a bulk agent.

### 30. db-dead-enums

**Files:** `src/db/schema/common.ts`.

**Evidence and verification result: confirmed.** `userRole` (line 144), `lossEntityType` (254) and `lossTypeCode` (261) each occur only in their own declaration, including inside `src/db/schema` itself. Grepping `lossRecords` or `loss_records` across `src` returns nothing, so the table they typed is gone from the Drizzle schema (only `drizzle/0013_warm_nekra.sql` still mentions it), and roles come from Better Auth members.

**Proposal.** Delete the three declarations and generate a migration dropping the orphan Postgres types. No production database exists, so there is no data risk, but the migration chain must stay runnable for `pnpm db:reset` and CI.

### 31. unmemoizable-memo-calls

**Files:** `src/components/customers/customer-list.tsx:228`, `suppliers/supplier-list.tsx:225`, `orders/order-list.tsx:162` and `:266`, `storage-locations/storage-location-list.tsx:199`, `facilities/facility-list.tsx:98`, `samples/sample-list.tsx:462`.

**Evidence and verification result: confirmed, 7 sites not 8.** The `columns` memos depend on `openEdit` and `handleDelete`, both plain arrow functions declared in the component body, so both deps are new objects every render and the memo can never return a cached value. The `filters` memos wrap object literals read only by a React Query key factory, which serializes them anyway. `next.config.ts` sets `reactCompiler: true` and `docs/code-style.md` bans manual memoization without profiling. Only 15 files in the whole tree use `useMemo` or `useCallback`, matching the metrics baseline.

**Proposal.** Delete the 7 calls and the now-unused imports. Leave `src/components/forms/form-spine.tsx:227` (a context provider value) and the ones inside `src/components/ui/data-table/index.tsx` (controlled-state updaters handed to TanStack Table).

### 32. quick-add-dialog-registry (downgraded)

**Files:** `src/components/forms/entity-select/driver-quick-add-dialog.tsx` (55), `operator-quick-add-dialog.tsx` (55), `vehicle-quick-add-dialog.tsx` (66), `feedstock-type-quick-add-dialog.tsx` (68), `formulation-quick-add-dialog.tsx` (72), `storage-location-quick-add-dialog.tsx` (87), `supplier-quick-add-dialog.tsx` (214), plus `entity-select.tsx`.

**Evidence and verification result: confirmed but overstated.** `diff driver-quick-add-dialog.tsx operator-quick-add-dialog.tsx` gives 34 differing lines out of 110 combined, 31 percent, not "byte-identical apart from the noun". Excluding `supplier-quick-add-dialog.tsx` (bespoke location handling, and the only one with a test at 381 lines), the six remaining files are about 406 LOC and a registry plus six configs lands near 130, so the realistic delta is about -270.

**Proposal.** One `QUICK_ADD_REGISTRY: Record<QuickAddEntityType, {...}>` plus one generic `<QuickAddDialog entityType …>`. In `entity-select.tsx`, collapse the five parallel `is*DialogOpen` booleans to a single `quickAddType: QuickAddEntityType | null`, which also deletes the `defaultCreateAction` memo. Keep supplier as a registry entry with a custom Form and keep its test.

### 33. schemas-update-restates-form (downgraded)

**Files:** 19 files under `src/schemas/` carrying 21 `update*Schema = z.object({...})` blocks, notably `suppliers.ts`, `customers.ts`, `production-runs.ts`, `samples.ts`, `storage-locations.ts`.

**Evidence and verification result: duplication confirmed, the proposed transform refuted.** 21 blocks confirmed by grep. But `xFormSchema.partial()` is not equivalent. Reading `src/schemas/suppliers.ts:26-77` against `:93-110`: the update schema adds a `code` field the form schema does not have, and adds `.nullable()` to `location`, `address`, `contactName` and `contactEmail` where the form schema has only `.optional().or(z.literal(""))`. Nullability at the fn boundary is load-bearing, since `null` clears a column and `undefined` leaves it. The duplication is real and the loss of friendly messages on the update path is a genuine defect, but the fix is per-entity, not a transform. Estimate lowered to about -200 and risk raised to medium-high.

**Proposal.** Per entity, build the update schema from the form schema and then explicitly re-add the id field, the `code` field where it exists, and `.nullable()` exactly where the current schema has it. Diff the inferred type before and after. Do the entities with colocated schema tests first (customers, suppliers, deliveries, credit-batches, storage-locations, feedstocks, formulations, biochar-products, vehicles).

### 34. fn-cert-passthrough-modules (downgraded)

**Files:** `src/fn/certification/certify-entity-readiness.ts` (30), `certify-context.ts` (54), `removal-grouping.ts` (29), `evidence-ledger.ts`, `durability-evidence-ledger.ts`, `certify-readiness-gaps.ts`.

**Evidence and verification result: three of six confirmed, one refuted.** `certify-entity-readiness.ts` is 30 lines returning a field-for-field copy of its input, `certify-context.ts` is 54 lines of four verbatim forwards plus a duplicated type re-export block, and `removal-grouping.ts` is 29 lines whose `submitRemovalAction` reaches only the barrel line at `src/fn/certification/index.ts:50`. `ensureTransportEvidenceLedgerSource` and `ensureDurabilityEvidenceLedgerSource` have no call site outside their own file (only their `...FromContext` twins are called). Refuted: `certify-readiness-gaps.ts` is 180 lines, not a thin accessor file. Only the single exported `buildEntityReadinessGaps` is dead; the file stays. Estimate lowered from -120 to about -90.

**Proposal.** Delete the three small modules and the two unused loaders, delete `buildEntityReadinessGaps` from `certify-readiness-gaps.ts`, and reduce `certify-context.ts` to a single `export { ... } from "./certify-context-core"` line. Keep the file itself: it is the `"use server"` boundary the client hooks need.

### 35. db-unwired-sample-contaminants (downgraded)

**Files:** `src/db/schema/production.ts:256-270`.

**Evidence and verification result: unwired confirmed, reference-free refuted.** The 12 contaminant columns (`arsenicMgKg` through `furansNgKg`) are absent from `src/schemas/samples.ts`, the sample form, the sample list, `src/fn/samples.ts`, `src/data-access/samples.ts` and the seed data, while every neighbouring column on that table is present in all of them. But `arsenicMgKg` is exercised by `tests/numeric-precision.test.ts:104-117`, which inserts and reads it back to pin its numeric scale. So they are unwired from the app, not unreferenced.

**Proposal.** Do not delete on codebase evidence. Check the Isometric biochar module text through the `how_to` path on the isometric MCP first, per the standing rule that requirements here have been hallucinated four times. Then either wire the block into `src/schemas/samples.ts` and the sample form, or drop the columns and the precision test together.

### 36. docs-archive-weight

**Files:** `docs/archive/`, `docs/qa/`, `docs/open-questions*.md`.

**Evidence and verification result: confirmed.** `docs/archive` is 247 files and 67,314 lines. `docs/qa` is 138 files and 40,774 lines, of which `git ls-files docs/qa` shows only 5 tracked. `eslint.config.mjs` already carves out `docs/qa/artifacts/**` because untracked QA tooling was breaking `pnpm lint`.

**Proposal.** Move `docs/archive/` out of the working tree (it is recoverable from git history and the `CLAUDE.md` docs index does not link to it); either commit the QA reports on purpose or add `docs/qa/` to `.gitignore`; merge `docs/open-questions-toolchain.md` (72 lines) back into `docs/open-questions.md` and leave the isometric and audit splits alone. This is markdown only and should not be counted against source LOC targets.

### 37. legacy-production-batch-window-compat (downgraded, do not delete yet)

**Files:** `src/fn/certification/production-batches.ts`, `production-batches.test.ts`.

**Evidence and verification result: cluster confirmed present, deletion not authorized.** `LEGACY_DAY_START_SUFFIX` and `LEGACY_DAY_END_SUFFIX` at lines 73-74, `matchesLegacyDateBoundPayloadHash` at 387, `LegacyProductionBatchWindow` and the window classifier at 408-476, `recordLegacyProductionBatchClaim` at 478, wired into the reconcile path at 213 and 308. Two reasons not to delete: it has a colocated test, and decisively, the state it reconciles lives on the remote Isometric registry, not in our database, so the "no production DB" rule does not reach it.

**Proposal.** Leave in place. Before anyone proposes this again, query the sandbox project for production batches whose `started_at` ends in `T00:00:00.000Z`. If none exist, the cluster can go; if any exist, it is load-bearing.

## Refuted or downgraded

Short reasons so nobody re-proposes these as stated.

- **`assertSameOrg` is a one-line drop-in replacement.** Refuted. Zero of the 31 hand-rolled sites throw the `assertSameOrg` message; they throw `"Customer not found"`, `"Facility not found"`, `"Facility not found or archived"`. The swap changes user-facing copy at every site and the archived variants need a different helper.
- **`update*Schema = xFormSchema.partial().extend({ id })`.** Refuted as written. The update schemas add a `code` field the form schemas lack and add `.nullable()` where the form schemas have only `.optional()`. Nullability decides whether a column is cleared or left alone.
- **`certify-readiness-gaps.ts` is a thin 34-line accessor to delete.** Refuted. The file is 180 lines; only the exported `buildEntityReadinessGaps` is dead.
- **Start the party unification with the location trio because the diff is smallest.** Refuted. That pair is 44 percent divergent, the most of the four. Start with the detail pair at 17 percent.
- **Driver and operator quick-add dialogs are byte-identical apart from the noun.** Downgraded. They differ on 34 of 110 lines. The registry still pays for itself, at roughly -270 rather than -350.
- **17 CI setup blocks across 9 workflows.** Downgraded to 16 blocks across 7 files, saving about 240 lines.
- **The 12 sample contaminant columns have exactly one reference each.** Downgraded. `arsenicMgKg` is exercised by `tests/numeric-precision.test.ts`, and the delete-or-wire decision belongs to the Isometric module text, not to this codebase.
- **The telemetry stack is safe to delete because nothing reaches it.** Downgraded to an owner decision: `docs/adr/0006-data-upload-submission-idempotency.md` and `docs/open-questions-isometric.md:579` both track it as deliberately parked with a documented resolution path.
- **The day-boundary production-batch compat is dead because there is no production database.** Downgraded. It guards remote registry state, and it has a test.
- **knip's unused-export lists are deletion candidates.** Refuted across the board. In every case checked, knip was flagging a barrel re-export line while the symbol was alive via a direct import: `src/components/certification/index.ts` (21 flags, 3 genuinely dead components), `src/lib/isometric/index.ts` (62 flags, mostly deep-imported), `tests/e2e/fixtures/index.ts` (22 flags, several live), the ~19 `*Keys` query-key factories (all used inside their own file), `src/components/ui/slide-over-panel/index.tsx` (9 flags, all consumed through a namespace object), and the `src/schemas` `Delete<Entity>Data` type aliases whose neighbouring `deleteXSchema` values are live. `src/data-access/production-runs/index.ts`'s `assertProductionRunTimesNotFuture` has 11 references; knip is flagging the barrel.

## Not worth touching

Merged from all four analysts. These were examined and found correct as they are.

- `src/data-access/utils.ts` (77 lines: `requireOrgScope`, `assertSameOrg`, `requireOrgFacility`, `humanizeTableName`). The right seam. The recommendation is to use it more, never less.
- The 33 `// org-scope-ok:` waivers. Every one carries a real reason: the organization predicate is composed into a `conditions` array the static checker cannot follow.
- `src/data-access/lock-bin-stocks.ts` (60 lines). The per-bin loop over sorted ids is a deliberate deadlock-avoidance ordering, not an N+1.
- The `*-stock-locks` family (delivery 420, biochar-product 430, production-run 158, order 142). Four files encoding four different domain rules. Merging them would be a regression.
- `src/data-access/certification-submissions.ts` (859 lines). One concept: the claim choreography. Its split from `certification.ts` is conceptual.
- The evidence-ledger cluster (`evidence-ledger-core.ts` and friends). The best-factored cluster in the certification region.
- `src/components/ui/data-table/index.tsx` (960 lines). The shared abstraction, not duplication. Its internal `useCallback`s are controlled-state updaters for TanStack Table, a legitimate exception to the no-manual-memo rule.
- `src/components/chain-of-custody/use-chain-graph.ts` (784 lines). One concept; DAG, Map and Sankey do not each build their own graph model.
- `src/components/dashboard/flow-hero*.tsx` (~1,200 lines). Original design work with no duplicate.
- `src/app/**` route files. Thin `page.tsx` wrappers are the App Router contract. The two `error.tsx` boundaries differ deliberately and both explain why.
- `src/app/styleguide/page.tsx` (785 lines). A live design reference cited by `docs/design-system.md`, auth-gated, and code-split.
- `src/db/seed-data.ts` (2,410 lines). Exempt from the cap in `eslint.config.mjs`, correctly.
- `src/db/aggregate.ts`, `errors.ts`, `org-defaults.ts`, `index.ts` (369 lines total). Tight and single-purpose.
- `getDashboardOverview` and `dashboard-attention.ts`. Already a nested `Promise.all`; no N+1 to unwind.
- The `linkedProductionRunId` "legacy" path (86 references, 23 files). Despite the word legacy, both branches are still written at `src/data-access/biochar-product-create.ts:224-275` and the run-linked branch writes no allocation rows, so the dual read path is load-bearing.
- Zod validation across layers. Not duplicated: `src/data-access` imports only types and constants from `@/schemas`.
- `src/lib/isometric/generated/**`. Regenerated from the OpenAPI spec.
- `src/lib/certification/ghg-statement-report/canonical-pdf.ts`. A distinct concern with its own tests. Note the working tree currently has uncommitted edits to `ghg-statement-report/pdf.ts` and `pdf.test.ts`, so this whole area is in flux.
- `src/lib/geo/**` vs `src/lib/geojson/**`. Different jobs despite similar names.
- `src/config/**` (592 lines, 8 files). Every file has real importers; correct granularity.
- `src/lib/cli/**` (831 lines). Every file is a `package.json` script target or a workflow step.
- The four custom check scripts (`check:org-scoping`, `check:spacing-scale`, `check:ux-copy`, `docs:check`). Each catches a class of failure nothing else catches, and costs seconds.
- `date-fns` + `date-fns-tz`, `maplibre-gl` + `@xyflow/react`, the four `@turf/*` packages. Checked for the two-libraries-one-job pattern; none of them are.
- `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`. 206 lines, every non-obvious line commented with the failure it prevents.
- Test coverage generally. 466 test files against 984 source files. Apart from the 12 `readFileSync` files, do not cut tests.
- The small shared hooks the owner already extracted correctly: `use-list-pagination.ts`, `use-clear-on-dependency-change.ts`, `use-open-create-intent.ts`, `use-quick-add-submit.ts`, `use-debounce.ts`, `entity-query-keys.ts`. These are the models for the larger extractions proposed above.
- Every Isometric submission gate inspected (`removalTemplateTierCompatibilityBlocker`, `assertSupportedDurabilityConfiguration`, `checkProtocolVersionAtSubmit`, `assertSequestrationTemplateBindings`, `assertReportingWindowNotInverted`, `assertRemovalDatesNotFuture`, the three `assertReviewedCompilationHash` calls, `durabilityGateBlockers`). Each has exactly one implementation and a live call site. No gate is proposed for removal anywhere in this report.

## Suggested rollout

Five phases in dependency order. Each phase should leave the app working with `pnpm lint`, `pnpm typecheck` and the Vitest suite green before the next starts. Feature branch and PR per phase, base `staging`, per `CLAUDE.md`.

**Phase 1: mechanical deletions (bulk agent, low risk).** Findings 1 (74 dead hook exports plus the 11 `use-entities` wrappers), 4 (carbon-breakdown pipeline), 13 (dead schema scaffolding), 15 (dead cert components and barrel prune), 16 (13 dead data-access exports plus the stale comment fixes), 17 (dead options vertical, delete alongside the hooks so no half-vertical exists), 20 (`view-related-link`, `ui-store`, `zustand`, `bcryptjs`, duplicate `cn`, unused skeletons), 27 (dead E2E fixtures), 30 (three dead pgEnums plus a migration), 31 (7 unmemoizable memo calls), 34 (three passthrough modules and the two unused ledger loaders). Also the smaller unverified deletions in `region-dead-exports` and `dead-one-off-scripts`, but grep each symbol individually first: those two were not adversarially checked here. Expect roughly 4,500 to 5,000 lines. This phase suits a bulk implementation agent, split into three or four commits by area.

**Phase 2: helper rollouts (bulk agent after a human-written seam).** Finding 2 (218 unwraps, fully mechanical, do it after phase 1 so you do not rewrite deleted hooks), then finding 3 (the `withAction` migration). Phase 3's `logContext` option on `src/fn/with-action.ts` is a human-written prerequisite; only the per-file conversions after it are agent work, one entity per commit. Add finding 23 (the `<QueryState>` helper and its 15 call sites) here. Expect roughly 2,200 lines.

**Phase 3: data-access consolidation (human-led, agent-assisted).** Findings 8 (projection and join extraction, per entity) and 26 (`resolvePaging` / `countRows`) in the same per-entity commits, then 25 (fold the satellite files back once the parents have room), then 12 (the entity-select adapter factory, with a table-driven test written before any file is deleted), then 18 (the `assertSameOrg` migration, after the owner settles the error copy) and 21 (two-phase the storage-location bin picker, on the same file as its projection extraction). Finding 22 (the delivered-mass builder) belongs here but stays human-only: it is the overdraw guard. Expect roughly 1,800 lines plus the query-cost win.

**Phase 4: UI consolidation (human-led).** Finding 7 (`useEntityListController` plus `EntityListPage`), migrating reactors, formulations, customers and suppliers by hand to prove the shape, then handing the remaining 11 to an agent. Resolve the deep-link effect divergence (unverified, six different guards, two possibly able to drop a valid link) before the controller absorbs it. Then finding 11 (the party unification, detail pair first), finding 24 (one `CheckRow` through `@/lib/status-state`), finding 32 (the quick-add registry), and finding 19's test deletions where they are unblocked by the merges. Expect roughly 2,500 to 3,000 lines.

**Phase 5: owner decisions and tooling (human only).** Findings 5 (`/schema`, decide on the unauthenticated exposure, not the line count), 9 (telemetry wire-or-delete against ADR 0006), 10 (the template diagnostic pane), 35 (contaminant columns, after checking the Isometric module through the MCP), 6 and 29 (the hub loader swap and the submit recompiles, both touching the registry submission path), 33 (per-entity update-schema conversion), 28 (the composite CI action), 36 (the docs archive move). None of these should go to an agent unsupervised. Finding 37 stays untouched until the sandbox registry is queried.

## Metrics baseline

From `scratchpad/metrics.md`, branch `codex/fix-submission-progress`, 2026-09-07. Use these to measure progress.

Source LOC by directory (non-test): `src/components/` 71,073; `src/data-access/` 40,191; `src/lib/` 35,554; `src/fn/` 24,099; `src/hooks/` 11,251; `src/db/` 8,248; `src/schemas/` 7,049; `src/app/` 3,341; `src/config/` 592; `src/stores/` 15; `src/utils/` 10. Total roughly 201,000.

Largest component areas: `certification/` 13,083; `chain-of-custody/` 6,757; `ui/` 6,155; `forms/` 4,922; `production-runs/` 3,830; `credit-batches/` 3,602; `applications/` 3,400.

Largest lib areas: `isometric/` 14,536; `certification/` 11,438; `auth/` 1,324; `calculations/` 1,293; `cli/` 831.

Files at or near the 1000-line cap (excluding the exempt `src/db/seed-data.ts` at 2,410): `src/data-access/certification.ts` 1,000; `src/fn/certification/submit-removal.ts` 999; `src/data-access/deliveries.ts` 997; `production-runs/mutations.ts` 995; `entities/storage-locations.ts` 993; `samples.ts` 990; `credit-batches.ts` 990; `biochar-products.ts` 987; `credit-batch-accounting.ts` 981.

Counts: 984 source files, 466 test files. 47 files use `useEffect`; 15 use `useMemo` or `useCallback` (this is a React Compiler project, so the second number should trend to near zero). 33 `org-scope-ok` waivers, all deliberate. 36 dependencies, 22 devDependencies.

Tool output: knip reports 0 unused files, 479 unused exports, 319 unused types, 19 duplicate exports, unused dep `zustand`, unused devDep `bcryptjs`. Treat the export counts as leads only: verified here, most are barrel lines, not dead symbols. jscpd reports 129 exact clones and 2,731 duplicated lines at 80 tokens / 8 lines minimum, which understates the per-entity replication because it is below the clone threshold in many files.

Docs (markdown only, outside the source count): `docs/archive` 247 files and 67,314 lines; `docs/qa` 138 files and 40,774 lines with 5 tracked by git.

Targets if the confirmed findings land: source down roughly 12,000 to 15,000 lines, `useMemo`/`useCallback` files down from 15 to about 8, hand-rolled `ActionResult` unwraps from 218 to 0, `} catch (error) {` blocks in `src/fn/*.ts` from 129 to under 20, `totalPages = Math.ceil` sites from 12 to 1, and the `COALESCE(deliveries.biocharProductId, orders.biocharProductId)` rule from 10 copies to 1.
## Appendix: findings not adversarially checked

The verifier ran out of budget before these 19. Each carries the analyst's own evidence and is a lead, not a confirmed item. Grep each symbol before acting on it.

### certifier-application-join-duplicated

**The five-table org-scoped application→delivery→order→location→project join is copy-pasted across certifier data-access files (and eight more places repo-wide)** (duplication, est. -45 lines, risk low, effort M)

Files: `src/data-access/certifier-biochar-applications.ts`, `src/data-access/certifier-storage-locations.ts`

Evidence: jscpd: `data-access/certifier-biochar-applications.ts:88 ↔ data-access/certifier-storage-locations.ts:116`, 39 lines / 174 tokens. Reading both, the innerJoin(deliveries) / innerJoin(orders) / leftJoin(customerLocations on `coalesce(deliveries.customerLocationId, orders.customerLocationId)`) / leftJoin(certifierProjects) chain, including every `eq(<table>.organizationId, ctx.organizationId)` predicate, is identical; only the `.select({...})` column list and the final `.where` differ. `grep -rn 'coalesce(\${deliveries.customerLocationId}' src/data-access` shows 10 copies across 7 files (applications.ts ×3, deliveries.ts ×2, transport-legs.ts ×2, chain-of-custody-geo.ts, plus these two). Each copy independently repeats the org predicate, so a single omission is a cross-tenant leak.

Proposal: Add one exported query builder in a shared data-access helper, e.g. `applicationRegistryScope(ctx, provider)` returning the joined `.from(applications).innerJoin(...)...` chain with all org predicates baked in; each caller then supplies only its `.select()` and `.where()`. Start with the two certifier files, then fold the other copies in as follow-ups.

Verifier note: Did not open src/data-access/certifier-biochar-applications.ts or certifier-storage-locations.ts. Plausible and overlapping with the confirmed da-delivered-mass-query finding, which found 10 copies of the neighbouring coalesce rule, but the specific 39-line join clone is unverified.

### region-dead-exports

**About 15 genuinely dead exports across lib/isometric, lib/certification and data-access/certifier-* (verified, not knip noise)** (dead-code, est. -190 lines, risk low, effort S)

Files: `src/lib/isometric/projects.ts`, `src/lib/isometric/submissions.ts`, `src/lib/isometric/utils/aggregation.ts`, `src/lib/isometric/links.ts`, `src/lib/isometric/sensors.ts`, `src/lib/isometric/transformers/measurement-sample.ts`, `src/lib/isometric/index.ts`, `src/lib/certification/requirement-labels.ts`, `src/lib/certification/application-evidence.ts`, `src/lib/certification/status.ts`, `src/data-access/certification.ts`, `src/data-access/certifier-document-uploads.ts`, `src/data-access/certifier-sensors.ts`, `src/hooks/use-certification-sources.ts`

Evidence: For each symbol I ran `grep -rl "\bNAME\b" src tests scripts` and confirmed the only file is its own definition (plus, where noted, the src/lib/isometric/index.ts barrel line that re-exports it). Confirmed dead: `listComponents` + `ListComponentsArgs` + `IsometricComponent` + `IsometricComponentScope` (projects.ts:52-73, ~35 lines); `createComponent` + `CreateComponentRequest` + `Component` and `listDatapoints` + `ListDatapointsArgs` (submissions.ts:17-19, 79-140); `validateForTemplate` + `ResolvedTemplateInput` + `MissingInput` + the private `NestedInputMapping` (aggregation.ts:407-469, ~63 lines, no test covers it, `grep validateForTemplate src/lib/isometric/utils/aggregation.test.ts` is empty); `isometricDocs` (links.ts:113-120); `getSensorById` (sensors.ts:50-52); `buildBiocharUnsampledBatchSample` (measurement-sample.ts:370-399, 30 lines); `SEQUESTRATION_1000_YEAR_COMPONENT_CONTRACTS`; `requirementLabelFor` (requirement-labels.ts); `APPLICATION_VISUAL_EVIDENCE_ROLE_DESCRIPTIONS`, `APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS`, `APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_DESCRIPTIONS` (application-evidence.ts); `REMOVAL_SUBMISSION_INTERRUPTED_OUTCOME` (status.ts); `getSubmissionWithLatestSyncEvent` (certification.ts:923-946, 24 lines incl. a live DB query); `updateDocumentUploadMetadata`; `decodeRowMeasurementProperty`; `useUnlinkDocumentSource` (use-certification-sources.ts:89-104, the server fn `unlinkDocumentSource` stays, it is called from submit-removal.ts). Separately, ~10 symbols are exported but used only inside their own file and can drop the `export` keyword: `mirrorLockKey`, `BIOCHAR_APPLICATION_RATE_UNIT`, `BIOCHAR_APPLICATION_TRUCK_MASS_UNIT`, `H_TO_CORG_RECONCILIATION_TOLERANCE`, `MAX_BUCKET_SECONDS`, `SEQUESTRATION_BLUEPRINT_KEYS`, `CARBON_CONTENT_FRACTION_SCALE`, `SOIL_TEMPERATURE_UNIT`, `H_C_MOLAR_RATIO_UNIT`, and the four `REMOTE_*_METADATA_KEY` constants in certifier-ghg-statements.ts.

Proposal: Delete the confirmed-dead symbols and their entries in src/lib/isometric/index.ts; downgrade the file-local ones from `export` to module-private. No behaviour touches the Isometric wire protocol, none of these functions is on a submit path.

Verifier note: Spot-confirmed only the four members that also appear in da-dead-exports (getSubmissionWithLatestSyncEvent, updateDocumentUploadMetadata, decodeRowMeasurementProperty, and the two ensure*EvidenceLedgerSource loaders). The other ten isometric and certification symbols (listComponents, createComponent, listDatapoints, validateForTemplate, isometricDocs, getSensorById, buildBiocharUnsampledBatchSample, requirementLabelFor, the application-evidence label maps, REMOVAL_SUBMISSION_INTERRUPTED_OUTCOME) were not individually greppped. Treat as plausible, verify before deleting.

### durability-sampling-helpers-triplicated

**samplingDayOf / formatDayInZone are copy-pasted verbatim into two files and the inorganic-carbon derivation exists in three** (duplication, est. -70 lines, risk low, effort S)

Files: `src/lib/certification/durability-batch-summary.ts`, `src/lib/certification/evidence-ledger/durability-build-model.ts`, `src/lib/isometric/utils/durability-aggregation.ts`

Evidence: jscpd pair `lib/certification/durability-batch-summary.ts:50 ↔ lib/certification/evidence-ledger/durability-build-model.ts:61` (33 lines) and `:329 ↔ :125` (11 lines). Reading both: `function samplingDayOf(samplingTime: unknown, facilityTimezone)` and `function formatDayInZone(date, facilityTimezone)` are byte-identical in durability-batch-summary.ts:50-81 and durability-build-model.ts:61-92, including the multi-line comment about offset-bearing strings. Both are private, so drift is silent. The per-replicate builders (`durability-batch-summary.ts:318-341` → `DurabilitySummaryReplicate`, `durability-build-model.ts:117-140` → `LedgerReplicate`) share the same seven `isUsableNumber(...) ? ... : null` field mappings. Inorganic carbon is derived three times: `replicateInorganicCarbon` (durability-aggregation.ts:75), `replicateInorganic` (durability-build-model.ts:98) whose own comment says "mirrors `replicateInorganicCarbon`", and implicitly again in the summary path.

Proposal: Add a new src/lib/certification/durability-replicate.ts module exporting `samplingDayOf`, `formatDayInZone`, and one `replicateInorganicCarbon(sample): { value, derived }`; have all three modules import it. The two replicate row builders then differ only by their extra fields (`outlier`/`productionRunCode` vs `ref`/`inorganicDerived`).

Verifier note: Did not diff durability-batch-summary.ts against evidence-ledger/durability-build-model.ts. Low stakes either way at about -70 lines.

### evidence-ledger-pdf-tails

**The three evidence-ledger PDF renderers repeat an identical footer / buildDocument / render tail** (duplication, est. -75 lines, risk medium, effort M)

Files: `src/lib/certification/evidence-ledger/pdf.ts`, `src/lib/certification/evidence-ledger/durability-pdf.ts`, `src/lib/certification/evidence-ledger/durability-1000-pdf.ts`, `src/lib/certification/evidence-ledger/pdf-theme.ts`

Evidence: jscpd flags `durability-pdf.ts:162 ↔ pdf.ts:115`. Reading the tails: `footer(model)` (pdf.ts:334-348, durability-pdf.ts:362-376, durability-1000-pdf.ts:318-339) differs only in the label string; `buildDocument` (pdf.ts:349-366, durability-pdf.ts:377-392, durability-1000-pdf.ts:340-362) differs only in title/subject and the list of section elements; and each `renderXPdf` is a one-line `renderLedgerToBuffer(buildDocument(model))`. `styles` blocks do NOT overlap meaningfully (I compared the style key sets: 3 shared keys out of 23/37/24), so only the tail is shareable.

Proposal: Add `ledgerDocument({ title, subject, footerLabel, generatedAtIso, pageStyle, sections })` to `pdf-theme.ts` (which already owns `renderLedgerToBuffer`, `C`, `t`, `v`). Each renderer then ends in one call. Do not attempt to unify the `styles` objects.

Verifier note: Did not read the three PDF renderers. Note the working tree already has uncommitted edits to src/lib/certification/ghg-statement-report/pdf.ts and pdf.test.ts, so this area is in flux and should not be touched blind.

### sequestration-template-walk-duplicated

**The sequestration template walk + binding resolution is written twice inside sequestration-binding.ts** (duplication, est. -25 lines, risk low, effort S)

Files: `src/lib/isometric/transformers/sequestration-binding.ts`

Evidence: jscpd self-clone `sequestration-binding.ts:307 ↔ :397` (18 lines / 87 tokens). Both `buildDirectSequestrationDatapoints` (~line 300) and `bindSequestrationDatapointsToTemplate` (line 392) open with the same nested walk: `for (group of template.groups) for (component of group.components)` → `if (!isSequestrationBlueprintFamily(component.blueprint_key)) continue` → `assertSupportedSequestrationBlueprint(...)` → `for (rtcInput of component.inputs)` → `getSequestrationInputBinding(...)` → `if (!binding) throw missingInputBindingError(...)`. A drift between the two would mean the datapoints posted and the datapoints bound disagree about which components count.

Proposal: Extract `forEachSequestrationBinding(template, cb: (ctx: { group, component, rtcInput, binding }) => void)` in the same module and have both functions drive it. This is the exact place where a silent divergence between "what we post" and "what we bind" would be worst.

Verifier note: Did not open src/lib/isometric/transformers/sequestration-binding.ts. Flagged as the place a silent post-vs-bind divergence would hurt most, so it deserves a look, but I have no evidence either way.

### facility-setup-gaps-parallel-derivation

**deriveFacilitySetupGaps re-derives the same five facility-setup facts the readiness checklist already classifies** (duplication, est. -50 lines, risk medium, effort M)

Files: `src/lib/certification/facility-setup-gaps.ts`, `src/lib/certification/readiness.ts`

Evidence: `deriveFacilitySetupGaps` (facility-setup-gaps.ts:67-83) branches, in order, on `hasOrgCredentials`, `mapping`, `missingDefaultTemplateId`, `defaultTemplate`, `unresolvedBlueprintKeys`. `buildRemovalRequirementsChecklist` (readiness.ts:709-760) computes `linked = facts.hasMapping`, `credentialsConfigured = facts.hasOrgCredentials`, `templateClean = credentialsConfigured && templateResolvesCleanly(facts)` and `templateBlockerReason(facts)` (readiness.ts:157-179) off the same five fields, then emits the `mapping` / `credentials` / `template` rows. Two independently-maintained expressions of one precondition ladder, both feeding the same New-Removal wizard.

Proposal: Make `readiness.ts` derive its `mapping` / `credentials` / `template` rows from `deriveFacilitySetupGaps(facts)`, one gap kind maps to one unmet row, an empty array means all three are met, so `templateBlockerReason` and `templateResolvesCleanly` collapse into the gap-kind switch. Lower priority than the other findings; take it only when touching this area.

Verifier note: Did not compare facility-setup-gaps.ts against readiness.ts:157-179 and :709-760.

### removals-for-facility-n-plus-1

**loadRemovalsForFacility issues 2N+2 queries when both batched readers it needs already exist** (performance, est. -20 lines, risk low, effort S)

Files: `src/fn/certification/certify-context-core.ts`, `src/data-access/certifier-removals.ts`, `src/data-access/certification.ts`

Evidence: certify-context-core.ts:930-946 loops removal rows in chunks of `FANOUT_CONCURRENCY = 8` and per removal awaits `getCreditBatchesByRemovalId(orgCtx, removal.id)` and `getLatestSubmission(orgCtx, {... localEntityId: removal.id})`. Both batched equivalents already exist and are already used elsewhere: `getCreditBatchSummariesByRemovalIds(ctx, removalIds)` (src/data-access/certifier-removals.ts:295, used by fn/certification/ghg-statements.ts:745 and removal-production-batches.ts:39) and `getLatestSubmissionsForEntities(ctx, {... localEntityIds})` (src/data-access/certification.ts:577, used by fn/certification/overview.ts:329 and ghg-statement-reports.ts:165). Both take `organizationId` in their WHERE, so org scoping is preserved.

Proposal: Replace the chunked loop with two batched calls plus in-memory `Map` lookups, mirroring how overview.ts already does it. The `FANOUT_CONCURRENCY` chunking loop disappears.

Verifier note: Did not verify that getCreditBatchSummariesByRemovalIds and getLatestSubmissionsForEntities cover the loop's needs. It is subsumed by the confirmed hub-readiness-three-walks fix if that lands, so verify it there rather than as a standalone change.

### deep-link-focus-effect-duplication

**The "deep-linked entity failed to load → clear the query param and toast" useEffect is written 6 times with 6 different guards** (react-antipattern, est. -200 lines, risk medium, effort M)

Files: `src/components/credit-batches/credit-batch-list.tsx`, `src/components/production-runs/production-run-list.tsx`, `src/components/biochar-products/biochar-product-list.tsx`, `src/components/samples/sample-list.tsx`, `src/components/feedstocks/feedstock-list.tsx`, `src/components/deliveries/delivery-list.tsx`

Evidence: Each of these six lists declares the same nuqs triple (`focused<X>Id` + `deepLinkMode` + `deepLinkFocus` via `useQueryState(parseAsString)`), a `useX(focusedId)` query, and a useEffect that clears the param and toasts on failure. The guards have all drifted: credit-batch-list.tsx:363 checks `isLoading || isFetching || isPending` and keeps a `handledInvalidBatchIdRef`; production-run-list.tsx:397 does the same plus a facility mismatch branch; biochar-product-list.tsx:330 checks only `isLoading` then calls `queueMicrotask(() => setFocusedProductId(null))`; sample-list.tsx:288 and feedstock-list.tsx:426 check `error || (isSuccess && !data)` with no in-flight guard at all; delivery-list.tsx:379 checks only `isError`. The toast strings differ too ('Linked credit batch could not be opened' / 'The linked Sample could not be opened.' / 'Linked feedstock could not be opened'). The versions without an in-flight guard can fire mid-fetch and drop a valid deep link. Separately, the same file set repeats a second effect family: 'sync facilityId from the facility context on create' appears 6 times (credit-batch-form.tsx:122, biochar-product-form.tsx:436, reactor-form.tsx:97, production-run-form.tsx:277, order-form.tsx:171, feedstock-form.tsx:309) with four different guards (`!getValues('facilityId')`, `!currentValue`, `!== watchedFacilityId`, `!watchedFacilityId`). And production-run-form.tsx:284 and biochar-product-form.tsx:445 hand-roll a `prevFacilityRef` clear-on-change effect even though `src/hooks/use-clear-on-dependency-change.ts` already exists and is used by order-form, delivery-form, feedstock-type-form and form-entity-select.

Proposal: Add `useDeepLinkedEntity({ id, setId, query, message, extraClear })` to src/hooks, one implementation with the strictest guard (skip while isLoading/isFetching/isPending, remember the handled id in a ref) and one message template, and replace all six copies. Add `useFacilityIdDefault(form, existingEntity)` for the second family. Replace the two hand-rolled prevFacilityRef effects with the existing `useClearOnDependencyChange`. Under the React Compiler these are the only effects left in the list files that are not external-system sync.

Verifier note: Did not open the six deep-link effects to compare guards. The claim that some lack an in-flight guard and can drop a valid deep link is a correctness claim, not just duplication, so it should be verified before the entity-list-scaffold work absorbs these files.

### attached-documents-panel-duplication

**Three entity document panels re-implement the same attached-file list, visibility toggle and delete flow (~700 LOC, ~50% identical)** (duplication, est. -180 lines, risk low, effort M)

Files: `src/components/samples/sample-documents-panel.tsx`, `src/components/production-runs/production-readings-documents.tsx`, `src/components/transport-legs/transport-evidence-documents.tsx`, `src/components/applications/application-evidence-document-list.tsx`

Evidence: jscpd finds three clone pairs among them (18L/85tok, 18L/97tok, 18L/81tok). Normalizing the entity noun and diffing: sample-documents-panel.tsx (213) vs transport-evidence-documents.tsx (251) differ on 244 of 464 lines; vs production-readings-documents.tsx (238) differ on 221 of 451. The identical half is the presentational block: the `<ul>` of `<li>` rows with the FileIcon, `{doc.documentType} · {formatFileSize(doc.fileSizeBytes)} · {doc.visibility}` caption, the `/api/documents/${doc.id}` open link with `aria-label={'Open ' + doc.fileName}`, the private/public eye toggle button, the destructive delete button, the isLoading/empty paragraphs, the ServerError placements and the DeleteConfirmDialog, all with the same hardcoded token classnames repeated three times.

Proposal: Extract `<AttachedDocumentList documents readOnly onToggleVisibility onDelete isTogglePending isDeletePending emptyHint>` (presentational, ~90 lines) into src/components/ui/ or src/components/forms/, and have the three panels keep only their entityType/documentType constants, their hook wiring and their FormFileUpload props. The fourth file, application-evidence-document-list.tsx (113 lines), should be checked for the same row markup and folded in if it matches.

Verifier note: Did not diff the three document panels.

### production-run-subtables

**production-incident-table and production-sample-table are the same sub-table written twice (547 LOC, 360 shared)** (duplication, est. -180 lines, risk medium, effort M)

Files: `src/components/production-runs/production-incident-table.tsx`, `src/components/production-runs/production-sample-table.tsx`, `src/components/production-runs/production-incident-form.tsx`, `src/components/production-runs/production-sample-form.tsx`

Evidence: Normalizing the noun and diffing the two tables gives 187 differing lines out of 547, i.e. 360 lines are the same code. jscpd independently flags the 20L/91tok region at production-incident-table.tsx:187 <-> production-sample-table.tsx:249. Both are: a DataTable of run-scoped child rows, an add/edit dialog holding the matching *-form, a delete confirm, the same three error useStates and the same toast strings. Their two form files (212 and 316 lines) share the same shell as well.

Proposal: Give the pair one `<ProductionRunSubTable>` taking `{ columns, rows, isLoading, labels, renderForm, onCreate, onUpdate, onDelete }`. This is the same shape as the entity-list scaffold finding but at a smaller scale, so it should reuse whatever controller comes out of that work rather than inventing a second abstraction.

Verifier note: Did not diff production-incident-table.tsx against production-sample-table.tsx.

### hand-rolled-popovers

**Four hand-rolled click-outside/Escape popovers coexist with the Base UI dependency the rest of ui/ is built on** (over-abstraction, est. -250 lines, risk medium, effort M)

Files: `src/components/forms/entity-select/entity-select.tsx`, `src/components/navigation/facility-selector.tsx`, `src/components/navigation/org-brand.tsx`, `src/components/ui/data-table/index.tsx`

Evidence: `grep -rln handleClickOutside src/components src/hooks` returns exactly these four. facility-selector.tsx:29 and org-brand.tsx:79 contain the same 20-line `useEffect` adding `mousedown` + `keydown` listeners on `document` and removing them in cleanup; entity-select.tsx:372 has the mousedown half. Meanwhile package.json depends on `@base-ui/react`, which already backs src/components/ui/modal, slide-over-panel, dropdown-menu, accordion and tooltip, dropdown-menu/index.tsx is described in its own header as "Compound API mirroring SlideOverPanel" and gets dismissal for free. entity-select.tsx (773 lines) is a full hand-rolled combobox: manual highlightedIndex clamping, manual `scrollIntoView` effect, manual focus effect, manual outside-click, four refs, plus the five quick-add booleans covered separately.

Proposal: Two steps of very different size. Cheap and safe: extract `useDismissOnOutsideClick(ref, onDismiss)` (~18 lines) into src/hooks and use it in the three hand-rolled popovers, that alone removes ~55 duplicated lines and makes the Escape behaviour consistent (data-table's copy currently has no Escape handler). Larger and optional: rebuild entity-select's dropdown on the existing Base UI popover so the focus, scroll-into-view and outside-click effects disappear; only do this if someone is already touching the combobox, since it is the single most-used form control in the app and has a 362-line test.

Verifier note: Did not read the four click-outside implementations. The cheap half (extract useDismissOnOutsideClick) is low risk; the entity-select rebuild is not, and entity-select.tsx has a 362-line test.

### barrel-reexport-pruning

**~55 barrel re-exports across 20 feature index.ts files that no importer ever goes through** (dead-code, est. -55 lines, risk low, effort S)

Files: `src/components/forms/index.ts`, `src/components/forms/entity-select/index.ts`, `src/components/navigation/index.ts`, `src/components/applications/index.ts`, `src/components/customers/index.ts`, `src/components/suppliers/index.ts`, `src/components/credit-batches/index.ts`, `src/components/production-runs/index.ts`, `src/components/samples/index.ts`, `src/components/onboarding/index.ts`, `src/components/map/index.ts`

Evidence: knip reports these as unused exports and in every case I checked the symbol IS used, but imported directly from its own module, never through the barrel: e.g. `ReactorForm` is exported by src/components/reactors/index.ts yet reactor-list.tsx imports `from './reactor-form'`; the same holds for CustomerForm, SupplierForm, ApplicationForm, CreditBatchForm, SampleForm, ProductionRunForm, DeliveryForm, FacilityForm, FeedstockForm, OrderForm, StorageLocationForm, TransportLegForm, FeedstockTypeForm, BiocharProductForm, SidebarContent, FacilityProvider, FacilitySelector, OrgBrand, deriveSetupProgress and ~15 type re-exports. The barrels therefore only widen the module graph (a the feature barrel import pulls in every sibling) without being used.

Proposal: Prune each feature index.ts down to what is actually imported through it (the *-list component and the handful of shared helpers) and delete the rest of the lines. Do NOT delete the barrels themselves, docs/code-style.md mandates a barrel per flat feature folder. Also drop the QuickAddDialog / useQuickAddDialog re-export from forms/index.ts once the generic dialog is deleted.

Verifier note: Did not audit the 20 feature barrels beyond src/components/certification/index.ts, which was verified separately. The general shape (symbols alive via direct import, barrel line dead) matched every case I did check, so deleting symbols rather than barrel lines would break the app.

### da-fn-inline-return-types

**fn/ re-types data-access return shapes inline instead of importing the named type that already exists** (over-abstraction, est. -120 lines, risk low, effort S)

Files: `src/fn/customers.ts`, `src/data-access/customers.ts`, `src/data-access/suppliers.ts`, `src/data-access/chain-of-custody.ts`, `src/data-access/dashboard-overview.ts`

Evidence: jscpd pairs data-access/customers.ts:271 with fn/customers.ts:149 (18 lines): `getCustomerLocations` (data-access/customers.ts:268) declares a 14-field anonymous `Array<{ id; name; country; stateRegion; city; gpsLatitude; gpsLongitude; address; distanceFromFacilityKm; distanceSource; defaultSoilTemperatureC; isDefault; createdAt; updatedAt }>` return type, and `getCustomerLocationsFn` (fn/customers.ts:146) writes the same 14 fields out again inside `ActionResult<Array<{...}>>`. Meanwhile knip reports `CustomerLocationDetail` - declared in data-access/customers.ts - as an unused export: the named type exists and both layers ignore it. The same pattern of unused named types beside inline shapes shows in the knip data-access list (`ChainApplicationLineage`, `ChainDeliveryLineage`, `ChainOrderLineage`, `ChainBiocharProductLineage`, `ChainProductionRunLineage`, `ChainReactorLineage`, `ChainFeedstockLineage`, `TrailDocument`, `TrailSample`, `CustomerLocationDetail`, `FormulationIngredientWithFeedstockType`, `CreateFeedstockAllocation`).

Proposal: Have each data-access function annotate with its exported named type (`Promise<CustomerLocationDetail[]>`) and have the fn wrapper write `Promise<ActionResult<CustomerLocationDetail[]>>` - the codebase's own convention per docs/code-style.md ('prefer z.infer / named types over hand-written'). Delete whichever named types are still orphaned after the sweep.

Verifier note: Did not compare src/fn/customers.ts:146-172 against src/data-access/customers.ts:268-288.

### schemas-contact-address-fields

**The contact/address field group is inlined in five schemas while facilities already exports the shared version, unused** (duplication, est. -60 lines, risk low, effort S)

Files: `src/schemas/facilities.ts`, `src/schemas/suppliers.ts`, `src/schemas/customers.ts`, `src/schemas/drivers.ts`, `src/schemas/operators.ts`

Evidence: facilities.ts:128 and :139 export `contactEmailSchema` and `contactPhoneSchema` (`.email("Enter a valid email address.").max(255)...` / `.max(30, "Phone number must be less than 30 characters")...`), and facilities.ts:175-176 is their only consumer - knip flags both as unused exports. Meanwhile the identical definitions are typed out again in suppliers.ts:57-66, customers.ts:71-81, drivers.ts:24-28 and operators.ts:24-28, and again in weakened form in each file's update schema (suppliers.ts:110-111, customers.ts:139-140, facilities.ts:217-218). Same for the free-text address field: `facilityAddressSchema` (facilities.ts:113, unused export) vs the inline `address: z.string().max(500, "Address must be less than 500 characters")...` in suppliers.ts:44-48.

Proposal: Move `contactNameSchema` / `contactEmailSchema` / `contactPhoneSchema` / `addressTextSchema` into src/schemas/helpers.ts and import them from facilities, suppliers, customers, drivers and operators. Do this in the same pass as the update*Schema conversion so the update variants inherit the shared definitions automatically.

Verifier note: Did not verify the contact and address field duplication across the five schema files. It is bundled with the downgraded schemas-update-restates-form work anyway.

### cert-test-mock-boilerplate

**Certification fn tests each hand-roll the same withAction / auth / env mock preamble** (tests, est. -70 lines, risk low, effort S)

Files: `src/fn/certification/registry-observation-actions.test.ts`, `src/fn/certification/removal-production-batches.test.ts`, `src/fn/certification/removal-compilation.test.ts`, `src/fn/certification/removal-template-diagnostic.test.ts`, `src/fn/certification/storage-location-actions.test.ts`

Evidence: Five files repeat a byte-identical 13-line `vi.mock("../with-action", () => ({ withAction: async <T>(fn) => { try { return { success: true as const, data: await fn(ORG_CTX) }; } catch (error) { ... } } }))` (registry-observation-actions.test.ts:11-19, removal-production-batches.test.ts:17-25, removal-compilation.test.ts:11-19, storage-location-actions.test.ts:22-30, and a variant at removal-template-diagnostic.test.ts:21-29). `grep -n 'vi.mock(' src/fn/certification/*.test.ts | sed 's/.*vi.mock(//' | sort | uniq -c` also shows `"@/lib/auth/server"`, `"@/config/env"`, `"@/db"`, `"./shared"`, `"./registry-create"` and `"@/data-access/certification"` each duplicated across two or more files. tests/fixtures/ already holds certify-context.ts and submit-removal-orchestrator.ts, so a shared-fixture convention exists.

Proposal: Add a new src/fn/certification/test-support.ts helper (or extend tests/fixtures/certify-context.ts) exporting `mockWithAction(orgCtx)` and the standard env/auth mock factories; each test file calls the helper instead of inlining the block. Do not touch the assertions.

Verifier note: Did not diff the five withAction mock preambles in src/fn/certification/*.test.ts.

### ghg-submit-dialog-flag-soup

**GhgStatementSubmitDialog accreted a 7-branch nested-ternary title and six overlapping derived booleans across 11 fix commits** (over-abstraction, est. -40 lines, risk medium, effort M)

Files: `src/components/certification/ghg-statement-submit-dialog.tsx`, `src/components/certification/ghg-statement-workflow-state.ts`

Evidence: `git show --stat 89b87c3a` ('fix: keep GHG submission feedback visible', PR #728) is a squash of 11 sub-commits all on this dialog, and b1068dd3 ('fix: hide unused submission steps') touched it again. The result at ghg-statement-submit-dialog.tsx:198-232 is six derived flags, `showProgress`, `submissionStalled`, `displayedServerError`, `resultNeedsReview`, `verificationFailed`, `resultNeedsAction`, `showSubmissionProgress`, where `resultNeedsAction` is literally `resultNeedsReview || verificationFailed` (via `needsSubmissionReview`, lines 58-65), followed by a five-level nested ternary computing `dialogTitle` over {isPending, isSuccess, isError} x {isResubmit} x {reconciledStatus.kind}. The folder already has the right pattern for this: `ghg-statement-workflow-state.ts` (148 lines) is a pure derivation with `ghg-statement-workflow-state.test.ts` beside it.

Proposal: Extract `deriveSubmitDialogPhase({ mutationState, isResubmit, reconciledStatus, stalled })` returning `{ phase, title, showProgress, serverError }` into a pure module next to ghg-statement-workflow-state.ts with a table-driven unit test, and reduce the component to consuming that one object. This is not a line-count win so much as a defect-rate win: every one of those 11 fixes was a missed combination.

Verifier note: Did not read src/components/certification/ghg-statement-submit-dialog.tsx:198-232. Note the current branch (codex/fix-submission-progress) and the two most recent commits are both edits to this exact file, so it is actively being changed and should be left alone this week.

### facility-certifier-triple

**Three components render the same facility certifier mapping from the same hook** (duplication, est. -120 lines, risk medium, effort M)

Files: `src/components/certification/facility-certifier-section.tsx`, `src/components/certification/facility-certifier-summary.tsx`, `src/components/certification/facility-isometric-connector.tsx`

Evidence: `FacilityCertifierReadOnly` (facility-certifier-section.tsx:221-263) and `FacilityCertifierSummary` (facility-certifier-summary.tsx, 120 lines) both call `useFacilityCertifierSummary(facilityId)`, both branch loading/error/no-mapping/mapping, and both render the project id and default template id through the same `Field`/`Section` primitives from panel-layout.tsx; they differ only in an `EnvBanner` variant and a "Manage in Certification → Settings" link. `FacilityIsometricConnector` (365 lines) reads the same hook again (line 55) and its own docstring at line 16 says it exists because the facility sheet uses FacilityCertifierSummary instead. `FacilityCertifierSection` has exactly one caller, certifier-settings-panel.tsx:69.

Proposal: Keep one `FacilityCertifierMappingFields({ mapping, isProduction, projectName?, templateName? })` presentational component and one read-only container. `FacilityCertifierSection` becomes `canManage ? <Manage/> : <FacilityCertifierSummary embedded/>`, i.e. delete `FacilityCertifierReadOnly`, `CertifierHeader`'s read-only path and the duplicated field list, and give FacilityCertifierSummary an `embedded` prop plus an optional settings link. Note the read-only branch IS live (certification-settings.tsx:194 passes a dynamic `viewerCanManage`), so this is a merge, not a deletion.

Verifier note: Did not compare facility-certifier-section.tsx, facility-certifier-summary.tsx and facility-isometric-connector.tsx.

### sync-event-log-dead-table

**SyncEventLog's non-compact table branch is unreachable, every caller passes compact** (dead-code, est. -70 lines, risk low, effort S)

Files: `src/components/certification/sync-event-log.tsx`, `src/components/certification/removal-detail-sheet.tsx`, `src/components/certification/ghg-statement-detail-sheet.tsx`

Evidence: sync-event-log.tsx (175 lines) has two render paths. The only two consumers are removal-detail-sheet.tsx:288, which passes `compact`, and ghg-statement-detail-sheet.tsx:351, which imports `SyncEventList` directly and never touches `SyncEventLog`. The barrel export of `SyncEventLog` is one of knip's 21 unused entries. So the `<table>` block (lines 60-110) plus the `Th` and `Td` helpers (lines 149-175) and the `limit` prop path can never render.

Proposal: Collapse SyncEventLog to the compact path only: a `<details>` + `DisclosureSummary` + `SyncEventList`. Delete the table branch, `Th`, `Td`, and the now-constant `compact` prop. Also lift the duplicated status->colour ternary (identical in both render paths, lines 88-98 and 128-138) into one `eventStatusClass(status)` helper.

Verifier note: Did not verify that both SyncEventLog call sites pass compact.

### dead-one-off-scripts

**Two one-off investigation scripts in scripts/ have no caller and no remaining purpose** (dead-code, est. -210 lines, risk low, effort S)

Files: `scripts/find-supplier-customer-overlap.ts`, `scripts/isometric-link-demo.ts`

Evidence: `find-supplier-customer-overlap.ts` (89 lines) is referenced by nothing in package.json, .github, or docs (0 hits when grepping its basename across those); its own header says it exists to answer issue #104 and that the code-path audit already found no crossing path, the investigation is finished. `isometric-link-demo.ts` (119 lines) is a 'Phase 1 setup' script that links a facility to the Isometric demo project from the CLI; that job is now org-admin self-serve UI (certifier-settings-panel.tsx + facility-certifier-dialog.tsx). Both are also risky to leave lying around because both take a `DATABASE_URL` and one writes. The other 13 scripts are all reachable from package.json scripts or a workflow (isometric-smoke.ts 17 refs, isometric-coverage-check.ts 14, storage-smoke.ts 4, sync-env-to-vercel.ts 3, etc.), and isometric-bootstrap-constants.ts carries an explicit keep-as-static-data note.

Proposal: Delete both files. If either is wanted as a record, the finding it produced belongs in docs/archive, not as executable code with DB write access.

Verifier note: Did not grep scripts/find-supplier-customer-overlap.ts or scripts/isometric-link-demo.ts against package.json, .github and docs.


## Method

Produced 2026-09-07 by a five-agent workflow (four region analysts on Claude Opus, one adversarial verifier on Claude Opus), seeded with knip and jscpd output and the LOC metrics above. The analysts returned 58 findings; the verifier merged them to 56, confirmed 27, downgraded 10 and left 19 unchecked (listed in the appendix). The four largest counts (unwrap sites, catch blocks, the dead carbon card, the dead related-link component) were re-checked by hand after the workflow and hold. Raw agent output is not committed.
