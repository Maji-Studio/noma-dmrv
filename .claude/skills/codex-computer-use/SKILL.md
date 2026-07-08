---
name: codex-computer-use
description: Ask Codex CLI (gpt-5.5) to run local app verification that needs computer use — browser automation, screenshots, app launching, or independent runtime inspection. This is the DEFAULT tool for verifying UI behavior in this project — use it to test a flow, verify UI behavior, inspect the running app, capture screenshots, or confirm implemented behavior. Fall back to the claude-in-chrome MCP tools if codex fails or the task needs the user's own logged-in browser session.
---

Delegate **local app verification** (browser automation, screenshots, app launch, runtime
inspection) to the Codex CLI (gpt-5.5) with computer use. This is the **default** way to
verify UI behavior in this project; **claude-in-chrome is the fallback**. Codex output is
**evidence, not authority** — read the report and screenshots and judge them yourself.

Do **not** use this for ordinary code reading, typechecking, linting, or tests Claude can run
directly. Launching apps/browsers to verify requested work is fine without asking; ask first
only if the run could disrupt the user's environment (closing apps, changing system settings,
or acting on real accounts/data).

## Shared invocation rules

- Locate the binary with the PATH-then-bundle fallback and always call it via `"$CODEX"`:
  ```bash
  CODEX="$(command -v codex || echo "/Applications/Codex.app/Contents/Resources/codex")"
  ```
- Codex runs can exceed the Bash tool's 10-minute timeout. Either pass an explicit longer
  `timeout` to the Bash tool, or run the command in the background and poll for `$REPORT`.
- If `codex` is not installed or the command fails, report the error, then fall back to the
  **claude-in-chrome MCP** tools (or offer to verify directly).

## Workflow

1. **Set up the artifact directory:**
   ```bash
   ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-computer-use.XXXXXX")"
   REPORT="$ARTIFACT_DIR/report.md"
   PROMPT="$ARTIFACT_DIR/prompt.md"
   ```
2. **Write a self-contained prompt** into `$PROMPT`: repo path, the exact flow to drive,
   constraints, the artifact dir for screenshots, and the report format (see below).
3. **Run non-interactively:**
   ```bash
   "$CODEX" exec \
     -C "$PWD" \
     --add-dir "$ARTIFACT_DIR" \
     -s danger-full-access \
     -o "$REPORT" \
     "$(cat "$PROMPT")"
   ```
   Use `-s danger-full-access` for GUI automation / screenshots / outside-repo access. Prefer
   `-s workspace-write` for non-GUI checks. Add `--skip-git-repo-check` when running outside a
   git repo.
4. **Read the report**, open/reference the screenshot paths, and summarize for the user with a
   pass/fail per acceptance check.

## Repo specifics to inject into the prompt

- **Dev server:** `http://localhost:3100`. Assume it's already running; if it isn't, note
  that in the report rather than starting a second instance.
- **Sign-in:** read `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env.local` in the repo root and
  use them on the login form (this is the same source the E2E fixtures use). **Never hardcode
  credentials, and never print these values in the report.**
- **Screenshots** go into `$ARTIFACT_DIR`; the report lists each screenshot path and what it
  shows.

## Report format the prompt should request

- Steps performed.
- What was observed vs. expected.
- Pass/fail per acceptance check.
- Anything blocked or uncertain.

## Example prompt skeleton

```text
Repository: /Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv
Artifact directory: <ARTIFACT_DIR> (save screenshots here; write your report to report.md here)

The dev server should be running at http://localhost:3100 — if it is not, note that and stop.
Sign in by reading ADMIN_EMAIL and ADMIN_PASSWORD from .env.local in the repo root. Never
print those values anywhere in the report.

Flow to verify:
- <navigate to ...>
- <perform action ...>
- <capture a screenshot after each key step into the artifact dir>

Acceptance checks:
- <expected observable outcome 1>
- <expected observable outcome 2>

Report: steps performed, observed vs expected, pass/fail per acceptance check, each
screenshot path with a one-line caption, and anything blocked or uncertain.
```
