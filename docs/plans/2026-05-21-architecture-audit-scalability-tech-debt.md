# Architecture Audit — Scalability & Tech Debt

_Date: 2026-05-21 · Status: Phase 0 in progress · Source: `/ship AUDIT`_

## Context

Read-only architecture audit of **noma-dmrv** (Next.js 16, Drizzle + Postgres,
Better Auth, 27 entity CRUD modules), requested via `/ship AUDIT`. The project is
**pre-launch / low traffic**.

Steering principle: **lean, simple, safe, a bit scalable.** Fix the real risks
cheaply, leave a documented roadmap for the rest, don't gold-plate. The
architecture is fundamentally sound — strict layers, `requireAuth()` everywhere,
TS strict, Zod env validation, clean storage abstraction. Nothing here is a
rewrite.

**Verified facts** (all checked against source; corrections to an earlier draft):

- `withAction()` wraps only **9 of 33** files in `src/fn` — not a universal seam.
- A Postgres CHECK constraint **cannot** verify `creditBatches` cross-table
  aggregate drift (CHECK is row-local).
- `src/app/(app)/layout.tsx:15` `requireAuth()` reads `headers()`, so the whole
  `(app)` subtree is dynamic — "ISR on dashboards" is not directly available.
- `console.*`: **104 occurrences across 21 files** in `src` (excluding generated).
- drizzle-kit 0.31.9 exposes `generate / migrate / push / studio / check` — there
  is **no `diff` / `--dry-run`**. Migration preview = review the committed `.sql`
  file in the PR.

---

## Findings

### Tier 1 — fix before launch (correctness / security / runtime config)

- **T1 — PII in logs.** `src/lib/auth/better-auth.ts:41` logs the raw user email. CLAUDE.md forbids logging PII. One-line fix.
- **T2 — `creditBatches` aggregate drift.** Stored CO₂e / mass aggregates have nothing keeping them in sync with linked applications — a reported-number correctness risk for a carbon registry.
- **T3 — DB pool config.** `src/db/index.ts:13` defaults `max: 1` (serialises requests). Fix is a per-environment `DB_POOL_MAX` decision + docs, **not** a magic default — under serverless, per-instance pools multiply.
- **T4 — almost no indexes.** Only 3 `index()` declarations repo-wide; ~20+ FK columns unindexed → sequential scans on every JOIN/filter.
- **T5 — CI auto-migrates prod.** `.github/workflows/migrate.yml` applies migrations on push to `main` with no approval gate. The GitHub `production` environment already exists — needs required reviewers (a settings change).

### Tier 2 — soon after launch (not hard blockers)

- **H1 — no observability.** No structured logging, no error tracking; 104 `console.*` calls in `src`.
- **H2 — unbounded document query.** `listDocumentsForEntity()` (`src/data-access/documents.ts:9-22`) has no `.limit()`. Quick win = a hard cap; full pagination is a separate vertical slice.
- **H3 — file-size violations.** `entities.ts` 1323, `production-runs.ts` 1038, `seed-data.ts` 1165 exceed the 1000-line cap; no lint rule enforces it.
- **H4 — CRUD duplication.** ~40–60% copy-paste across 27 entities in `src/fn` + `src/hooks`.
- **H5 — over-fetching.** 25+ bare `.select()` queries pull whole wide rows (`samples` 50+ cols, `production_runs` 30+ cols).
- **H6 — no SSR revalidation.** Zero `revalidatePath`/`revalidateTag` in `src/fn`.

### Tier 3 — medium

M1 over-broad React Query invalidation · M2 `staleTime` drift · M3 no time-series
indexes · M4 `transportLegs` polymorphic FK unindexed · M5 `createBiocharProduct`
4 sequential FK checks · M6 session DB lookup per request · M7 no rate limit on
data routes · M8 caching must target read functions, not "ISR on dashboards" ·
M9 dual upload paths / silent presigned-URL expiry · M10 11 oversized forms.

---

## Roadmap

### Phase 0 — codable now (~1 hour, low risk)

Five small, isolated changes. No new dependencies, no architecture change.

1. **T1** — `src/lib/auth/better-auth.ts:41`: drop `email=${args.email}` from the log line, keep `userId=`.
2. **H2 guardrail** — `src/data-access/documents.ts`: add a `MAX_DOCUMENTS_PER_ENTITY` constant and apply `.limit()` on `listDocumentsForEntity()`. This is a guardrail against unbounded scans — **not** pagination; full pagination stays in Phase 3.
3. **M5** — `src/data-access/biochar-products.ts:368-431`: run the 4 independent FK checks with `Promise.all`, then evaluate the results in a **fixed order** (facility → formulation → production run → storage location) so the user-facing error stays deterministic — parallelism must not randomise which error surfaces.
4. **Lint** — add ESLint `max-lines` (warn) scoped to `src/**/*.{ts,tsx}`, excluding generated files (`src/lib/isometric/generated/**`) and seed/CLI scripts (e.g. `src/db/seed-data.ts`) — either excluded or given a relaxed threshold so Phase 0 doesn't create noisy warnings.
5. **T3 docs** — document `DB_POOL_MAX` in `.env.example` + a short note (serverless: small per-instance pool; long-lived server: size to DB capacity). **Do not change the code default** — that needs a deployment decision.

### Phase 0b — non-code (do separately, no patch)

- **T5** — GitHub → Settings → Environments → `production`: add required reviewers.

### Phase 1 — DB indexes (~1–2 days)

Add `index()` for FK columns across the schema files, time-series indexes
(`productionRunReadings.timestamp`, `soilTemperatureMeasurements.measurement_date`),
and the composite `transportLegs (entity_type, entity_id)`. One migration via
`pnpm db:generate`. Pre-launch tables are small — plain `CREATE INDEX`.

### Phase 2 — observability + migration safety (~2–3 days, keep it lean)

A small structured logger (`src/lib/logger.ts`); route errors through it. Error
tracking (Sentry) when wanted — not mandatory day one. Because `withAction()`
covers only 9/33 files, instrument both `withAction()` and the manual `catch`
blocks (21 files). Migration safety: review the generated `.sql` in the PR (no
drizzle `diff` exists), keep the existing `db:verify-schema` step, write a
one-paragraph rollback note.

### Phase 3 — read-path hygiene + correctness (~2–3 days)

**T2** `creditBatches` integrity — prefer **deriving** the aggregates instead of
storing them (eliminates drift by construction); else recompute-on-write. · **H2**
full document pagination (data-access + action + hook key + UI). · **H5** explicit
column selection on wide-table queries. · **M2** central `query-config.ts`. ·
**M1** narrow invalidation (with tests). · **H6** `revalidatePath` on key
mutations. · M6/M7/M8/M9 as scoped.

### Phase 4 — file-size remediation (~3–5 days)

Split `entities.ts`, `production-runs.ts`, the oversized forms.
Behaviour-preserving; characterization tests first. Flip the lint rule to `error`.

### Phase 5 — CRUD de-duplication (optional)

A *lean* factory (`createEntityCrudHooks()` + an action factory on `withAction()`)
that **deletes** duplication — not a framework. Only worth doing if the entity set
keeps growing; otherwise the lint rule + Phase 4 are enough. Don't overengineer.

---

## Open decisions

- `DB_POOL_MAX` per environment, tied to the deployment model (T3).
- `creditBatches` integrity: derive vs recompute-on-write (T2).
- Whether Phase 5 is worth doing — only if entities keep multiplying.

## Verification

- **Phase 0:** `grep -rn "args.email\|email=" src/lib/auth` finds no occurrence inside a `console.*` statement; `pnpm lint` and typecheck green; document list capped via `MAX_DOCUMENTS_PER_ENTITY`.
- **Phase 1:** `EXPLAIN ANALYZE` shows `Index Scan` on the previously sequentially-scanned queries.
- **Phases 2–5:** typecheck + `pnpm test:e2e` green; no behaviour diff.
