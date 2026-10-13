# implement-ticket playbook

Concrete IDs, commands, and prompt skeletons for the conductor. Pull the piece you need when you spawn each subagent; don't load the whole thing into the main thread unless you need it.

## Contents
- [Project board (ProjectV2 "noma dMRV" #9)](#project-board)
- [UI verification](#ui-verification)
- [PR review suite](#pr-review-suite)
- [Subagent prompt skeletons](#subagent-prompt-skeletons)

## Project board

Repo `Maji-Studio/noma-dmrv`. Priority and status live on the org ProjectV2 board **"noma dMRV" (project #9, owner Maji-Studio)** — NOT on labels.

- projectId `PVT_kwDOCWqE184BTV0X`
- Status fieldId `PVTSSF_lADOCWqE184BTV0XzhAnD1E`
  - In progress `47fc9ee4` · **In review (Maji) `520dec10`** · In review (DEC) `df73e18b` · Reviewed `98420ff6` · Done `98236657` · Ready `61e4505c` · Backlog `f75ad846`

Before writing, verify the project identity and discover its current fields/options:

```bash
gh project view 9 --owner Maji-Studio --format json
gh project field-list 9 --owner Maji-Studio --format json
```

The IDs above are a lookup aid, not authority. Use live project/field/option IDs
for Status and Priority; preserve existing Priority unless a change is requested.
If a required field or option is absent, report the mismatch rather than creating
labels, options, or another board. Verify the resulting item state after writes.

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
  --project-id <LIVE_PROJECT_ID> \
  --field-id <LIVE_STATUS_FIELD_ID> \
  --single-select-option-id <LIVE_OPTION_ID>
```

A plan-file target has no issue → skip all board ops and the `Closes #` reference.

## UI verification

Give this to the implementer subagent. **Pick the path by session mode first** — in auto/unattended runs the permission classifier denies `codex exec -s danger-full-access` and every credential-materialization workaround (verified 2026-07-09, PR #409); do not burn attempts on them. In interactive sessions the codex path works because the user can approve the permission prompt.

**Step 0 — dev server on :3100 (all paths).** Check `curl -sf http://localhost:3100 >/dev/null`. If it's down, start it: `pnpm dev` runs `dev:docker` (needs Docker Postgres up) — launch it in the background and wait for :3100 to answer. `.env.local` sets `DISABLE_RATE_LIMIT=true`, so repeated logins are fine. The seeded admin can access every facility, so it can reach any changed page.

**Interactive default — delegate to gpt-6-astra via the codex-computer-use skill** (`.claude/skills/codex-computer-use/SKILL.md`). Follow that skill's mechanics: binary lookup, artifact dir, self-contained prompt (repo path, `http://localhost:3100`, sign-in via `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env.local` — never printed, the exact flow to drive, acceptance checks, screenshots into the artifact dir), `codex exec ... -s danger-full-access` (expect a permission prompt the user approves). Then **read the report and screenshots and judge them yourself** — codex output is evidence, not authority. Codex runs can exceed Bash's 10-min timeout: pass a longer timeout or background+poll.

**Auto/unattended default — Playwright e2e spec** (sanctioned: credentials never surface). Write or extend a spec covering the changed flow using the fixtures in `tests/e2e/fixtures/auth-fixtures.ts` (`adminPage` does HTTP-API auth internally; see `docs/testing.md`). Run just that spec (`pnpm test:e2e -- --grep "<name>"` or the spec path), read the real output — never trust a piped exit code — and commit it as a `test:` commit so it doubles as regression coverage.

**Fallback — claude-in-chrome recipe** (codex absent/errors, spec impractical, or the flow needs the user's own browser session):

1. **Credentials from `.env.local`** (interactive sessions only — never hardcode, never log the value). In auto mode, credential extraction is also classifier-blocked: ask the user to sign in at :3100 themselves, then drive their session.
   ```bash
   EMAIL=$(grep -E '^ADMIN_EMAIL=' .env.local | cut -d= -f2- | tr -d '"')
   # read ADMIN_PASSWORD the same way; keep it out of any echo/log
   ```
2. **Drive Chrome via MCP.** Load the browser tools in one ToolSearch call (`tabs_context_mcp,navigate,computer,read_page,form_input,tabs_create_mcp`), open a new tab, navigate to `http://localhost:3100`, sign in (or continue the user's signed-in session), then navigate to the page the change touches, exercise the changed flow, and capture a screenshot as evidence. After `navigate`, `find` refs go stale — re-click by coordinates and batch click+wait+screenshot in one `browser_batch`.

For UI changes, read [visual evidence](../../ui-feedback/references/visual-evidence.md) for baseline preservation, comparable after captures, privacy, durable publication, and blocked attachment handling. Apply it to whichever verification path the session permits.

Any path: report what was exercised and the result. Backend-only change with no UI surface → run the matching `pnpm test:e2e` spec or unit path instead and say which.

## PR review suite

Use [pr-review-suite](../../pr-review-suite/SKILL.md) in Phase 4 with the draft
PR number; pass the brief as `--spec` when no originating issue/spec is linked.
The suite owns invocation, independent practices/models, head checks, and its
single updateable comment. Return the reviewed head, comment URL, practice/model
status, and artifact paths. If it fails, retain/report local evidence and the
failure; do not replace its all-models gate with partial comments. Phase 5 owns
verification and remediation of findings. Rerun the suite after later pushes;
neither phase automatically marks ready or merges.

## Subagent prompt skeletons

Each skeleton ends by demanding a summary under ~200 words. Fill the `<…>` slots.

**Implementer (Phase 2)** — synchronous:
> Implement the change described in `<brief path>`. Repo root `<path>`; follow `.claude/CLAUDE.md` (layered flow schema→data-access+guards→fn→hooks→components, `pnpm` only, reuse existing hooks/utilities). If the brief is bulk/mechanical (clear-spec, migration, sweep), you may delegate the patch to gpt-6-astra via `.claude/skills/codex-implementation/SKILL.md` and then inspect the diff yourself; user-facing UI/copy you write yourself. Keep `pnpm lint` and `pnpm typecheck` green — read real output, don't trust piped exit codes. Commit on the current feature branch with conventional commits (body says why). For UI changes, preserve the brief’s before evidence and capture comparable running-app after evidence per `.claude/skills/ui-feedback/references/visual-evidence.md`; report gaps honestly. Then verify per the UI verification section of `references/playbook.md` — pick the path by session mode (interactive: codex-computer-use skill; auto/unattended: Playwright e2e spec, never codex full-access) — and judge the evidence yourself. Return under ~200 words: files changed, key decisions/deviations, lint+typecheck status, what was exercised and its result. Do NOT paste diffs or file contents.

**Publisher (Phase 3)** — synchronous:
> Push the current branch with `-u` and open a draft PR to `staging` for `<repo>`. Title/body from the branch commits + `<brief path>`; include `Closes #<n>` if there is an issue. For UI changes, include durable before/after evidence per `.claude/skills/ui-feedback/references/visual-evidence.md`, or explicitly disclose blocked publication and provide the prepared attachment package. Then move board item `<itemId>` to In review (Maji) per `references/playbook.md`. Return under ~200 words: PR number, URL, board state, and evidence publication status. Leave the PR draft.

**Review suite (Phase 4)** — fresh delegate:
> Review draft PR #`<n>` using `.claude/skills/pr-review-suite/SKILL.md` and `<brief/issue>`. Run the deterministic suite and publish its one updateable comment only under its publication rules. Keep findings advisory; do not fix, mark ready, or merge. Return under ~200 words: reviewed head, comment URL, practice/model status, artifacts, and any failure.

**Resolver (Phase 5)** — synchronous:
> Address every review comment on PR #`<n>` in `<repo>` (review suite and CodeRabbit). For each: verify against the actual code; fix valid ones with the minimal change; decline false positives and over-engineering with a one-line reason. Keep the suite marker-owned comment intact; post a separate remediation summary keyed by practice/finding. Reply to review threads and resolve the addressed/declined ones; leave genuine open questions unresolved. One commit per addressed comment; keep lint+typecheck green; push. Refresh affected UI evidence and rerun pr-review-suite after pushes to update its comment for the new head. Report unresolved findings and failures; leave the PR draft and do not merge. Return under ~200 words: a table of comment → verdict (fixed / declined+reason).
