# CLAUDE.md — noma-dmrv

Guidance for Claude Code. **These instructions OVERRIDE default behavior — follow them exactly.**

## DO NOT — Critical Rules

- ❌ **NEVER use npm or yarn** — always `pnpm`
- ❌ **NEVER skip auth guards** — every data-access function checks permissions
- ❌ **NEVER let a file exceed 1000 lines** — split into modular files
- ❌ **NEVER hard-code magic numbers** — constants at top of file or in `@/config`
- ❌ **NEVER commit `.env` files, secrets, API keys, or credentials** — not even in docs or tests
- ❌ **NEVER log PII (emails, names)** — log IDs (`userId`, `removalId`) instead; the server logger redacts as a backstop, not a license
- ❌ **NEVER create messy docs** — follow Documentation Standards below

## Project Overview

**noma-dmrv** is a biochar carbon-credit MRV (Monitoring, Reporting, Verification) system on a Next.js 16 App Router stack: Better Auth, PostgreSQL + Drizzle ORM (60+ tables across 19 schema files), 16 core biochar-entity CRUD workflows, a Chain-of-Custody DAG, plus energy/emissions accounting and an **Isometric Certify** registry integration.

Traceability chain: Facility → Reactor → Feedstock Delivery → Feedstock → Production Run → Sample → Biochar Product → Order → Delivery → Application → Credit Batch.

## Essential Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server (port 3100) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate migrations from schema changes (SAFE) |
| `pnpm db:push` | Push schema directly (review first) |
| `pnpm db:reset` | Drop all tables, push, ensure admin user (DESTRUCTIVE) |
| `pnpm db:studio` | Drizzle Studio (SAFE) |
| `pnpm test:e2e` | Playwright E2E (requires dev server running) |

## Architecture

### Layered flow — each layer imports only from the layer below

```text
Component (UI)
  ↓ hooks/        React Query — client state
  ↓ fn/           Server actions — "use server", Zod validation, orchestration
  ↓ data-access/  DB queries + auth guards
  ↓ db/           Connection & schema
```

Rules: never skip layers · `fn/` always has `"use server"` and validates input with Zod · every `data-access/` function calls an auth guard.

### Project structure

```text
src/
├── app/                # App Router
│   ├── (auth)/         # Auth routes
│   ├── (app)/          # Protected routes: facilities, production-runs,
│   │                   #   credit-batches, certification, energy, dashboard,
│   │                   #   chain-of-custody, customers, suppliers, … + [projectId]/
│   ├── admin/          # Admin panel
│   └── api/            # API routes (incl. /api/storage-local, /api/documents)
├── components/         # Per-entity component folders
├── config/             # env.ts (Zod-validated), constants
├── data-access/        # DB queries + auth guards
├── db/                 # Connection & 19 domain schema files
├── fn/                 # Server actions
├── hooks/              # React Query hooks
├── lib/                # format/form/date utils, calculations/, log/, storage/,
│                       #   isometric/, rate-limit/, errors.ts
├── schemas/            # Zod form + action schemas
└── types/
tests/e2e/              # Playwright (fixtures/ + *.spec.ts)
```

## Key Patterns

### ActionResult — every server function returns this

```typescript
type ActionResult<T> = { success: true; data: T } | { success: false; error: string };
```

### Auth guards — never skip

```typescript
export async function createItem(userId: string, data: CreateItem) {
  await requireAuth();          // or requireProjectMember()
  // safe to proceed
}
```

### Facility context — pages in `(app)` are facility-scoped

```typescript
const { facilityId, selectedFacility, setFacilityId } = useFacilityContext();
```
Persisted via `?facility=<id>` (nuqs `useQueryState`) + localStorage. `FacilityProvider` wraps the layout; `FacilitySelector` lives in the sidebar. **Forms receive `facilityId` from context — never ask users to pick a facility in a form.**

### React Query

- Query keys: `["resource", projectId, ...specifics]`; invalidate related queries after mutations
- Stale time: 30s current data, 5m historical
- **Always check `src/hooks/` first** — every entity has a hook file (`use-facilities.ts`, …). Never write an inline `useQuery` when a hook already covers the server action (duplicates keys, risks staleTime drift).

### Quick-Add — inline creation of prerequisite entities

- Schemas in `src/schemas/quick-add.ts` (minimal required fields)
- After create, call `seedEntityCache()` from `@/components/forms/entity-select/cache-utils` to populate the dropdown
- `useOpenCreateIntent()` opens create dialogs from `?create=true` deep links

### Cascading / Dependent Selects

`FormEntitySelect` auto-clears when parent values change via `dependsOn` (single value or array):
```typescript
<FormEntitySelect filterBy={{ feedstockTypeId, facilityId }} dependsOn={[feedstockTypeId, facilityId]} />
```
Underlying `useClearOnDependencyChange` is standalone. See `docs/forms.md`.

### Structured Logging — `@/lib/log` (server-only)

```typescript
import { logger } from "@/lib/log";
logger.info({ userId, removalId }, "submission accepted");
const log = logger.child({ requestId });   // bindings merged into every record
```
- **Server-only by contract** — import only from `fn/`, `data-access/`, and the isometric client boundary. Never from a client component.
- Emits newline-delimited JSON; level via `LOG_LEVEL`. Redacts `email`/`token`/`secret`/`authorization`-type keys at any depth — but still pass IDs, not PII.
- In-house (~50 lines) instead of pino due to a Turbopack/Vercel runtime bug; see the file header.

### Object Storage — `@/lib/storage`

File uploads (lab reports, COAs, photos, calibration certs, production readings CSVs) use **real S3-compatible storage** with a presigned PUT/GET flow.
- `STORAGE_PROVIDER=s3-compatible` (prod — DO Spaces / AWS S3) or `local-fs` (dev/test, served by `/api/storage-local/[...key]`)
- Production rejects `local-fs` at env-validation time. Use `<FormFileUpload>` (`@/components/forms/form-file-upload`) for upload UI. See `docs/storage.md`.

## Forms (React Hook Form + Zod)

Schemas in `src/schemas/`. Use `FormField`, `FormInput`, `FormTextarea`, `ServerError` (server errors via `setError('root.serverError', …)`), `<SectionLabel>`, `<FormFileUpload>`. Client validation runs before server calls.

**Numeric / special-field helpers from `@/schemas/helpers` (never write inline preprocess lambdas):**
- `toNumberOrUndefined` → `undefined` for **required** numbers; give a Zod 4 message: `z.number({ error: (iss) => iss.input === undefined ? "Required" : "Invalid number" })`
- `toNumberOrNull` → `null` for **optional** numbers; also `optionalNumber`, `optionalPercent`, `toIntOrNull`
- **Never** `valueAsNumber: true` (turns `""` into `NaN`, breaks Zod)
- Optional UUID (EntitySelect): `emptyToNull.or(z.string().uuid())`
- GPS: `latitudeSchema`/`longitudeSchema` (optional), `requiredLatitudeSchema`/`requiredLongitudeSchema` + `toNumberOrUndefined` (required)

See `docs/forms.md` and `docs/troubleshooting.md`.

## Code Quality

### Naming & files
- All files **kebab-case** (`item-form.tsx`, `use-items.ts`)
- Component exports **PascalCase**; hook/function exports **camelCase**
- 1000-line hard cap; barrel `index.ts` exports
- Simple feature (<500 lines, <3 components) → flat folder; complex → `components/`, `dialogs/`, `hooks/` subfolders
- UI primitives live under lowercase `@/components/ui/*` (e.g. `@/components/ui/button` exports `Button` + `buttonVariants`)

### Style
- TypeScript strict — avoid `any`; prefer `z.infer<typeof schema>` over hand-written types
- Magic numbers → constants; use design-system tokens (`docs/design-system.md`), never hardcoded values
- For JSONB columns keep create/update defaults identical (match the schema's `.default()`)

### React (this project uses the React Compiler)
- Auto-memoizes components/values/callbacks — **don't add `useMemo`/`useCallback`/`React.memo`** unless profiling demands it
- **Avoid `useEffect`** — prefer React Query, server actions, derived state. `useEffect` only for external-system sync, subscriptions, or imperative DOM.

### Accessibility
- 44×44px touch targets · 4.5:1 contrast · full keyboard nav · ARIA labels where visual context is insufficient

## Adding a Feature — checklist

1. **Zod schemas** (`src/schemas/`) — form + action schemas, `export type X = z.infer<…>`; share a base schema between form/update variants; use `@/schemas/helpers`
2. **DB schema** (`src/db/schema/`) — define table, export types, add to `schema/index.ts`, `pnpm db:generate`
3. **Data access** (`src/data-access/`) — CRUD + `requireAuth()` / `requireProjectMember()`
4. **Server actions** (`src/fn/`) — `"use server"`, validate with Zod, return `ActionResult<T>`
5. **Hooks** (`src/hooks/`) — query + mutation hooks with invalidation
6. **Components** (`src/components/your-feature/`) — RHF forms, design tokens, barrel export
7. **Route** — biochar entities use flat routes (`/facilities`); project-scoped use `/[projectId]/…`; async params (Next.js 16)
8. **E2E** (`tests/e2e/your-feature.spec.ts`) — `adminPage` + `seededData` fixtures

See `TEMPLATE_USAGE.md`. Reference entity pattern = **facilities** (schemas / data-access / fn / hooks / components / route / spec).

## Chain of Custody

Application-first lineage graph tracing the upstream rollback from a selected application to feedstock batches. 7 node types (Feedstock, Reactor, Production Run, Biochar Product, Order, Delivery, Application); color groups Production (orange) / Infrastructure (purple) / Distribution (rose); Dagre LR layout, minimap, zoom. Standard layered pattern (`data-access/chain-of-custody.ts` → `fn/` → `hooks/` → `components/chain-of-custody/`). Docs: `docs/chain-of-custody.md`.

## Production Run Extensions

Child entities on the run detail page: **Readings** (time-series telemetry), **Samples** (in-process measurements + file upload), **Incidents** (exceptions with severity + corrective actions). See `src/components/production-run-readings/` and `src/components/production-runs/`.

## Isometric Certify Integration

Submits removals / GHG statements / sensor data to the Isometric registry via `src/lib/isometric/` (client, submissions, ghg-statements, sensors, sources, links). Server-side only, instrumented with the structured logger. UI in `src/components/certification/`.

**Always consult before requirements/integration work:**
- `docs/isometric/README.md` — scope, file index, usage
- `docs/isometric/versions.json` — single source of pinned protocol/module versions
- `requirements-shortlist.md`, `schema-mapping.md`, `p0-compliance-checklist.md`, `simple-implementation-guide.md`, `condition-registry.md` (conditional-field triggers), `update-playbook.md`
- `integration-plan.md`, `openapi-index.md`, `changes.md` (append-only changelog)
- Decisions: `docs/adr/0001`–`0008`. Deferred work / sandbox checks: `docs/open-questions.md`.

All local summaries are **non-authoritative interpretations** — verify against linked Isometric Registry URLs before implementing logic or making credit claims. There's an `isometric` MCP server (call its `how_to` tool first) for authoritative protocol content.

## Authentication

- Admin-invite only by default (`ALLOW_SELF_SIGNUP=false`); admin set by `ADMIN_EMAIL`
- Email invitations + password resets via Resend; Better Auth session cookies (`nextCookies` plugin)
- Middleware uses `getSessionCookie()` (`src/middleware.ts`). See `docs/auth.md`.

## Environment Variables

All validated via Zod in `src/config/env.ts` (`superRefine` enforces cross-field rules). **Document NAMES only, never values.**

- **Core:** `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_SECRET` (32+ chars), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ALLOW_SELF_SIGNUP`, `NODE_ENV`
- **Logging / DB pool:** `LOG_LEVEL`, `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`
- **Storage:** `STORAGE_PROVIDER` (`s3-compatible` required in prod), `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_SIGNING_SECRET`, `STORAGE_LOCAL_FS_ROOT`
- **Isometric:** `ISOMETRIC_ACCESS_TOKEN` + `ISOMETRIC_CLIENT_SECRET` (both-or-neither), `ISOMETRIC_ENVIRONMENT`, `ISOMETRIC_UPLOAD_HOST_ALLOWLIST`
- **Geo / maps (all optional — graceful degradation):** `OPENROUTESERVICE_API_KEY` (server-only geocode/routing), `NEXT_PUBLIC_MAPTILER_KEY` (public, domain-locked basemap key), `GEO_PROVIDER` (`ors` default; `stub` = hermetic test fixtures, rejected in prod)

**Sourcing** — values live in 1Password (vault `Environment Variables`, one item per env: `local`/`staging`/`production`). Local: `pnpm env:local` (`.env.local.tpl` → `.env.local`). Deployed: `.env.tpl` (staging/production refs) feeds `pnpm env:vercel` only. Both syncs **skip optional vars missing from the item** (warning, not error) and fail only on `REQUIRED_LOCAL_VARS`/`REQUIRED_DEPLOYED_VARS` (`scripts/env-tpl-utils.ts`). CI: `1password/load-secrets-action` via the `OP_SERVICE_ACCOUNT_TOKEN` repo secret. Drift: `pnpm env:check`. See `docs/security.md` → Secrets Management.

## Security

- Never put real keys in code, comments, or docs — use `<REDACTED_API_KEY>`. If a key leaks: rotate immediately, then scrub history with `git-filter-repo` (see `docs/security.md`).
- Log `userId`, never `email`. Review PR diffs for accidental secret exposure.
- Supply chain: 3-day `minimumReleaseAge` cooldown + `allowBuilds` script gating (`pnpm-workspace.yaml`), security-only Dependabot. See `docs/security.md` → Dependency Supply Chain.

## Documentation Standards

Keep `/docs` clean — only **evergreen** docs (product/architecture/design-system/database/auth/troubleshooting) live there. Move implementation logs, quick fixes, dated debugging, and superseded docs to `/docs/archive`. Before creating a doc: is it evergreen? does it duplicate an existing doc? (update instead). **Deferred work** → dated entry in `docs/open-questions.md`, not a code `TODO`; resolve by removing it and recording the decision in the feature doc (e.g. `docs/isometric/changes.md`).

## Git Conventions

Branch `<type>/<kebab-desc>`; commit/PR title `<type>: <imperative, lowercase verb>` (PR title < 70 chars). Types: `feat` · `fix` · `refactor` · `chore` · `docs` · `test`. Multi-line commits: blank line then a body explaining **why**, not what.

## E2E Testing

Playwright per-entity specs + full-chain smoke tests. Fixtures (`tests/e2e/fixtures/auth-fixtures.ts`): `adminPage`, `seededData`, `cleanupTestData`. Seed (`seed-chain-data.ts`) creates 13 prerequisite entities; `full-chain-ui.spec.ts` builds all 8 core entities in one session. **Auth uses the HTTP API** (`createDirectAuthContext`), not UI login — requires `DISABLE_RATE_LIMIT=true` in `.env.local` and an `Origin` header on sign-in. Run `pnpm db:reset` first if you hit duplicate-key errors.

## Key Docs Index

`docs/architecture.md` · `docs/modern-patterns.md` (Next.js 16 caching) · `docs/organization.md` · `docs/design-system.md` · `docs/database.md` · `docs/auth.md` · `docs/forms.md` · `docs/storage.md` · `docs/security.md` · `docs/chain-of-custody.md` · `docs/schema-overview.md` (60+ tables) · `docs/isometric/README.md` · `docs/open-questions.md` · `docs/troubleshooting.md` · `docs/adr/` · `TEMPLATE_USAGE.md`

## CI/CD

`migrate.yml` (auto-migrate on schema push to `main`/`staging`; manual reset/seed via `workflow_dispatch`) · `claude.yml` (AI PR review) · `e2e.yml` (Playwright) · `isometric-health.yml` (daily read-only Isometric sandbox ping) · `.coderabbit.yaml` (auto-review on `main`/`staging`).

CI secrets come from 1Password via `1password/load-secrets-action` + the `OP_SERVICE_ACCOUNT_TOKEN` repo secret (only `CLAUDE_CODE_OAUTH_TOKEN` remains a plain Actions secret). See `docs/security.md` → Secrets Management.
