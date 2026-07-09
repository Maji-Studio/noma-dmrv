# CLAUDE.md — noma-dmrv

Guidance for Claude Code. **These instructions OVERRIDE default behavior — follow them exactly.**

## DO NOT — Critical Rules

- ❌ **NEVER use npm or yarn** — always `pnpm`.
- ❌ **NEVER skip auth guards** — every `data-access/` function calls `requireAuth()` (`src/data-access/utils.ts`).
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

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server (port 3100) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate migrations from schema changes (SAFE) |
| `pnpm db:push` | Push schema directly (review first) |
| `pnpm db:reset` | Drop all tables, push, ensure admin user (DESTRUCTIVE) |
| `pnpm db:studio` | Drizzle Studio (SAFE) |
| `pnpm test:e2e` | Playwright E2E (starts or reuses the app server) |

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

Rankings below are **higher = better**. Cost reflects what I actually pay (gpt-5.5 is flat-rate via the Codex desktop subscription, not list price). Intelligence = how hard a problem you can hand the model unsupervised. Taste = UI/UX, code quality, API design, copy.

| model | cost | intelligence | taste |
|---|---|---|---|
| gpt-5.5 | 9 | 8 | 5 |
| sonnet-5 | 5 | 5 | 7 |
| opus-4.8 | 4 | 7 | 8 |
| fable-5 | 2 | 9 | 9 |

**How to apply** — these are defaults, not limits: you have standing permission to escalate if a cheaper model's output doesn't meet the bar. Judge the output, not the price tag; use cheap options to gather information before moving work to expensive ones.
- Bulk/mechanical (clear-spec implementation, data analysis, migrations) → **gpt-5.5**.
- User-facing (UI, copy, API design) needs **taste ≥ 7**.
- Reviews of plans/implementations → **fable-5 or opus-4.8**, optionally gpt-5.5 as an extra independent perspective.
- **Never use Haiku.** Subagents/Workflow agents run on **sonnet or opus — never inherit Fable**. Batch items to keep agent counts low.

**Mechanics** — gpt-5.5 is only reachable through the Codex CLI (`codex exec` / `codex review`; `~/.codex/config.toml` defaults to gpt-5.5 xhigh; binary may be at `/Applications/Codex.app/Contents/Resources/codex`). Use the **codex-implementation**, **codex-review**, **codex-computer-use** skills; for uncovered work (investigation, data analysis) run `codex exec -s read-only` directly with a self-contained prompt. Claude models run via the Agent/Workflow `model` parameter.

**gpt-5.5 inside workflows/subagents** — the `model` param only takes Claude models, so wrap: spawn a thin Claude wrapper agent (`model: 'sonnet'`, effort `low`) whose prompt writes a self-contained codex prompt, runs `codex exec` via Bash, and returns the report (use `schema` on the wrapper for structured output). **Always label the wrapper with a `gpt-5.5:` prefix** (e.g. `{label: 'gpt-5.5:review-auth'}`) — the UI shows the wrapper's Claude model, the label is the only signal of the real worker. Codex runs can exceed Bash's 10-min timeout: pass an explicit timeout or background+poll. Parallel gpt-5.5 implementation agents must use `isolation: 'worktree'`. Workflow token budgets only count Claude tokens — codex work is invisible to `budget.spent()`.

## Docs Index — read the target BEFORE doing the work (docs are NOT auto-indexed)

- Before ANY **form/schema** work → `docs/forms.md` — `@/schemas/helpers` numeric helpers, Zod 4 string formats, never `valueAsNumber`.
- Before **Isometric/certification/requirements** work → `docs/isometric/README.md` + `versions.json`, and call the isometric MCP `how_to` first. Local summaries are **non-authoritative** — verify against the registry.
- Before **UI** work → `docs/design-system.md` — Canonical Page Shell, design tokens, `EmptyState` (never bare text).
- Before **writing code** → `docs/code-style.md` — naming/file conventions, React Compiler rules (no manual memo, avoid `useEffect`), a11y.
- Before **E2E** work → `docs/testing.md` — fixtures, HTTP-API auth, `DISABLE_RATE_LIMIT`, `.env.test`, `db:reset` on dup keys.
- Before **env/auth debugging** → `docs/security.md` — env inventory, 1Password items differ, secrets management.
- **Architecture / patterns** (ActionResult, facility context, React Query, quick-add, cascading selects, logging, CI/CD) → `docs/architecture.md`.
- **Database** → `docs/database.md` + `docs/schema-overview.md` (60+ tables).
- **Chain of Custody** (DAG | Map | Sankey, Trail) → `docs/chain-of-custody.md`.
- **File uploads / object storage** → `docs/storage.md`.
- **Auth flow / route protection** → `docs/auth.md`.
- **Stuck on a known gotcha** → `docs/troubleshooting.md`.
- **Next.js 16 caching / patterns** → `docs/modern-patterns.md`.
- **Adding a feature (checklist + reference entity)** → `TEMPLATE_USAGE.md`.
- **Deferred work / open decisions** → `docs/open-questions.md`; **architecture decisions** → `docs/adr/`.
