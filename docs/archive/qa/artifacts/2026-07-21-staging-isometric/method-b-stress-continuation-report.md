# Method-B and certification stress continuation — 2026-07-21

## Outcome

- Fetched `origin/staging`; tested revision
  `f2c55106ecb87e9c583b466353adba2e6f00a6b7`.
- Created isolated synthetic reactor `R-26-002`, completed run `PR-26-002`, credit batch
  `CB-26-002`, and 30 chemistry-complete samples `SAM-26-004`–`SAM-26-033`.
- The 29/30 boundary stayed locked. At 30/30, samples deliberately clustered on one exact
  timestamp became unlock-eligible and successfully activated Method B. Duplicate: #474;
  related process-wide fail-closed work: #417.
- Post-unlock edit and delete attempts that would reduce the baseline below 30 were both
  rejected with a specific invariant error; all 33 facility samples remain.
- Declaring a 31-sample baseline with only 30 eligible samples was correctly rejected by
  the server but surfaced as only `An unexpected error occurred` in the unlock dialog.
- Native file selection succeeded for the application PNG and telemetry CSV, but both
  failed with `could not reach fra1.digitaloceanspaces.com`. Duplicate: #453. No upload
  persisted.
- Removal remained at 0 and GHG Statements at 0. The empty-statement gate remained safe.
- The Removal wizard still falsely requested an Isometric link/template while Settings
  showed the project, default template, telemetry facility, sandbox, and configured
  credentials.
- No external write-side object was created. Fresh Isometric reconciliation was blocked by
  the external sign-in page; the prior 31-entry/11-statement baseline was not re-claimed.

## Runtime evidence index

The controlled-computer run captured these screenshots outside the repository artifact
tree:

- `30-application-upload-network-error.png`
- `31-telemetry-upload-network-error.png`
- `32-removal-false-link-template-warning.png`
- `33-method-b-29-of-30.png`
- `34-method-b-30-clustered-eligible.png`
- `35-clustered-samples-still-eligible.png`

The exact durable UI evidence is reproduced in section 13 of the authoritative QA ledger,
including the sample fixture values, boundary results, guard messages, readiness output,
and settings mapping.

## Safety and reconciliation

- No cleanup was performed; all synthetic records were intentionally retained.
- No production registry was accessed.
- No database command, reset, source edit, branch, commit, push, PR, or issue was created.
- No credential, token, cookie, authorization header, signed URL, or secret was recorded.
- No Removal, GHG Entry, GHG Statement, Datapoint, Measurement Sample, Source, or telemetry
  submission was created.
