---
name: codex-review
description: Ask Codex CLI (gpt-5.5) for an independent code review of uncommitted changes, a branch diff, a commit, or a specific implementation. This is how gpt-5.5 is invoked for review work. Use when the user asks for a Codex/gpt-5.5 review or second opinion, or when the model-selection rubric calls for an extra independent review perspective. For a review by Claude itself, use the normal review process instead.
---

Delegate a code review to the Codex CLI (gpt-5.5) and bring the findings back for Claude to
verify before presenting them. Claude stays responsible for judging the findings — Codex's
output is **evidence, not authority**.

## Shared invocation rules

- Locate the binary with the PATH-then-bundle fallback and always call it via `"$CODEX"`:
  ```bash
  CODEX="$(command -v codex || echo "/Applications/Codex.app/Contents/Resources/codex")"
  ```
- Codex runs can exceed the Bash tool's 10-minute timeout. Either pass an explicit longer
  `timeout` to the Bash tool, or run the command in the background and poll for `$REPORT`.
- If `codex` is not installed or the command fails, report the error and offer to do the
  review directly with Claude's own review process.
- Codex output is evidence. Verify important claims against the code before repeating them.

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

The target flags are **mutually exclusive with a custom prompt** (verified on codex-cli
0.142.5 — `--uncommitted`/`--base`/`--commit` each reject `[PROMPT]`). Pick one mode:

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

Review these changes for bugs, regressions, missing tests, security issues, and requirement
mismatches. Prioritize findings over summary. For each finding include: severity, file and
line reference, concrete failure mode, and suggested fix direction. Do not edit files. If
there are no substantive findings, say so and name any residual test gaps.
```

Repo context worth adding when relevant: pnpm-only; layered architecture
(components → hooks → fn → data-access → db) with `"use server"` + Zod in `fn/` and auth
guards in every `data-access/` function; never log PII; kebab-case files; 1000-line cap.
