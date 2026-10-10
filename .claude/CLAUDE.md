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

Domain language lives in **`GLOSSARY.md`** (repo root) — a pure glossary (Removal, Credit batch, Roll-up, Evidence method, …). Its definitions **override casual usage**; consult it before naming things or writing requirements/docs.

## Database Commands

- `pnpm db:reset` is **DESTRUCTIVE**: drops the `public` and `drizzle` schemas, runs the **migration chain**, ensures the admin user. It does not seed — `pnpm db:seed` is separate.
- `pnpm db:push` pushes the schema directly — review first.

## Architecture

Never skip layers: UI → `hooks/` → `fn/` → `data-access/` → `db/`, plus the read paths in `docs/architecture.md`. Server Actions in `fn/` carry `"use server"`, validate input with Zod and return `ActionResult<T>`; non-action helpers in `fn/` (e.g. `with-action.ts`) deliberately omit the directive. Normal `data-access/` functions enforce org scope; keep explicit `// org-scope-ok:` seams.

## Git & Branch Guardrails

- Branch `<type>/<kebab-desc>`; commit/PR title `<type>: <imperative, lowercase verb>` (PR title < 70 chars). Types: `feat` · `fix` · `refactor` · `chore` · `docs` · `test`.
- **Confirm the target branch before every commit** (`git branch --show-current`) — misplaced commits are a recurring failure mode.
- Run git/gh operations as **discrete steps**, not chained `&&` one-liners.
- Default PR base is `staging`; `staging` → `main` promotions are their own explicit step.
- **One writer per worktree.** Cut new work with `scripts/worktree.sh new <name> <branch>` (own DBs, port, env) and remove it with `scripts/worktree.sh teardown <name>`; never branch in the main checkout. This includes worktrees that skills create for subagents (e.g. `implement-spec`). See `docs/testing.md#worktrees`. Use the server command `new` prints; `pnpm dev` binds port 3100.

## Review Remediation (CodeRabbit / Claude review / audits)

For every finding: **verify it against the actual code first**, fix only valid ones with minimal changes, skip invalid ones with a one-line written reason (false positives are common, including bogus P0s). Validate with `pnpm lint` + `pnpm typecheck` + tests before committing. Never blanket-apply a findings list.

## Model Selection

Shared across all projects in `~/.claude/model-selection.md` (imported by the global `~/.claude/CLAUDE.md`; source: `shared-agent-skills/policies/model-selection.md`). Change it with the `update-model-policy` skill, not here.

**Project override (Kenji's request, 2026-10-07): implementation in this repo goes to Codex, not Claude agents.**

- **gpt-6-astra** (`medium`) implements the hard parts: org scoping, auth and tenancy, schema changes and migrations, the Chain-of-Custody DAG, energy/emissions accounting, the Isometric Certify integration, and anything that changes credit quantities.
- **gpt-6.1-sol** (`high`) implements routine work (CRUD wiring that follows `TEMPLATE_USAGE.md`, forms, UI pages, copy, tests) and cross-checks every astra diff with `codex-review`. Astra reviews sol's larger diffs in turn, and any sol diff that touches `data-access/` or auth, so each change gets the other model's eyes.
- Claude scopes each task, writes the self-contained prompt, inspects the diff, runs `pnpm lint`, `pnpm typecheck` and the relevant tests, and commits. Follow the `codex-implementation` skill (its repo constraints are this repo's); for astra runs swap in `-m gpt-6-astra -c 'model_reasoning_effort="medium"'`. Run Codex in the task's worktree (`scripts/worktree.sh new`), never the main checkout. Run `codex exec … < /dev/null` when backgrounded, or it hangs on "Reading additional input from stdin".

## Docs Index — read the target BEFORE doing the work (docs are NOT auto-indexed)

- **Pre-production database policy:** no production database exists yet. Do not spend effort preserving or migrating production data, maintaining backward-compatible transitional schemas, or writing production backfills. Keep the migration chain usable for development and tests; reset local databases when needed, and tell the user before a schema change requires resetting the shared staging database.
- Before ANY **form/schema** work → `docs/forms.md` — `@/schemas/helpers` numeric helpers, Zod 4 string formats, never `valueAsNumber`.
- Before **Isometric/certification/requirements** work → `docs/isometric/README.md` + `docs/isometric/versions.json`, and call the isometric MCP `how_to` first. Local summaries are **non-authoritative** — verify against the registry.
- Before **UI** work → `docs/design-system.md` — Canonical Page Shell, `EmptyState` (never bare text), a11y, and the token trap: default Tailwind spacing/radius classes are **deleted**, not remapped (`p-4` = 4px, `rounded-md` = nothing).
- Before **writing or changing user-facing copy or generated operator content** → `docs/ux-writing.md` — shared terminology, message structure, surface-specific guidance, and the ban on en/em dashes.
- Before **writing code** → `docs/code-style.md` — naming/file conventions, the org-scoping seam + waiver syntax, React Compiler rules (no manual memo, avoid `useEffect`), local gates.
- Before **any test** work → `docs/testing.md` — fixtures, `.env.test`, E2E naming prefixes, `db:reset` on dup keys.
- Before **writing a server action or data-access query** → `docs/architecture.md` — `withAction()`, `OrgContext`, `ActionResult` (+ `conflict`), React Query key factories, facility context, CI/CD.
- Before **env / secrets / tenancy** work → `docs/security.md` — env inventory is `envSchema`, fail-closed prod gates, 1Password items differ.
- **Auth guards, route protection, org context** → `docs/auth.md` — owns the guard vocabulary (redirect-vs-throw, `requireOrgScope` vs `requireAuth`).
- **Database** (org-scoping contract, migrations, numeric families, row-level guards) → `docs/database.md`; **table-by-table map** → `docs/schema-overview.md`.
- **Where a new file goes** (flat feature folders, global-vs-feature, docs hygiene) → `docs/organization.md`.
- **Traceability** (DAG | Map | Sankey, Trail; credit-batch anchored) → `docs/traceability.md`.
- **File uploads / object storage** → `docs/storage.md`.
- **Marketing site** (`site/`) → `docs/site.md`.
- **Auth email not arriving** (Resend both-or-neither, local fallback) → `docs/mail-setup.md`.
- **Stuck on a known gotcha** → `docs/troubleshooting.md`.
- **Library version drift vs training data** (Drizzle callback, Zod 4, async `params`; Cache Components are NOT enabled) → `docs/modern-patterns.md`.
- **Adding a feature (checklist + reference entity)** → `TEMPLATE_USAGE.md`.
- **Why Greptile reviews what it does** (logic-only scope, rule set, CodeRabbit split) → `docs/greptile-review-strategy.md`; config lives in `.greptile/`.
- **Deferred work / open decisions** → `docs/open-questions.md`; **architecture decisions** → `docs/adr/`.
- **Skills that name `CODING_STANDARDS.md`** (e.g. `retro`): judgement rules go in `docs/code-style.md`, reviewer-enforced rules in `.greptile/rules.md`. This repo has no `CODING_STANDARDS.md`.
