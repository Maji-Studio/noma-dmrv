# Plan: Codex delegation skills + CLAUDE.md full rewrite

**Date:** 2026-07-08 · **Status:** approved via grilling interview, ready to execute
**Branch:** create `chore/claude-md-overhaul-codex-skills` off `staging` · PR base `staging`

Inspiration: video setup (codex-review / codex-implementation / codex-computer-use skills +
a personal-preferences CLAUDE.md with a model-selection rubric). All screenshots were
transcribed during planning; this doc is self-contained — no images needed to execute.

---

## Ground facts (verified 2026-07-08, do not re-derive)

- Codex CLI **v0.142.5** is installed but **NOT on PATH**. Binary lives at
  `/Applications/Codex.app/Contents/Resources/codex` (bundled in the desktop app).
- `~/.codex/config.toml`: `model = "gpt-5.5"`, `model_reasoning_effort = "xhigh"`,
  this repo is `trusted`. Codex Computer Use companion app is installed.
- `/docs` pages have **no frontmatter and are NOT auto-indexed** by Claude Code. Only
  CLAUDE.md auto-loads per session → the docs index inside the new CLAUDE.md is the
  routing mechanism and every entry needs a "read before doing X" trigger line.
- Existing docs: architecture, auth, chain-of-custody, database, design-system, forms,
  mail-setup, modern-patterns, organization, schema-overview, security, storage,
  troubleshooting, open-questions + `docs/isometric/`. Current `.claude/CLAUDE.md` = 264 lines.
- Repo already has 26 skills in `.claude/skills/` (incl. `code-review`, `handoff`) and a
  plugin skill `agentsystem-core:handoff-codex` — new skill descriptions must disambiguate:
  the codex-* skills are for *delegating work to gpt-5.5*, not for Claude's own review flow.

## Decisions made (user-approved — do not re-litigate)

1. **Placement:** everything in-repo. Skills → `.claude/skills/codex-*/SKILL.md`,
   rubric → repo `.claude/CLAUDE.md`.
2. **Codex invocation:** every command block starts with
   `CODEX="$(command -v codex || echo "/Applications/Codex.app/Contents/Resources/codex")"` —
   PATH wins if present (future MacBook), bundle path as hardcoded fallback. Use `"$CODEX"`.
3. **CLAUDE.md:** FULL video-style rewrite, ~80–100 lines, minimal. Keep-list below.
4. **Model rubric:** adopt the video's numbers as-is (table below) + fold in standing
   directives: subagents/workflows run on sonnet/opus and never inherit Fable; never Haiku.
5. **New docs:** `docs/code-style.md` + `docs/testing.md`; CI/CD summary folds into
   `docs/architecture.md`. Everything else moves into existing pages. Zero information loss.
6. **codex-computer-use is the DEFAULT for all UI verification** (not claude-in-chrome).
   Chrome MCP is the fallback when codex fails/misbehaves.
7. **Credentials:** do NOT hardcode the dev admin login in the committed skill. The skill
   instructs Codex to source `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local` (same source
   the E2E fixtures use). User explicitly accepted this substitution for the literal
   dev-admin login (values live in 1Password / `.env.local` only) to honor the
   never-commit-credentials rule.
8. No OCR subagents needed (already done). Build files directly — no Workflow orchestration.

---

## Deliverable 1 — three skills in `.claude/skills/`

Shared boilerplate for all three:

```bash
CODEX="$(command -v codex || echo "/Applications/Codex.app/Contents/Resources/codex")"
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-<skillname>.XXXXXX")"
REPORT="$ARTIFACT_DIR/report.md"
PROMPT="$ARTIFACT_DIR/prompt.md"
# Write a self-contained prompt to $PROMPT, then run codex.
```

Shared rules baked into each SKILL.md:
- Codex runs can exceed Bash's 10-minute timeout: pass an explicit `timeout` to the Bash
  tool, or run in background and poll for the report file.
- If `codex` is not installed or the command fails, report the error and offer to do the
  work directly (computer-use additionally falls back to claude-in-chrome).
- Treat Codex output as evidence, not authority.

### 1a. `codex-review/SKILL.md`

Frontmatter description (adapt): "Ask Codex CLI (gpt-5.5) for an independent code review of
uncommitted changes, a branch diff, a commit, or a specific implementation. This is how
gpt-5.5 is invoked for review work. Use when the user asks for a Codex/gpt-5.5 review or
second opinion, or when the model-selection rubric calls for an extra independent review
perspective. For a review by Claude itself, use the normal review process instead."

Workflow:
1. Identify review target: uncommitted changes, base branch, commit SHA, PR checkout, or files.
2. Create artifact dir.
3. Run `codex review` with a focused review prompt:
   ```bash
   "$CODEX" -C "$PWD" review --uncommitted - < "$PROMPT" > "$REPORT"   # staged+unstaged+untracked
   "$CODEX" -C "$PWD" review --base staging - < "$PROMPT" > "$REPORT"  # branch vs base (this repo: staging)
   "$CODEX" -C "$PWD" review --commit <sha> - < "$PROMPT" > "$REPORT"  # single commit
   ```
4. Read the report and **verify important claims against the code before presenting them**
   (this is the repo's existing review-remediation rule: verify findings first, false
   positives are common). In the user-facing response, separate confirmed issues from
   unverified Codex suggestions.

Review prompt template (in a ```text block):
"Review these changes for bugs, regressions, missing tests, security issues, and requirement
mismatches. Prioritize findings over summary. For each finding include: severity, file and
line reference, concrete failure mode, suggested fix direction. Do not edit files. If there
are no substantive findings, say so and name any residual test gaps."
Add task-specific context when useful: requirements, risky areas, expected behavior, files
Claude is unsure about. If Codex finds nothing, say that clearly and name the review target.

### 1b. `codex-implementation/SKILL.md`

Frontmatter description (adapt): "Ask Codex CLI (gpt-5.5) to implement scoped code changes in
the current repository, then have Claude inspect the resulting diff and verification. This is
how gpt-5.5 is invoked for implementation work. Use when the user asks to delegate
implementation to Codex/gpt-5.5, when the model-selection rubric routes bulk/mechanical work
to gpt-5.5, or when a bounded task would benefit from another coding agent producing a patch."

Body opener: Claude remains responsible for scoping the task, reviewing the diff, running or
checking verification, and explaining the final result. Do not let Codex commit, push,
deploy, or edit global config.

Workflow:
1. Pin current state with `git status --short`; note any user changes already present.
2. Define scope: files/behavior to change, files to avoid, constraints, verification commands.
3. Create artifact dir.
4. Run with repo write access:
   ```bash
   "$CODEX" exec \
     -C "$PWD" \
     --add-dir "$ARTIFACT_DIR" \
     -s workspace-write \
     -o "$REPORT" \
     "$(cat "$PROMPT")"
   ```
   `-s workspace-write` by default; `-s danger-full-access` only when the task truly needs
   machine-level access (app launch, simulators, package-manager global state).
5. After Codex exits, inspect `git status` and `git diff`.
6. Run the cheapest reliable verification yourself: `pnpm lint`, `pnpm typecheck`, focused
   tests. (Never trust `cmd | tail` exit codes — pipefail gotcha.)
7. Report what Codex changed, what Claude verified, remaining risks.

Prompt requirements — tell Codex: exact goal + acceptance criteria; repo path + branch
context; which existing patterns/files/tests to inspect first; files/behavior that must NOT
change; preserve unrelated user changes; must not commit/push/deploy/edit global config;
which verification commands to run (or explain why skipped); write a concise final report
with files changed, verification, unresolved questions. Keep the task bounded — split
multi-part work into separate Codex runs or ask the user to choose the first scope.

**Repo-specific constraints to inject into every prompt** (this repo's guardrails):
- pnpm only, never npm/yarn.
- Respect the layered architecture (components → hooks → fn → data-access → db); `fn/` has
  `"use server"` + Zod; every data-access function calls an auth guard.
- Never read or edit `.env*` files; never log PII; kebab-case files; no file >1000 lines.
- Never touch `staging`/`main` or create commits.

Include an Example Prompt section (video pattern: Repository / Artifact directory / Goal /
Acceptance criteria / Constraints / Verification / Report format).

"Review After Codex" section: always inspect the diff before telling the user it's done;
revert only Codex-created mistakes when sure they're not user changes; if Codex leaves the
repo worse or touches unrelated files, stop and report with the diff summary.

### 1c. `codex-computer-use/SKILL.md`

Frontmatter description (adapt): "Ask Codex CLI (gpt-5.5) to run local app verification that
needs computer use: browser automation, screenshots, app launching, or independent runtime
inspection. This is the DEFAULT tool for verifying UI behavior in this project — use it to
test a flow, verify UI behavior, inspect the running app, capture screenshots, or confirm
implemented behavior. Fall back to the claude-in-chrome MCP tools if codex fails or the task
needs the user's own logged-in browser session."

Body: Do not use for ordinary code reading, typechecking, linting, or tests Claude can run
directly. Launching apps/browsers to verify requested work is fine without asking; ask first
only if the run could disrupt the user's environment (closing apps, changing system settings,
acting on real accounts/data).

Workflow:
1. Create artifact dir.
2. Write a self-contained prompt: repo path, exact flow to drive, constraints, artifact dir
   (for screenshots), report format.
3. Run non-interactively:
   ```bash
   "$CODEX" exec \
     -C "$PWD" \
     --add-dir "$ARTIFACT_DIR" \
     -s danger-full-access \
     -o "$REPORT" \
     "$(cat "$PROMPT")"
   ```
   `-s danger-full-access` for GUI automation/screenshots/outside-repo access; prefer
   `-s workspace-write` for non-GUI checks; add `--skip-git-repo-check` outside a git repo.
4. Read the report, inspect/reference screenshot paths, summarize for the user.

**Repo specifics to inject into the prompt:**
- Dev server: `http://localhost:3100` (assume running; if not, note it rather than starting a
  second instance).
- Sign-in: read `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env.local` in the repo root and use
  them on the login form. Never print these values in the report.
- Screenshots go into `$ARTIFACT_DIR`; report lists each screenshot path + what it shows.
- Report format: steps performed, what was observed vs expected, pass/fail per acceptance
  check, anything blocked or uncertain.

---

## Deliverable 2 — CLAUDE.md full rewrite (~80–100 lines)

Rewrite `.claude/CLAUDE.md` keeping ONLY (user-approved keep-list):
1. Compressed DO-NOT critical rules (pnpm-only; auth guards; 1000-line cap; no magic
   numbers; no secrets/PII; never commit to staging/main + verify branch before commit; env
   items differ; clean docs).
2. Two-line project overview + the traceability chain line + pointer to `CONTEXT.md` glossary.
3. Essential commands table (unchanged, it's already tight).
4. 5-line layered-architecture diagram + never-skip-layers + fn/data-access rules.
5. Git/branch guardrails (compressed: branch naming, commit style, discrete git steps,
   PR base staging).
6. "Verify review findings against code before fixing; skip invalid ones with a one-line
   reason" rule.
7. **NEW — "Picking the right models for workflows and subagents"** section:
   - Intro: rankings, higher = better. Cost reflects what I actually pay (gpt-5.5 is
     flat-rate via the Codex desktop subscription), not list price. Intelligence = how hard a
     problem you can hand the model unsupervised. Taste = UI/UX, code quality, API design, copy.
   - Table: `gpt-5.5 | 9 | 8 | 5` · `sonnet-5 | 5 | 5 | 7` · `opus-4.8 | 4 | 7 | 8` ·
     `fable-5 | 2 | 9 | 9`.
   - How to apply: defaults not limits — standing permission to escalate if a cheaper
     model's output doesn't meet the bar; judge the output, not the price tag; use cheap
     options to gather information before moving work to expensive ones. Bulk/mechanical
     (clear-spec implementation, data analysis, migrations) → gpt-5.5. User-facing
     (UI, copy, API design) needs taste ≥ 7. Reviews of plans/implementations → fable-5 or
     opus-4.8, optionally gpt-5.5 as extra independent perspective. **Never use Haiku.**
     Subagents/Workflow agents run on sonnet or opus — never inherit Fable (standing
     directive). Batch items to keep agent counts low.
   - Mechanics: gpt-5.5 is only reachable through the Codex CLI (`codex exec` /
     `codex review`; `~/.codex/config.toml` defaults to gpt-5.5 xhigh; binary may be at
     `/Applications/Codex.app/Contents/Resources/codex`). Use the codex-implementation,
     codex-review, codex-computer-use skills; for uncovered work (investigation, data
     analysis) run `codex exec -s read-only` directly with a self-contained prompt. Claude
     models run via the Agent/Workflow `model` parameter.
   - Using gpt-5.5 inside workflows/subagents (model param only takes Claude models → wrap):
     spawn a thin Claude wrapper agent `model: 'sonnet', effort: 'low'` whose prompt writes a
     self-contained codex prompt, runs `codex exec` via Bash, returns the report (use
     `schema` on the wrapper for structured output). Always label with a `gpt-5.5:` prefix
     (e.g. `{label: 'gpt-5.5:review-auth'}`) — the UI shows the wrapper's Claude model, the
     label is the only indication of the real worker. Codex runs can exceed Bash's 10-min
     timeout: pass explicit timeout or background+poll. Parallel gpt-5.5 implementation
     agents must use `isolation: 'worktree'`. Workflow token budgets only count Claude
     tokens; codex work is invisible to `budget.spent()`.
8. **Docs index with per-entry "read this before X" triggers** — the load-bearing router,
   since docs aren't auto-indexed. One line each, e.g.:
   - "Before ANY form/schema work → `docs/forms.md`" (numeric helpers, Zod 4, never
     valueAsNumber)
   - "Before Isometric/certification/requirements work → `docs/isometric/README.md` +
     `versions.json` + isometric MCP `how_to` first; local summaries are non-authoritative"
   - "Before UI work → `docs/design-system.md`" (canonical page shell, tokens, EmptyState)
   - "Before writing code → `docs/code-style.md`" (naming, React compiler rules, a11y)
   - "Before E2E work → `docs/testing.md`"
   - "Before env/auth debugging → `docs/security.md`" (env inventory, 1Password items differ)
   - plus architecture, database/schema-overview, chain-of-custody, storage, auth,
     troubleshooting, modern-patterns, `TEMPLATE_USAGE.md`, `docs/open-questions.md`
     (deferred work), `docs/adr/`.

## Deliverable 3 — /docs migration (zero information loss)

Move dropped CLAUDE.md content into docs. For each: check the target for existing coverage
first; merge, don't duplicate.

| Old CLAUDE.md section | Destination |
|---|---|
| Key Patterns (ActionResult, auth guards, facility context, React Query, quick-add, cascading selects) | `docs/architecture.md` (patterns section) — form-related bits also cross-check `docs/forms.md` |
| Structured logging (`@/lib/log`) | `docs/architecture.md` or `docs/security.md` (server-only contract, redaction) |
| Object storage summary | `docs/storage.md` (likely already covered — verify) |
| Forms section (helpers, valueAsNumber, GPS, quick-add schemas) | `docs/forms.md` (mostly there — verify each bullet) |
| Code Quality: naming, file caps, style, React compiler, a11y, page shell pointer, JSONB defaults | **NEW `docs/code-style.md`** |
| Adding a Feature checklist | `TEMPLATE_USAGE.md` (verify) or `docs/code-style.md` |
| Chain of Custody paragraph | `docs/traceability.md` (verify coverage) |
| Production Run Extensions | `docs/architecture.md` or chain-of-custody — wherever fits |
| Isometric section (file list, MCP note) | `docs/isometric/README.md` (mostly there — verify) |
| Authentication section | `docs/auth.md` (verify) |
| Environment Variables (full inventory, 1Password sourcing, three-items-differ) | `docs/security.md` → Secrets Management (merge; keep "items differ" warning ALSO as a CLAUDE.md DO-NOT one-liner) |
| Security section | `docs/security.md` (verify) |
| Documentation Standards | `docs/organization.md` + one CLAUDE.md DO-NOT line ("no messy docs") |
| E2E Testing section + gotchas | **NEW `docs/testing.md`** (also pull in memory-known gotchas: `.env.test` untracked, DISABLE_RATE_LIMIT, Origin header, db:reset on dup keys) |
| CI/CD section | `docs/architecture.md` (new CI/CD subsection) |

Final check: grep old CLAUDE.md section-by-section against new CLAUDE.md + docs to prove
nothing dropped. Then `pnpm lint` is irrelevant (docs only) but run it anyway if any TS touched.

## Deliverable 4 — mechanics

1. `git checkout staging && git pull`, then `git switch -c chore/claude-md-overhaul-codex-skills`
   (current work branch `chore/issue-cleanup-skill` is separate; this plan file may be
   committed on the new branch).
2. Discrete git steps, verify branch before every commit.
3. Commit split suggestion: (a) `chore: add codex delegation skills`, (b) `docs: absorb
   CLAUDE.md detail into docs pages`, (c) `chore: rewrite CLAUDE.md as slim router + model rubric`.
4. PR to `staging`, title < 70 chars, e.g. `chore: codex skills + slim CLAUDE.md router`.
5. Smoke-test one skill end-to-end before opening the PR: run `codex-review` on the branch's
   own diff (`--base staging`) and confirm the report lands.
