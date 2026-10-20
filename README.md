# issue-assets

Orphan branch that only holds screenshots for GitHub issues and PR before/after comparisons.
No code, no workflows. Never merge it anywhere, never branch from it.

## Layout

- `issues/<n>/<slug>.png`: screenshots attached to issue #n
- `prs/<n>/before-<slug>.png`, `prs/<n>/after-<slug>.png`: before/after pairs for PR #n
- `tools/extract-images.py`: the one tool that still lives here (see below)

Reference files as `https://raw.githubusercontent.com/Maji-Studio/noma-dmrv/issue-assets/<path>`
(the repo is public, so raw URLs render in issues and PRs).

## Tools

The upload and PR-body tools moved to `scripts/pr-evidence/` on `staging` (`upload-shots.py`,
`add-shots.py`, `set-evidence.py`). Run them from a checkout with `python3 -I scripts/pr-evidence/<tool>`;
`scripts/pr-evidence/README.md` documents them and the screenshot mode that hides the account block.
`tools/upload-shots.py` and `tools/add-shots.py` here are old copies; do not use them.

`extract-images.py <session.jsonl> <out_dir>` stays here: it pulls screenshots pasted into a Claude Code
session out of its transcript and writes `index.tsv` with the message text next to each image. Fetch it
into a scratch directory and run it with `python3 -I`.

Look at every image before uploading: anything here is public.

## PR before/after

Capture both shots from the app at the same viewport and state: `before` on the PR base, `after` on the
PR head. Upload them under `prs/<n>/`, then write them into the PR body with
`scripts/pr-evidence/set-evidence.py`, which keeps one marked Screenshots block inside the Evidence section
and replaces it on each push.
