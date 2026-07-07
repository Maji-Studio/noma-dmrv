# implement-ticket playbook

Concrete IDs, commands, and prompt skeletons for the conductor. Pull the piece you need when you spawn each subagent; don't load the whole thing into the main thread unless you need it.

## Contents
- [Project board (ProjectV2 "noma dMRV" #9)](#project-board)
- [Chrome E2E login recipe](#chrome-e2e-login-recipe)
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

## Chrome E2E login recipe

The verify step drives the **real UI** in Chrome (not the Playwright HTTP-auth fixtures). Give this recipe to the implementer subagent.

1. **Dev server on :3100.** Check `curl -sf http://localhost:3100 >/dev/null`. If it's down, start it: `pnpm dev` runs `dev:docker` (needs Docker Postgres up) — launch it in the background and wait for :3100 to answer. `.env.local` sets `DISABLE_RATE_LIMIT=true`, so repeated logins are fine.
2. **Credentials from `.env.local`** (never hardcode, never log the value):
   ```bash
   EMAIL=$(grep -E '^ADMIN_EMAIL=' .env.local | cut -d= -f2- | tr -d '"')
   # read ADMIN_PASSWORD the same way; keep it out of any echo/log
   ```
   The seeded admin can access every facility, so it can reach any changed page.
3. **Drive Chrome via MCP.** Load the browser tools in one ToolSearch call (`tabs_context_mcp,navigate,computer,read_page,form_input,tabs_create_mcp`), open a new tab, navigate to `http://localhost:3100`, sign in with the creds, then navigate to the page the change touches, exercise the changed flow, and capture a screenshot as evidence.
4. Report what was exercised and the result. Backend-only change with no UI surface → run the matching `pnpm test:e2e` spec or unit path instead and say which.

## Codex review

Codex CLI is installed but **not on PATH** — call it by absolute path:

```bash
~/Library/pnpm/bin/codex exec review --base staging --title "<pr title>" > /tmp/codex-review.txt 2>&1
```

`exec review` reviews the current branch against `staging` and streams findings to stdout — run it in Phase 4, before the resolver changes anything. If it stalls on approvals in headless use, add `--dangerously-bypass-approvals-and-sandbox` (acceptable here: review is read-only; do not let codex write). Capture the substantive findings and post them: `gh pr comment <PR> --body-file /tmp/codex-review.txt` under a "Codex review" heading. Best-effort: if `~/Library/pnpm/bin/codex` is missing or errors, skip and note it in the Phase 6 report.

## Subagent prompt skeletons

Each skeleton ends by demanding a summary under ~200 words. Fill the `<…>` slots.

**Implementer (Phase 2)** — synchronous:
> Implement the change described in `<brief path>`. Repo root `<path>`; follow `.claude/CLAUDE.md` (layered flow schema→data-access+guards→fn→hooks→components, `pnpm` only, reuse existing hooks/utilities). Keep `pnpm lint` and `pnpm typecheck` green — read real output, don't trust piped exit codes. Commit on the current feature branch with conventional commits (body says why). Then verify in a real browser using the Chrome login recipe in `references/playbook.md`; capture a screenshot. Return under ~200 words: files changed, key decisions/deviations, lint+typecheck status, what you exercised and its result. Do NOT paste diffs or file contents.

**Publisher (Phase 3)** — synchronous:
> Push the current branch with `-u` and open a PR to `staging` for `<repo>`. Title/body from the branch commits + `<brief path>`; include `Closes #<n>` if there is an issue. Then move board item `<itemId>` to In review (Maji) per `references/playbook.md`. Return only: PR number and URL.

**Fresh reviewer (Phase 4)** — background, concurrent:
> Review PR #`<n>` in `<repo>` against `<brief/issue>` and the repo's documented standards. Verify every finding against the actual code before you report it — false positives, including bogus P0s, are common. Post ONE `gh pr comment`, signed "session-local reviewer". Return under ~200 words: the findings you posted, ranked by severity.

**Resolver (Phase 5)** — synchronous:
> Address every review comment on PR #`<n>` in `<repo>` (fresh reviewer, Codex, CodeRabbit). For each: verify against the actual code; fix valid ones with the minimal change; decline false positives and over-engineering with a one-line reason. Reply to each thread and resolve the addressed/declined ones; leave genuine open questions unresolved. One commit per addressed comment; keep lint+typecheck green; push. Return under ~200 words: a table of comment → verdict (fixed / declined+reason).
