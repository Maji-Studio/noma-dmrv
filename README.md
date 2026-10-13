# issue-assets

Orphan branch that only holds screenshots for GitHub issues and PR before/after comparisons.
No code, no workflows. Never merge it anywhere, never branch from it.

## Layout

- `issues/<n>/<slug>.png`: screenshots attached to issue #n
- `prs/<n>/before-<slug>.png`, `prs/<n>/after-<slug>.png`: before/after pairs for PR #n
- `tools/`: the scripts below

Reference files as `https://raw.githubusercontent.com/Maji-Studio/noma-dmrv/issue-assets/<path>`
(the repo is public, so raw URLs render in issues and PRs).

## Tools

Fetch them into a scratch directory first, then run with `python3 -I`:

```sh
for f in extract-images.py upload-shots.py add-shots.py; do
  curl -fsSL "https://raw.githubusercontent.com/Maji-Studio/noma-dmrv/issue-assets/tools/$f" -o "$DIR/$f"
done
```

- `extract-images.py <session.jsonl> <out_dir>`: pulls screenshots pasted into a Claude Code session out of
  its transcript (`~/.claude/projects/<project>/<session-id>.jsonl`) and writes `index.tsv` with the message
  text next to each image, so each one can be matched to its comment.
- `upload-shots.py "<message>" <local>=<repo_path> [...]`: uploads files to this branch in one commit through
  the GitHub API (no local checkout) and prints the raw URLs.
- `add-shots.py <body.md> after-first|end "<caption>|<url>|<width>" [...]`: inserts a `## Screenshots`
  section into an issue body. Use `width` = half the pixel width for retina captures.

Look at every image before uploading: anything here is public.

## PR before/after

Capture both shots from the app at the same viewport and state: `before` on the PR base, `after` on the
PR head. Upload them under `prs/<n>/`, then put them side by side in the PR body's Evidence section:

```markdown
| Before | After |
| --- | --- |
| <img src=".../prs/<n>/before-x.png" width="400"> | <img src=".../prs/<n>/after-x.png" width="400"> |
```
