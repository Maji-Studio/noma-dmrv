# implement-ticket playbook

Concrete IDs, commands, and prompt skeletons for the conductor. Pull the piece you need when you spawn each subagent; don't load the whole thing into the main thread unless you need it.

## Contents
- [Project board (ProjectV2 "noma dMRV" #9)](#project-board)
- [UI verification](#ui-verification)
- [Codex review](#codex-review)
- [Subagent prompt skeletons](#subagent-prompt-skeletons)

## Project board

Repo `Maji-Studio/noma-dmrv`. Priority and status live on the org ProjectV2 board **"noma dMRV" (project #9, owner Maji-Studio)** — NOT on labels.

- projectId `PVT_kwDOCWqE184BTV0X`
- Status fieldId `PVTSSF_lADOCWqE184BTV0XzhAnD1E`
  - In progress `47fc9ee4` · **In review (Maji) `520dec10`** · In review (DEC) `df73e18b` · Reviewed `98420ff6` · Done `98236657` · Ready `61e4505c` · Backlog `f75ad846`

Find an issue's board item id (it is usually already on the board):

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$num){ projectItems(first:10){ nodes{ id project{ number } } } }
  }
}' -F owner=Maji-Studio -F repo=noma-dmrv -F num=<ISSUE_NUMBER>
```

Pick the node whose `project.number == 9`; that `id` is the itemId. If the issue is not on the board yet, add it: `gh project item-add 9 --owner Maji-Studio --url <ISSUE_URL> --format json` (returns the item `id`).

Set the status:

```bash
gh project item-edit --id <ITEM_ID> \
  --project-id PVT_kwDOCWqE184BTV0X \
  --field-id PVTSSF_lADOCWqE184BTV0XzhAnD1E \
  --single-select-option-id <OPTION_ID>   # 47fc9ee4 = In progress, 520dec10 = In review (Maji)
```

A plan-file target has no issue → skip all board ops and the `Closes #` reference.

## UI verification

Give this to the implementer subagent. **Pick the path by session mode first** — in auto/unattended runs the permission classifier denies `codex exec -s danger-full-access` and every credential-materialization workaround (verified 2026-07-09, PR #409); do not burn attempts on them. In interactive sessions the codex path works because the user can approve the permission prompt.

**Step 0 — dev server on :3100 (all paths).** Check `curl -sf http://localhost:3100 >/dev/null`. If it's down, start it: `pnpm dev` runs `dev:docker` (needs Docker Postgres up) — launch it in the background and wait for :3100 to answer. `.env.local` sets `DISABLE_RATE_LIMIT=true`, so repeated logins are fine. The seeded admin can access every facility, so it can reach any changed page.

**Interactive default — delegate to gpt-5.5 via the codex-computer-use skill** (`.claude/skills/codex-computer-use/SKILL.md`). Follow that skill's mechanics: binary lookup, artifact dir, self-contained prompt (repo path, `http://localhost:3100`, sign-in via `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env.local` — never printed, the exact flow to drive, acceptance checks, screenshots into the artifact dir), `codex exec ... -s danger-full-access` (expect a permission prompt the user approves). Then **read the report and screenshots and judge them yourself** — codex output is evidence, not authority. Codex runs can exceed Bash's 10-min timeout: pass a longer timeout or background+poll.

**Auto/unattended default — Playwright e2e spec** (sanctioned: credentials never surface). Write or extend a spec covering the changed flow using the fixtures in `tests/e2e/fixtures/auth-fixtures.ts` (`adminPage` does HTTP-API auth internally; see `docs/testing.md`). Run just that spec (`pnpm test:e2e -- --grep "<name>"` or the spec path), read the real output — never trust a piped exit code — and commit it as a `test:` commit so it doubles as regression coverage.

**Fallback — claude-in-chrome recipe** (codex absent/errors, spec impractical, or the flow needs the user's own browser session):

1. **Credentials from `.env.local`** (interactive sessions only — never hardcode, never log the value). In auto mode, credential extraction is also classifier-blocked: ask the user to sign in at :3100 themselves, then drive their session.
   ```bash
   EMAIL=$(grep -E '^ADMIN_EMAIL=' .env.local | cut -d= -f2- | tr -d '"')
   # read ADMIN_PASSWORD the same way; keep it out of any echo/log
   ```
2. **Drive Chrome via MCP.** Load the browser tools in one ToolSearch call (`tabs_context_mcp,navigate,computer,read_page,form_input,tabs_create_mcp`), open a new tab, navigate to `http://localhost:3100`, sign in (or continue the user's signed-in session), then navigate to the page the change touches, exercise the changed flow, and capture a screenshot as evidence. After `navigate`, `find` refs go stale — re-click by coordinates and batch click+wait+screenshot in one `browser_batch`.

Any path: report what was exercised and the result. Backend-only change with no UI surface → run the matching `pnpm test:e2e` spec or unit path instead and say which.

## Codex review

Follow the **codex-review skill** (`.claude/skills/codex-review/SKILL.md`) for mechanics — binary lookup (`CODEX="$(command -v codex || echo "/Applications/Codex.app/Contents/Resources/codex")"`), artifact dir, and the Mode A/B split. For this phase, prefer Mode B (custom prompt naming the target `git diff staging...HEAD` plus the brief's requirements); Mode A is `"$CODEX" -C "$PWD" review --base staging > "$REPORT"`.

Run it in Phase 4, before the resolver changes anything. Codex runs can exceed Bash's 10-min timeout: pass a longer timeout or background+poll. Post the substantive findings: `gh pr comment <PR> --body-file "$REPORT"` under a "Codex review (gpt-5.5)" heading, noting they are unverified gpt-5.5 output (the Phase 5 resolver verifies every comment against the code). Best-effort: if codex is missing or errors, skip and note it in the Phase 6 report.

## Subagent prompt skeletons

Each skeleton ends by demanding a summary under ~200 words. Fill the `<…>` slots.

**Implementer (Phase 2)** — synchronous:
> Implement the change described in `<brief path>`. Repo root `<path>`; follow `.claude/CLAUDE.md` (layered flow schema→data-access+guards→fn→hooks→components, `pnpm` only, reuse existing hooks/utilities). If the brief is bulk/mechanical (clear-spec, migration, sweep), you may delegate the patch to gpt-5.5 via `.claude/skills/codex-implementation/SKILL.md` and then inspect the diff yourself; user-facing UI/copy you write yourself. Keep `pnpm lint` and `pnpm typecheck` green — read real output, don't trust piped exit codes. Commit on the current feature branch with conventional commits (body says why). Then verify per the UI verification section of `references/playbook.md` — pick the path by session mode (interactive: codex-computer-use skill; auto/unattended: Playwright e2e spec, never codex full-access) — and judge the evidence yourself. Return under ~200 words: files changed, key decisions/deviations, lint+typecheck status, what was exercised and its result. Do NOT paste diffs or file contents.

**Codex reviewer (Phase 4)** — background, concurrent:
> Run a gpt-5.5 review of PR #`<n>`'s branch against `staging` per `.claude/skills/codex-review/SKILL.md` and the Codex review section of `references/playbook.md` (Mode B preferred; include the brief's requirements in the prompt). Post the substantive findings as ONE `gh pr comment` under a "Codex review (gpt-5.5)" heading, noting they are unverified. If codex is missing or errors, post nothing and return the error. Return under ~200 words: findings posted (or the skip reason).

**Publisher (Phase 3)** — synchronous:
> Push the current branch with `-u` and open a PR to `staging` for `<repo>`. Title/body from the branch commits + `<brief path>`; include `Closes #<n>` if there is an issue. Then move board item `<itemId>` to In review (Maji) per `references/playbook.md`. Return only: PR number and URL.

**Fresh reviewer (Phase 4)** — background, concurrent:
> Review PR #`<n>` in `<repo>` against `<brief/issue>` and the repo's documented standards. Verify every finding against the actual code before you report it — false positives, including bogus P0s, are common. Post ONE `gh pr comment`, signed "session-local reviewer". Return under ~200 words: the findings you posted, ranked by severity.

**Resolver (Phase 5)** — synchronous:
> Address every review comment on PR #`<n>` in `<repo>` (fresh reviewer, Codex, CodeRabbit). For each: verify against the actual code; fix valid ones with the minimal change; decline false positives and over-engineering with a one-line reason. Reply to each thread and resolve the addressed/declined ones; leave genuine open questions unresolved. One commit per addressed comment; keep lint+typecheck green; push. Return under ~200 words: a table of comment → verdict (fixed / declined+reason).
