Final verdict: **environment-blocked**. Chrome file access was enabled, but the automation layer still failed to expose the chooser through both the production file input and visible upload button (2/2). No bytes were transmitted, so telemetry, application evidence, Removal/GHG Entry, and GHG Statement creation remain unverified.

No new app or sandbox IDs were created. Existing chain records were preserved:

- `PR-26-001` remains Complete but missing telemetry.
- `AP-26-001` retains zero stockpile, spreading, and incorporation files.
- `CB-26-001` remains Pending with one grouped readiness issue.
- `SAM-26-001`–`003` remain 3/3 usable and Eligible.
- Sandbox `prj_1K9YJ33RKSBX9FFF` remains at 31 GHG entries and 11 statements.
- No Datapoint, Measurement Sample, Source, telemetry object, GHG Entry, or statement was created.

The authoritative ledger was updated at [2026-07-21-staging-isometric-integration.md](/Users/kenji/Dropbox/Maji/18%20Dark%20Earth%20Carbon/noma-dmrv/docs/qa/2026-07-21-staging-isometric-integration.md). The complete result and written-file inventory are in [upload-continuation-report.md](/Users/kenji/Dropbox/Maji/18%20Dark%20Earth%20Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric/upload-continuation-report.md).

Safety checks passed:

- Markdown credential scan: zero matches.
- Changes under `src/`: zero tracked or untracked changes.
- No reset, database push, source edit, branch, commit, PR, issue, or production Isometric access.
- Authenticated tabs were released without closing user-owned tabs.