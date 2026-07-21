QA execution is complete. Verdict: **Production-blocking**.

The primary blocker reproduced 4/4 times: production run `PR-26-001` could not transition from Running to Complete despite valid end date/time fields. This blocked all downstream product, batch, Removal, and GHG Statement paths. Zero Isometric registry objects were created, and the sandbox state remained unchanged.

Uploads were not tested because the browser environment could not attach local files; this is not an application upload verdict.

- [Full QA ledger](/Users/kenji/Dropbox/Maji/18%20Dark%20Earth%20Carbon/noma-dmrv/docs/qa/2026-07-21-staging-isometric-integration.md)
- [Supporting artifacts](/Users/kenji/Dropbox/Maji/18%20Dark%20Earth%20Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric)

No source code, branches, commits, issues, or production Isometric resources were touched. No direct database operations were performed, and the credential scan passed.