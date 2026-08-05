# CLAUDE.md — noma-dmrv

Guidance for Claude Code. **These instructions OVERRIDE default behavior — follow them exactly.**

## DO NOT — Critical Rules

- ❌ **NEVER use npm or yarn** — always `pnpm`.
- ❌ **NEVER skip org scoping without an explicit waiver** — every normal `data-access/` function takes `ctx: OrgContext` first, calls `requireOrgScope(ctx)` (`src/data-access/utils.ts`), and filters on `organizationId`. Filtering only on `facilityId` is a cross-tenant leak. Deliberate public or privileged seams use `// org-scope-ok:`; do not "fix" them. (`requireAuth` is a *route* guard in `src/lib/auth/server.ts` — not this layer.)
- ❌ **NEVER let a file exceed 1000 lines** — split into modular files.
- ❌ **NEVER hard-code magic numbers** — constants at top of file or in `@/config`; use design tokens, never hardcoded values.
- ❌ **NEVER commit `.env` files, secrets, API keys, or credentials** — not even in docs or tests.
- ❌ **NEVER log PII (emails, names)** — log IDs (`userId`, `removalId`); the server logger redacts as a backstop, not a license.
- ❌ **NEVER commit to `staging` or `main` directly, and never modify `staging` during branch work** — feature branch + PR only; verify `git branch --show-current` before every commit.
- ❌ **NEVER assume local env matches staging/production** — the three 1Password items intentionally differ (`docs/security.md`).
- ❌ **NEVER create messy docs** — only evergreen docs in `/docs` (dated plans → `docs/plans/`, historical notes → `docs/archive/`); deferred work → `docs/open-questions.md`, not code TODOs.

## Project Overview

**noma-dmrv** is a biochar carbon-credit MRV (Monitoring, Reporting, Verification) system: Next.js 16 App Router, Better Auth, PostgreSQL + Drizzle (60+ tables), 16 core biochar-entity CRUD workflows, a Chain-of-Custody DAG, energy/emissions accounting, and an **Isometric Certify** registry integration.

Traceability chain: Facility → Reactor → Feedstock Delivery → Feedstock → Production Run → Biochar Product → Order → Delivery → Application → Credit Batch → Sample.

Domain language lives in **`CONTEXT.md`** (repo root) — a pure glossary (Removal, Credit batch, Roll-up, Evidence method, …). Its definitions **override casual usage**; consult it before naming things or writing requirements/docs.

## Essential Commands

| Command                     | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `pnpm dev`                  | Dev server (port 3100)                                 |
| `pnpm build` / `pnpm start` | Production build / serve                               |
| `pnpm lint`                 | ESLint                                                 |
| `pnpm db:generate`          | Generate migrations from schema changes (SAFE)         |
| `pnpm db:push`              | Push schema directly (review first)                    |
| `pnpm db:reset`             | Drop all tables, run the **migration chain**, ensure admin user (DESTRUCTIVE; does not seed — `pnpm db:seed` is separate) |
| `pnpm db:studio`            | Drizzle Studio (SAFE)                                  |
| `pnpm test:e2e`             | Playwright E2E (starts or reuses the app server)       |

## Architecture — each layer imports only from the layer below

```text
Component (UI)
  ↓ hooks/        React Query — client state
  ↓ fn/           Server actions — "use server", Zod validation, orchestration
  ↓ data-access/  DB queries + auth guards
  ↓ db/           Connection & schema
```

Never skip layers · `fn/` always has `"use server"` and validates input with Zod · every `data-access/` function calls an auth guard · server functions return `ActionResult<T>`. See `docs/architecture.md`.

## Git & Branch Guardrails

- Branch `<type>/<kebab-desc>`; commit/PR title `<type>: <imperative, lowercase verb>` (PR title < 70 chars). Types: `feat` · `fix` · `refactor` · `chore` · `docs` · `test`.
- **Confirm the target branch before every commit** (`git branch --show-current`) — misplaced commits are a recurring failure mode.
- Run git/gh operations as **discrete steps**, not chained `&&` one-liners.
- Default PR base is `staging`; `staging` → `main` promotions are their own explicit step.

## Review Remediation (CodeRabbit / Claude review / audits)

For every finding: **verify it against the actual code first**, fix only valid ones with minimal changes, skip invalid ones with a one-line written reason (false positives are common, including bogus P0s). Validate with `pnpm lint` + `pnpm typecheck` + tests before committing. Never blanket-apply a findings list.

## Picking the Right Models for Workflows and Subagents

Rankings below are **higher = better**. Cost reflects what I actually pay (gpt-5.6-sol is flat-rate via the Codex desktop subscription, not list price). Intelligence = how hard a problem you can hand the model unsupervised. Taste = UI/UX, code quality, API design, copy.

| model       | cost | intelligence | taste |
| ----------- | ---- | ------------ | ----- |
| gpt-5.6-sol | 9    | 8            | 7     |
| sonnet-5    | 5    | 5            | 7     |
| opus-4.8    | 4    | 7            | 8     |
| fable-5     | 2    | 9            | 9     |

**How to apply** — these are defaults, not limits: you have standing permission to escalate if a cheaper model's output doesn't meet the bar. Judge the output, not the price tag; use cheap options to gather information before moving work to expensive ones.

- **Prefer gpt-5.6-sol over opus-4.8 most of the time** — it's quite powerful and effectively free; reach for opus-4.8 mainly when the work must run as a native Claude subagent/Workflow agent or when taste matters.
- Bulk/mechanical (clear-spec implementation, data analysis, migrations) → **gpt-5.6-sol**.
- User-facing (UI, copy, API design) needs **taste ≥ 7**. Utilize frontend-design skill
- Reviews of plans/implementations → **fable-5 or gpt-5.6-sol**, optionally opus-4.8 as an extra independent perspective.
- **Never use Haiku.** Subagents/Workflow agents run on **sonnet or opus — never inherit Fable**. Batch items to keep agent counts low.
- Don't use Fable for workflows, except its been asked. Use instead opus-4.8 or gpt-5.6-sol.

**Mechanics** — the Codex model (**gpt-5.6-sol high**; the flat-rate slot formerly called "gpt-5.5") is only reachable through the Codex CLI (`codex exec` / `codex review`; `~/.codex/config.toml` sets the default model + effort; binary at `~/Library/pnpm/bin/codex`, needs codex-cli ≥ 0.144 for gpt-5.6-sol; fallback `/Applications/ChatGPT.app/Contents/Resources/codex`). Use the **codex-implementation**, **codex-review**, **codex-computer-use** skills; for uncovered work (investigation, data analysis) run `codex exec -s read-only` directly with a self-contained prompt. Claude models run via the Agent/Workflow `model` parameter.

**gpt-5.6-sol inside workflows/subagents** — the `model` param only takes Claude models, so wrap: spawn a thin Claude wrapper agent (`model: 'sonnet'`, effort `low`) whose prompt writes a self-contained codex prompt, runs `codex exec` via Bash, and returns the report (use `schema` on the wrapper for structured output). **Always label the wrapper with a `gpt-5.6:` prefix** (e.g. `{label: 'gpt-5.6:review-auth'}`) — the UI shows the wrapper's Claude model, the label is the only signal of the real worker. Codex runs can exceed Bash's 10-min timeout: pass an explicit timeout or background+poll. Parallel gpt-5.6-sol implementation agents must use `isolation: 'worktree'`. Workflow token budgets only count Claude tokens — codex work is invisible to `budget.spent()`.

## Docs Index — read the target BEFORE doing the work (docs are NOT auto-indexed)

- **Pre-production database policy:** no production database exists yet. Do not spend effort preserving or migrating production data, maintaining backward-compatible transitional schemas, or writing production backfills. Keep the migration chain usable for development and tests; reset local databases when needed, and tell the user before a schema change requires resetting the shared staging database.
- Before ANY **form/schema** work → `docs/forms.md` — `@/schemas/helpers` numeric helpers, Zod 4 string formats, never `valueAsNumber`.
- Before **Isometric/certification/requirements** work → `docs/isometric/README.md` + `versions.json`, and call the isometric MCP `how_to` first. Local summaries are **non-authoritative** — verify against the registry.
- Before **UI** work → `docs/design-system.md` — Canonical Page Shell, `EmptyState` (never bare text), a11y, and the token trap: default Tailwind spacing/radius classes are **deleted**, not remapped (`p-4` = 4px, `rounded-md` = nothing).
- Before **writing or changing user-facing copy or generated operator content** → `docs/ux-writing.md` — shared terminology, message structure, surface-specific guidance, and the ban on en/em dashes.
- Before **writing code** → `docs/code-style.md` — naming/file conventions, the org-scoping seam + waiver syntax, React Compiler rules (no manual memo, avoid `useEffect`), local gates.
- Before **any test** work → `docs/testing.md` — two layers (Vitest in root `tests/` and colocated `src/**/*.test.{ts,tsx}` + Playwright E2E), fixtures, `.env.test`, E2E naming prefixes, `db:reset` on dup keys.
- Before **writing a server action or data-access query** → `docs/architecture.md` — `withAction()`, `OrgContext`, `ActionResult` (+ `conflict`), React Query key factories, facility context, CI/CD.
- Before **env / secrets / tenancy** work → `docs/security.md` — env inventory is `envSchema`, fail-closed prod gates, 1Password items differ.
- **Auth guards, route protection, org context** → `docs/auth.md` — owns the guard vocabulary (redirect-vs-throw, `requireOrgScope` vs `requireAuth`).
- **Database** (org-scoping contract, migrations, numeric families, row-level guards) → `docs/database.md`; **table-by-table map** → `docs/schema-overview.md`.
- **Where a new file goes** (flat feature folders, global-vs-feature, docs hygiene) → `docs/organization.md`.
- **Traceability** (DAG | Map | Sankey, Trail; credit-batch anchored) → `docs/traceability.md`.
- **File uploads / object storage** → `docs/storage.md`.
- **Auth email not arriving** (Resend both-or-neither, local fallback) → `docs/mail-setup.md`.
- **Stuck on a known gotcha** → `docs/troubleshooting.md`.
- **Library version drift vs training data** (Drizzle callback, Zod 4, async `params`; Cache Components are NOT enabled) → `docs/modern-patterns.md`.
- **Adding a feature (checklist + reference entity)** → `TEMPLATE_USAGE.md`.
- **Why Greptile reviews what it does** (logic-only scope, rule set, CodeRabbit split) → `docs/greptile-review-strategy.md`; config lives in `.greptile/`.
- **Deferred work / open decisions** → `docs/open-questions.md`; **architecture decisions** → `docs/adr/`.
