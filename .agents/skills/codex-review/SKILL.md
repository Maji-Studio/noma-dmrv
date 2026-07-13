---
name: codex-review
description: Ask Codex CLI (gpt-5.6-sol at high reasoning effort — the flat-rate OpenAI model slot, formerly gpt-5.5) for an independent code review of uncommitted changes, a branch diff, a commit, or a specific implementation. This is how the Codex model is invoked for review work. Use when the user asks for a Codex/gpt-5.5/gpt-5.6 review or second opinion, or when the model-selection rubric calls for an extra independent review perspective. For a review by Claude itself, use the normal review process instead.
---

Delegate a code review to the Codex CLI (gpt-5.6-sol, high reasoning — set as the default in
`~/.codex/config.toml`) and bring the findings back for Claude to
verify before presenting them. Claude stays responsible for judging the findings — Codex's
output is **evidence, not authority**.

## Shared invocation rules

- Locate the binary with the PATH-then-pnpm fallback and always call it via `"$CODEX"`:
  ```bash
  CODEX="$(command -v codex || echo "$HOME/Library/pnpm/bin/codex")"
  ```
  Last resort: the ChatGPT.app bundle at `/Applications/ChatGPT.app/Contents/Resources/codex`.
  (The old `/Applications/Codex.app/Contents/Resources/codex` path no longer exists.)
- **gpt-5.6-sol requires codex-cli ≥ 0.144** — older CLIs fail with a 400
  `"requires a newer version of Codex"`. If that error appears, upgrade with
  `pnpm add -g @openai/codex@latest` (verified working on 0.144.1, 2026-07-10).
- Codex runs can exceed the Bash tool's 10-minute timeout. Either pass an explicit longer
  `timeout` to the Bash tool, or run the command in the background and poll for `$REPORT`.
- If `codex` is not installed or the command fails, report the error and offer to do the
  review directly with Claude's own review process.
- Codex output is evidence. Verify important claims against the code before repeating them.

## Overproduction review lens

5.6-sol implementations can overproduce: when requirements or access are missing, the model
may force progress by inventing behavior or coding around the gap; it may also overengineer a
small change or create more tests than the risk warrants. Every custom review prompt must ask
the reviewer to inspect the target code for these failure modes:

- **Forced implementation:** Did the code guess a product decision, external-system behavior,
  credential-dependent result, or unavailable artifact that should instead have triggered a
  question or an access request? Flag the unsupported assumption and identify what evidence or
  decision was needed.
- **Excess scope:** Does the diff implement behavior beyond the stated requirement, including
  speculative future needs or unrelated cleanup?
- **Overengineering:** Could existing project patterns or a materially smaller change satisfy
  the same requirement? Flag new abstractions, configuration, dependencies, fallback paths,
  defensive branches, and generalization only when they add concrete maintenance cost,
  duplication, or behavior risk without a current need.
- **Test inflation:** Do added tests duplicate coverage, assert implementation details, exhaust
  low-value permutations, or require disproportionate setup and maintenance? Preserve tests
  that cover meaningful behavior, regressions, security boundaries, or risky edge cases.
- **Proportionality:** Consider the implementation and its tests together. Prefer the smallest
  code and test surface that fully meets the requirement and repository standards; simplicity
  must not remove necessary correctness, security, authorization, or regression coverage.

Do not manufacture a finding merely because an alternative is shorter. Require a concrete
scope, maintenance, or correctness cost, and suggest the smallest safe simplification.

## Workflow

### 1. Identify the review target

One of: uncommitted changes (staged + unstaged + untracked), a base branch diff, a single
commit SHA, a checked-out PR, or a specific set of files. Ask the user if it's ambiguous.

### 2. Set up the artifact directory

```bash
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-review.XXXXXX")"
REPORT="$ARTIFACT_DIR/report.md"
PROMPT="$ARTIFACT_DIR/prompt.md"
```

Write a self-contained review prompt into `$PROMPT` (template below).

### 3. Run `codex review`

The target flags are **mutually exclusive with a custom prompt** (re-verified on codex-cli
0.144.1 — `--uncommitted`/`--base`/`--commit` each reject `[PROMPT]`). Pick one mode:

```bash
# Mode A — default review instructions, structured target flag:
"$CODEX" -C "$PWD" review --uncommitted > "$REPORT"    # staged + unstaged + untracked
"$CODEX" -C "$PWD" review --base staging > "$REPORT"   # branch vs base (this repo: staging)
"$CODEX" -C "$PWD" review --commit <sha> > "$REPORT"   # a single commit
```

```bash
# Mode B — custom instructions via stdin; NO target flag allowed. Name the review
# target in the prompt's first line — codex resolves the diff itself with git:
"$CODEX" -C "$PWD" review - < "$PROMPT" > "$REPORT"
```

Prefer Mode B whenever task-specific context matters (it usually does); use Mode A for a
plain no-context review.

### 4. Verify before presenting

Read `$REPORT`, then **verify each substantive finding against the actual code before
repeating it** — this is the repo's standing review-remediation rule: false positives are
common (including bogus P0s). In the user-facing response, clearly separate:

- **Confirmed issues** — Claude checked the code and agrees.
- **Unverified Codex suggestions** — reported by Codex, not yet confirmed.

If Codex found nothing substantive, say so plainly and name the exact review target and any
residual test gaps.

## Review prompt template

Write this into `$PROMPT`, adding task-specific context (requirements the change must meet,
risky areas, expected behavior, files Claude is unsure about) where useful. In Mode B the
first line MUST name the target, e.g. `Target: the diff of this branch against the base
branch staging (git diff staging...HEAD).` or `Target: all uncommitted changes.`

```text
Target: <the exact diff to review>

Review these changes for bugs, regressions, security issues, requirement mismatches, meaningful
test gaps, and overproduction in the submitted code. Prioritize findings over summary. For
each finding include: severity, file and line reference, concrete failure mode or maintenance
cost, and the smallest safe fix direction.

Specifically audit whether the implementation forced progress through a missing requirement,
product decision, credential, external system, or unavailable artifact by guessing behavior or
coding a workaround where the author should have asked a question or obtained access. Also
look for excess scope, speculative generalization, unnecessary abstractions, configuration,
dependencies, fallback paths, defensive branches, or unrelated cleanup. Review added tests for
duplicate coverage, implementation-detail assertions, low-value permutation matrices, and
disproportionate setup or maintenance cost. Prefer the smallest code and test surface that
fully meets the current requirement, while preserving necessary correctness, security,
authorization, and regression coverage.

This is a read-only review: do not edit files. Do not manufacture simplicity findings merely
because another solution is shorter; identify a concrete scope, maintenance, or correctness
cost. If the change is correct and proportionate, say so and name only material residual risks
or test gaps.
```

Repo context worth adding when relevant: pnpm-only; layered architecture
(components → hooks → fn → data-access → db) with `"use server"` + Zod in `fn/` and auth
guards in every `data-access/` function; never log PII; kebab-case files; 1000-line cap.
