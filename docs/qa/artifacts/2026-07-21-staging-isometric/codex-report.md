QA run completed. Verdict: **Production-blocking**.

The P1 blocker is `PR-26-001`: Running → Complete fails 4/4 times with `A complete run needs an end time`, despite populated end fields. This prevents all downstream Isometric writes. No new Removal or GHG Statement reached the sandbox; registry state remained unchanged.

Files written:

- [Final QA ledger](/Users/kenji/Dropbox/Maji/18%20Dark%20Earth%20Carbon/noma-dmrv/docs/qa/2026-07-21-staging-isometric-integration.md)
- [Artifact directory](/Users/kenji/Dropbox/Maji/18%20Dark%20Earth%20Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric), containing the input sheet, baseline/post-run registry evidence, stage screenshots, and sanitized completion-error evidence.

Uploads remain unverified because the browser’s local-file permission was unavailable. No source code, database, Git, PR, issue, or production Isometric changes were made.