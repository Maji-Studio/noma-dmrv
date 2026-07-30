Resume the authenticated staging × Isometric sandbox QA continuation documented in:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/2026-07-21-staging-isometric-integration.md

Repository:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Artifact directory:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric

The user has now enabled Chrome's local file access and explicitly says to proceed. Resume
the existing synthetic chain at `CB-26-001`. Do not reset or recreate records unnecessarily.

Create QA-only fixtures as needed:
- a synthetic production telemetry/readings CSV matching the exact UI schema and the time
  bounds of `PR-26-001`; use safe plausible values and label it unambiguously as synthetic
  in its filename/metadata where supported
- three distinct synthetic images for the Application evidence roles: stockpile, spreading,
  and incorporation. You may reuse the existing clearly marked QA-only placeholder as source,
  but each uploaded role must be distinguishable and must never look like genuine field proof

Verify that local attachment now works and that each file persists after save/reload. Record
the displayed filename, role, upload/persistence outcome, and any sanitized console/network
failure. Never capture or record signed URLs, credentials, cookies, tokens, or authorization
headers.

Then continue autonomously through all safe reachable steps:
1. satisfy production telemetry/readiness for `PR-26-001`
2. satisfy Application evidence for `AP-26-001`
3. re-evaluate `CB-26-001` readiness and the three samples `SAM-26-001`–`003`
4. create and submit the Removal / Isometric GHG Entry if the UI permits
5. reconcile every new Datapoint, Measurement Sample, Source, telemetry object, and GHG Entry
   against only sandbox project `prj_1K9YJ33RKSBX9FFF`
6. create and submit the GHG Statement if the UI permits, then reconcile it in the sandbox
7. exercise safe refresh/retry/idempotency behavior without deliberately creating duplicates

Do not stop at the first failure. Continue all independently reachable routes and controls.
Record every fix confirmation, bug, mismatch, stale/transient state, confusing copy, missing
prerequisite, validation behavior, untested surface, and environment limitation with exact
route, steps/input, expected, actual, frequency, impact, and evidence.

Evidence:
- continue sequential numbering from 28 onward in the existing artifact directory
- update the existing authoritative ledger in place
- write the final continuation summary to
  `/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric/upload-continuation-report.md`

Safety:
- staging noma and the exact Isometric sandbox project only; never production Isometric
- synthetic records through UI are authorized; no database mutation/reset/push commands
- no application source edits, branches, commits, PRs, or GitHub issues
- before any new Isometric interpretation/API/MCP call, invoke connected Isometric `how_to`;
  if unavailable, record that and use the authenticated sandbox UI read-only for reconciliation
- close only automation/tabs you opened
- finish with Markdown credential scan and confirm zero changes under `src/`

Return the final verdict, all created app and sandbox IDs, blockers, and every file written.
