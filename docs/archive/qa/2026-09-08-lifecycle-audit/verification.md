# Verification record and reproducibility

This records what actually ran during the lifecycle audit. A passing existing regression test supports its covered behavior; a passing archived observation probe means the specified baseline defect reproduced. Neither establishes that every route/state works in a browser. No staging, registry or production record was mutated.

## Baseline and isolation

- Audit date: 2026-09-08, Europe/Zurich.
- Checkout: local detached worktree (path not recorded), clean detached HEAD at start.
- HEAD and remote `refs/heads/staging`: `ef857545b11fa298f0f08e128868ed14e37fbf5f`, verified with `git ls-remote`.
- Baseline matches the handoff exactly. No baseline diff or branch switch was needed.
- Original dirty checkout was not modified. Existing staging/Isometric records named in the handoff were not opened for mutation, deleted, resubmitted, reset or recreated.
- Three primary investigations used `codex exec -m gpt-6-astra -c 'model_reasoning_effort="low"' -s read-only`, with independent production, distribution/evidence and registry prompts. Reports are archived alongside this document.
- An independently started task contributed three completed supplemental Astra low reports and a customer-location probe. It stopped expanding work once coordination identified this task as primary. Its test counts overlap and are not added to the primary total.
- `pnpm install --frozen-lockfile` installed the locked dependencies here. Offline installation first failed because the store lacked a package; normal locked installation succeeded. No lockfile or application source changed.
- PostgreSQL 18 came from a pre-existing local image. Parent created a uniquely owned disposable container, `noma-lifecycle-audit-20260908`, with a loopback dynamic port, no shared data mounts and an empty `noma_lifecycle_audit_test` database. The complete repository migration chain succeeded. Only synthetic fixtures lived there; the container was stopped and automatically removed after verification.
- No `.env` files were copied. Commands explicitly targeted the disposable database. No live-integration flag or credentialed registry adapter was used.

## Parent-executed tests

| Set | Result | Evidence |
|---|---|---|
| Stock/auth/registry DB boundaries | 16 suites, 123 tests passed | [Log](db-guards.log) |
| Recovery/evidence/actions | 14 suites, 263 tests passed | [Log](registry-evidence-tests.log) |
| New defect observations | 6 files, 14 observations passed | [Log](simulation.log), source `*-simulation.ts` in this folder |
| Organization-scope static checker | Passed | `pnpm check:org-scoping` |
| Isolated production build | Passed | 194 registered actions inspected; [manifest extract](action-manifest-check.json) |
| Typecheck after audit artifacts | Passed | `pnpm typecheck` |

**Primary existing-test total: 386 tests in 30 distinct suites.** The 14 observations are separate. Supplementary 282-test runs are corroborating evidence, not another 282 unique tests.

The first scope-check attempt failed because sandboxed `tsx` could not create its local IPC pipe; rerun with the appropriate tool permission passed. The first registry investigator Vitest attempt failed before collecting tests in its read-only sandbox. Parent later ran the relevant suites successfully. These environment failures are not application test failures.

DB-boundary command, with `DATABASE_URL` explicitly set to the disposable database:

```sh
pnpm exec vitest run tests/storage-location-archive.test.ts tests/bin-stock-guards-concurrency.test.ts tests/facilities-durability-guard.test.ts tests/organization-creation-transaction.test.ts tests/organizations-data-access-auth.test.ts tests/organization-settings.test.ts tests/certifier-credentials.test.ts tests/certifier-credentials-access.test.ts tests/certification-lineage-guards.test.ts tests/certification-submissions.test.ts tests/stock-reducing-update-guards.test.ts tests/registry-boundary-removal.test.ts tests/registry-boundary-sequestration.test.ts tests/registry-boundary-ghg-statement.test.ts tests/registry-boundary-ghg-statement-finalization.test.ts tests/registry-boundary-ghg-statement-orphan-reconciliation.test.ts --maxWorkers=2
```

Recovery/evidence command, against that same disposable database with mocked external adapters:

```sh
pnpm exec vitest run src/fn/certification/storage-locations.test.ts src/fn/certification/production-batches.test.ts src/fn/certification/biochar-applications.test.ts src/fn/certification/delete-removal.test.ts src/fn/certification/durability-measurement-recovery.test.ts src/fn/certification/removal-submission-failure.test.ts src/fn/certification/removal-source-freeze.test.ts src/hooks/use-create-with-evidence.test.ts tests/documents-fn.test.ts tests/documents-route.test.ts tests/documents-delete-certification-history.test.ts tests/parent-document-retirement.test.ts tests/with-action.test.ts tests/organizations-fn.test.ts --maxWorkers=2
```

## Rerun the defect observations

From the repository root, with dependencies installed and Docker running:

```sh
bash docs/archive/qa/2026-09-08-lifecycle-audit/run-simulations.sh
```

The runner creates its own disposable loopback database, applies migrations, runs the observation config and removes only its own container on exit. It never resets an existing database. The DB observation module additionally refuses any URL other than loopback with the exact audit database name. The final runner itself was syntax-checked; its migration/test commands were executed individually during this audit.

If supplying a separately created disposable audit database, use:

```sh
pnpm exec vitest run --config docs/archive/qa/2026-09-08-lifecycle-audit/simulation.config.ts --reporter=verbose
```

`DATABASE_URL` must explicitly identify that disposable database. Do not use a shared `.env.test` URL. No `*.test.ts` was added to ordinary test discovery; these point-in-time probes are loaded only by their explicit archived config.

| Probe | Executed observation |
|---|---|
| F01 role change | 25 kg feedstock → zero displayed across current lanes; movement still 25 kg |
| F01 restriction change | Same 25 kg now assigned to a different material usage |
| F02 partial type | forestry/blend saved; equivalent complete schema payload rejected |
| F03 stale facility | USA saved by A, overwritten by B's old CHE form |
| F06 intake reduction | 100−80=20 kg becomes 50−80=−30 kg |
| F07 partial moisture | 100 kg wet, 50% moisture and 90 kg dry persist together |
| F08 supplier FK failure | Supplier retained, its locations removed |
| F14 role policy | Canonical Member creation denied; quick-add Member creation persisted |
| F04 org switch | Mock switch changed active org; preference failure returned “not switched” |
| F05 body stall | At 60 seconds: request pending, no timeout timer, signal not aborted |
| F09 held GIS | Actual pre-update guard blocks held attachment |
| F10 numeric empty | Empty→undefined→omitted JSON key; zero remains zero |
| F10 location omission | Actual default-only action passes city/state null to DAL |
| F28 invitation | Actual middleware returns login redirect for anonymous invitation URL |

The customer-location probe was adapted from a supplemental deliberately red test. Its expected-regression form fails at this baseline because it expects omitted fields to remain undefined. Parent observation form asserts the actual null values. Convert these observations to desired-outcome regression tests when implementing fixes, rather than retaining tests that expect bugs.

## Build and action-registration result

Used the repository's documented hermetic CI build mode, a loopback app URL, dummy local auth configuration, local storage and the isolated database. No staging configuration or registry credentials were loaded. `pnpm build` completed including route generation.

The generated server-reference manifest contains 194 actions. None of the five suspected internal helpers is registered, and the targeted source-signature scan found no registered context-first action. This is counterevidence to the investigator's public-exposure claim. The downloaded/deployed staging manifest was not inspected and no HTTP exploit was attempted. Internal source helpers should still stay out of future client import graphs.

## Primary-source Isometric contract check

The Isometric MCP `how_to` capability was not available in either exposed tool inventory. That is a contract-verification limitation; no local summary was promoted to registry authority.

Parent retrieved the public [Certify OpenAPI specification](https://docs.isometric.com/api-reference/certify/mrv.openapi.json) on 2026-09-08 after the web opener failed. SHA-256: `de1a0cf31e26bc879531c939b46f51a43d8e5ae4741cbd43c8e84bd0d0e3677e`. The independent task retrieved the same bytes. A small [operation extract](contract-extract.json) is retained; the full temporary download is not required to read this audit.

Verified contract facts: GHG Entry DELETE is irreversible and restricted to DRAFT; Production Batch and Biochar Application support DELETE but no PATCH in the published surface; Storage Locations support PATCH/DELETE; existing GHG Statements expose GET and submit, without a statement DELETE operation. The schema describes operations but does not prove read-after-write consistency, reference uniqueness enforcement, repeated telemetry POST semantics, all possible error statuses, or project-specific amendment rules. Treat local restrictions beyond it as product policy until verified.

The source knowledge base remains pinned to Biochar Production and Storage 1.1 and its recorded modules. This audit does not alter protocol interpretation or validate new credit claims.

Parent also retrieved [PR #751](https://github.com/Maji-Studio/noma-dmrv/pull/751), its [actual staging verification](https://github.com/Maji-Studio/noma-dmrv/pull/751#issuecomment-5588056398), and [the final integration verification](https://github.com/Maji-Studio/noma-dmrv/pull/740#issuecomment-5588344600). These support the earlier successful submission and final tree equality. They are prior recorded live evidence, not a new live submission by this audit.

## Limits

No browser walkthrough, deployed multi-session stale-save test, production account, real storage CORS/timeout test, live registry deletion/cascade test, provider consistency-delay experiment, full numeric fuzzing, PDF visual QA or credential rotation during a running operation was executed. All 54 routes were inventoried; some read/auth/demo routes received static review only. The static findings F19/F20/F29/F30 and qualified evidence-parent interleavings require dedicated runtime regressions before implementation claims are finalized.

The preserved Removal `851b4445-2f77-4853-9bfd-6f13f033be8e`, GHG Entry `rmv_1M20VN12SSBXNHSQ`, Credit Batch `8ae154dd-1c39-471c-80cd-de0a3e5524c4`, Application `74ef88e0-6a07-4afc-8891-d99c0d57e762`, Storage Location `slc_1M20VN6BNSBXZ2W2`, Production Batch `ptb_1M20Q68VSSBX244Z` and Biochar Application `bse_1M20VNAKXSBX6CKC` were not changed by this audit.
