# implement-ticket playbook

IDs, commands and prompt skeletons for the conductor. Pull the section you need when its step comes up.

## Contents
- [Board](#board)
- [Implementer](#implementer)
- [Evidence](#evidence)
- [Local review rounds](#local-review-rounds)
- [Fixer](#fixer)
- [Opening the PR](#opening-the-pr)

## Board

Repo `Maji-Studio/noma-dmrv`. Priority and status live on the org ProjectV2 board **"noma dMRV" (project #9, owner Maji-Studio)**, not on labels. Board edits need the `project` token scope.

- projectId `PVT_kwDOCWqE184BTV0X`
- Status fieldId `PVTSSF_lADOCWqE184BTV0XzhAnD1E`
  - In progress `47fc9ee4` · **In review (Maji) `520dec10`** · In review (DEC) `df73e18b` · Reviewed `98420ff6` · Done `98236657` · Ready `61e4505c` · Backlog `f75ad846`

Find an issue's board item id:

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$num){ projectItems(first:10){ nodes{ id project{ number } } } }
  }
}' -F owner=Maji-Studio -F repo=noma-dmrv -F num=<ISSUE_NUMBER>
```

Pick the node whose `project.number == 9`. If the issue is not on the board, add it: `gh project item-add 9 --owner Maji-Studio --url <ISSUE_URL> --format json`.

```bash
gh project item-edit --id <ITEM_ID> \
  --project-id PVT_kwDOCWqE184BTV0X \
  --field-id PVTSSF_lADOCWqE184BTV0XzhAnD1E \
  --single-select-option-id <OPTION_ID>
```

A plan-file target has no issue: skip board moves and `Closes #`.

## Implementer

Non-UI: run the **codex-implementation** skill yourself with the worktree as `-C`; its prompt carries the brief's goal and acceptance criteria. UI: spawn a Claude subagent (Sonnet for a picked design, Opus for variants) with this prompt:

> Implement the change in `<brief path>` in the worktree `<path>` (branch `<branch>`). Load the `noma-design` skill and follow `.claude/CLAUDE.md`. Commit on this branch with conventional commits whose body says why. Kill only the PID on your own port (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`); set work aside with a WIP commit, never `git stash`. Return under ~200 words: files changed, decisions and deviations, what you ran and its result. No diffs or file contents.

The conductor reads the diff before step 3.

## Evidence

UI changes get Before | After at the same viewport and state (1440 and 390), before on `origin/staging`, after on the branch head. Interactive session: the **codex-computer-use** skill drives the worktree's dev server. Auto mode: a Playwright spec takes the shots (`adminPage` fixture, see `docs/testing.md`). Hosting and the PR body block: `scripts/pr-evidence/README.md`. Look at every image before uploading; uploads are public.

A backend-only change shows a test that fails on `origin/staging` and passes on the head instead.

## Local review rounds

- One suite at a time across all sessions: two in parallel hit Codex rate limits (429), and a run with a failed reviewer writes no complete report. When only some reviewers failed, rerun those with `--models <m> --practices <list>` into a new artifact dir and merge the two `report.json` files by hand before setting dispositions.
- Run it from the worktree root. The suite refuses a dirty worktree, so commit first.
- `report.json` sits in the `--artifact-dir`. Set each finding's `disposition` to `fixed` or `declined`, and `reason` (required for `declined`), then pass the file as `--prior` to the next round. The P0-P3 counts for the PR table come from its `counts`.
- A finding that re-raises a declined item without new evidence is declined again with the same reason.
- `--profile full` is the default and the local setting. `--profile light` is for the PR pass only.

## Fixer

Give the valid findings to an implementer routed like step 2 (Codex for non-UI). Prompt:

> Fix these review findings in the worktree `<path>` (branch `<branch>`), each with the smallest change that removes the defect: `<id, path:lines, problem, smallest safe fix>` per finding. Leave everything else as it is. Follow `.claude/CLAUDE.md`. Run `pnpm verify:static` and `<tests>`; once they are green, commit one `fix:` commit per finding or one per round, body naming the finding ids. Return under ~200 words: finding id → commit sha, and the gate results.

## Opening the PR

Push from the main checkout (`git -C "<main checkout>" push -u origin <branch>`); a push from the worktree cwd gets blocked in auto mode. Then:

```bash
gh pr create --base staging --head <branch> --title "<type>: <lowercase imperative>" --body-file <body.md>
```

The body follows the **pr** skill, with `Closes #<n>`, the Evidence section, and `## Reviewed before opening` from step 5 of the flow.
