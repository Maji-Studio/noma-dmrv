---
name: codex-implementation
description: Ask Codex CLI (gpt-5.6-sol at high reasoning effort — the flat-rate OpenAI model slot, formerly gpt-5.5) to implement scoped code changes in the current repository, then have Claude inspect the resulting diff and verification. This is how the Codex model is invoked for implementation work. Use when the user asks to delegate implementation to Codex/gpt-5.5/gpt-5.6, when the model-selection rubric routes bulk/mechanical work to the Codex model, or when a bounded task would benefit from another coding agent producing a patch.
---

Delegate a **bounded** implementation task to the Codex CLI (gpt-5.6-sol, high reasoning —
set as the default in `~/.codex/config.toml`), then bring the diff
back for Claude to review and verify. Claude remains responsible for scoping the task,
reviewing the diff, running or checking verification, and explaining the final result. Do not
let Codex commit, push, deploy, or edit global config. Codex output is **evidence, not
authority**.

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
  implementation directly with Claude.
- Codex output is evidence. Inspect the diff and verify before telling the user it's done.

## Workflow

1. **Pin current state** — `git status --short`. Note any user changes already present so
   they can be preserved and distinguished from Codex's edits.
2. **Define scope** — the files/behavior to change, files to avoid, constraints, and the
   verification commands. Keep it bounded; split multi-part work into separate Codex runs or
   ask the user which scope to do first.
3. **Set up the artifact directory** and write a self-contained prompt:
   ```bash
   ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-implementation.XXXXXX")"
   REPORT="$ARTIFACT_DIR/report.md"
   PROMPT="$ARTIFACT_DIR/prompt.md"
   ```
4. **Run with repo write access:**
   ```bash
   "$CODEX" exec \
     -C "$PWD" \
     --add-dir "$ARTIFACT_DIR" \
     -s workspace-write \
     -o "$REPORT" \
     "$(cat "$PROMPT")"
   ```
   Use `-s workspace-write` by default. Use `-s danger-full-access` only when the task truly
   needs machine-level access (app launch, simulators, package-manager global state).
5. **Inspect** `git status` and `git diff` after Codex exits.
6. **Verify yourself** with the cheapest reliable checks: `pnpm lint`, `pnpm typecheck`,
   focused tests. Never trust the exit code of `cmd | tail` (pipefail gotcha) — a masked
   failure can look green.
7. **Report** what Codex changed, what Claude verified, and remaining risks.

## Prompt requirements — tell Codex

- Exact goal + acceptance criteria.
- Repo path and branch context.
- Which existing patterns/files/tests to inspect first.
- Files/behavior that must NOT change; preserve unrelated user changes.
- Must not commit, push, deploy, or edit global config.
- Which verification commands to run (or why any were skipped).
- Write a concise final report: files changed, verification results, unresolved questions.

## Repo-specific constraints to inject into every prompt

- **pnpm only** — never npm/yarn.
- Respect the **layered architecture** (components → hooks → fn → data-access → db); `fn/`
  files have `"use server"` + Zod validation; every `data-access/` function calls an auth
  guard.
- **Never read or edit `.env*` files** (sole exception: the codex-computer-use sign-in flow
  reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env.local` — that skill covers it); never log
  PII (log IDs, not emails/names).
- **kebab-case** file names; **no file may exceed 1000 lines**.
- **Never touch `staging`/`main`** or create commits.

## Example Prompt

```text
Repository: /Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv (branch: <current>)
Artifact directory: <ARTIFACT_DIR> (write your report to report.md here)

Goal: <one-sentence goal>.

Acceptance criteria:
- <observable behavior 1>
- <observable behavior 2>

Constraints:
- pnpm only; follow the layered architecture (components → hooks → fn → data-access → db).
- fn/ files use "use server" + Zod; every data-access function calls an auth guard.
- Do not read or edit .env* files; do not log PII; kebab-case files; no file over 1000 lines.
- Do not commit, push, deploy, edit global config, or touch staging/main.
- Follow existing patterns in <reference files>; do not change <files to avoid>.

Verification: run `pnpm lint` and `pnpm typecheck`; run <focused test> if relevant.

Report format: files changed, verification results, and any unresolved questions.
```

## Review After Codex

- Always inspect the diff before telling the user it's done.
- Revert only Codex-created mistakes, and only when you're sure they aren't user changes.
- If Codex leaves the repo worse or touches unrelated files, **stop and report** with a diff
  summary rather than papering over it.
