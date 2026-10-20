# PR evidence

Tools for putting screenshots on PRs and issues. Images are hosted on the orphan
`issue-assets` branch (public, no workflows, never merge it); only these tools live here.
Run them with `python3 -I`. Anything uploaded is public, so look at every image first.

- `upload-shots.py "<message>" <local>=<repo_path> [...]`: commits files to `issue-assets` through the
  GitHub API (no checkout) and prints raw URLs. Paths: `prs/<n>/before-<slug>.png`,
  `prs/<n>/after-<slug>.png`, `issues/<n>/<slug>.png`.
- `set-evidence.py <body.md> <head_sha> "<caption>|<before_url>|<after_url>|<width>" [--gif "<caption>|<url>|<width>"]`:
  rewrites a PR body so it holds exactly one `## Evidence (head <sha>)` section with a Before | After
  table. Each run replaces the old section, so rounds never stack. Fetch the body with
  `gh pr view <n> --json body -q .body > body.md`, run the script, then `gh pr edit <n> --body-file body.md`.
- `add-shots.py <body.md> after-first|end "<caption>|<url>|<width>" [...]`: inserts a `## Screenshots`
  section into an issue body. Use half the pixel width for retina shots.

Capture before on the PR base and after on the PR head, at the same viewport and state
(1440 and 390 for UI PRs). Run `python3 -I -m unittest discover -s scripts/pr-evidence -p 'test_*.py'` after editing the tools.

## Screenshot mode

Start the dev server with `NEXT_PUBLIC_SHOT_MODE=true` to hide the sidebar user name and email and the
Next.js dev indicator, so desktop shots never leak an account. It is an env flag, not a URL param, because
it must survive client navigation between pages, covers the dev indicator (a `next.config.ts` setting), and
needs no runtime code path for normal users. It is read at build time, so restart `next dev` to toggle it.
Development only: it is ignored in production builds. It is not persisted anywhere.
Use the seeded test admin for captures, not a real account.
