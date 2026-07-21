Continue the authenticated staging × Isometric sandbox QA run documented in:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/2026-07-21-staging-isometric-integration.md

Repository:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Artifact directory:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric

The user reports that GitHub issue #498, the Running-to-Complete production-run defect,
has been resolved. Resume the same synthetic chain in the staging UI at PR-26-001. First
verify that the deployed staging app now persists the transition with End Date 2027-12-02
and End Time 16:00. If staging has not deployed the fix, investigate safe UI alternatives
and keep testing every reachable surface; document the deployment/blocker precisely rather
than stopping at the first failure.

If the transition succeeds, continue autonomously through every remaining reachable step:
Biochar Product, Order, Delivery, Application, Credit Batch, required Samples, Removal /
Isometric GHG Entry, and GHG Statement. Reconcile every new external object against the
exact sandbox project. Exercise validation, reload/retry, selector refresh, readiness,
idempotency, and operator-facing messaging where safe. Keep going through secondary
problems whenever any safe path remains.

Record ALL observations: confirmed fixes, defects, transient states, confusing copy,
missing prerequisites, untested surfaces, environment limitations, console/network errors,
and app-to-registry mismatches. Every finding needs route, exact steps/input, expected,
actual, frequency, impact, and evidence. Save new screenshots/evidence in the artifact
directory with sequential names beginning at 12. Update the existing ledger in place,
clearly separating the continuation from the initial run and changing the executive verdict
only when evidence warrants it. Write your final operator summary to:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric/continuation-report.md

Safety and scope:
- Use only https://staging.noma.maji.studio and the exact Isometric sandbox project already
  documented in the ledger. Never access production Isometric.
- You may create obviously synthetic records through the staging UI and submit them to the
  documented sandbox project.
- Use the existing authenticated browser sessions or credentials securely available to the
  computer-use environment. Never print, log, screenshot, or save credentials, cookies,
  tokens, authorization headers, or signed URLs.
- Do not run database reset/push/mutation commands. Do not edit application source code.
  Do not create branches, commits, PRs, or GitHub issues.
- Findings only. Do not fix code.
- Before new Isometric reasoning or calls, invoke the connected Isometric MCP how_to tool.
- If file attachment remains unavailable, document it and continue all non-upload paths.
- Do not stop merely because one stage fails. Explore all safe, independently reachable
  routes and controls, note every observation, and stop only when no meaningful safe test
  remains.

At completion, perform a credential/secret scan of Markdown artifacts without printing any
suspected values, confirm no source files changed, close browser automation cleanly, and
report the final verdict plus all files written.

## Execution contract for this continuation

You are the sole serial browser operator for this run. Work autonomously until no meaningful
safe route remains. Do not stop at the first failed stage. Use local code only as read-only
orientation when a UI label or prerequisite is unclear; never edit application source.

Before any new Isometric interpretation or API/MCP call, invoke the connected Isometric MCP
`how_to` tool. Record only that it was invoked and any non-sensitive operational guidance;
never record credentials, cookies, authorization headers, signed URLs, or secret values. If
the MCP is unavailable, record the exact non-sensitive availability error and do not make
direct registry calls; continue staging UI tests and any already-authenticated sandbox UI
reconciliation that is safely possible.

Browser target and safety boundary:

- staging app only: `https://staging.noma.maji.studio`
- registry only: Isometric sandbox project `prj_1K9YJ33RKSBX9FFF`
- never open or call production Isometric
- use the existing authenticated browser profile/session if available; otherwise use securely
  available credentials without printing or saving them
- do not expose raw request headers, cookies, tokens, signed upload URLs, or credential fields
  in screenshots, reports, terminal output, or accessibility snapshots

Start at production run `PR-26-001` (app ID
`6c82d52b-e354-49fe-9fb6-3f9db9409f96`, facility ID
`40131551-9036-48ea-9064-8ae3fde06793`). Verify persisted Running → Complete with End Date
`2027-12-02` and End Time `16:00`; reload and verify the stored values/status. Capture evidence
as `12-...`. If not deployed, try only safe UI alternatives (refresh/reopen, date then time,
time then date, status last, keyboard-driven change/blur) and then visit every independently
reachable downstream route/control.

If complete succeeds, use clearly synthetic names/codes continuing the `QA-20260721` /
`*-26-001` convention and drive Product → Order → Delivery → Application → Credit Batch →
required Samples → Removal/GHG Entry → GHG Statement. Reuse the existing known-good input
sheet in this directory, but treat the live linked 1000-year template and Isometric guidance
as authoritative when they differ. Never invent registry mappings or IDs. For each stage:

1. inspect required fields and operator guidance;
2. exercise at least one safe validation or missing-prerequisite case where useful;
3. submit once, guard against duplicates, wait for completion, then reload/reopen;
4. verify list/detail presence and downstream selector refresh;
5. capture console errors and safe network method/path/status information if available, with
   sensitive URLs/headers redacted or omitted;
6. record exact route, steps/input, expected, actual, frequency, impact, and evidence;
7. if blocked, continue every other safe route or secondary control.

For Isometric write paths, reconcile each new external object against only
`prj_1K9YJ33RKSBX9FFF`. Record safe object IDs and visible status/field matches. Exercise
readiness, retry/reload, selector refresh, and idempotency without deliberately creating
duplicates. If a submit appears ambiguous, reload/reconcile by stable supplier reference or
visible external ID before retrying.

File upload may be unavailable. Test attachment capability once without exposing local paths
or secrets; if unavailable, document it and continue all non-upload paths. Do not manufacture
upload success.

Evidence requirements:

- save new screenshots or sanitized text evidence in the existing artifact directory with
  sequential numeric prefixes starting at `12-` and never reuse 01–11
- keep a working report at
  `docs/qa/artifacts/2026-07-21-staging-isometric/codex-continuation-report.md`
- list each created app record and external sandbox object, including IDs when safely visible
- note all transient states, confusing copy, missing prerequisites, untested surfaces,
  environment limits, console/network errors, and app↔registry mismatches
- do not edit the main ledger or final `continuation-report.md`; the parent agent will inspect
  your evidence and write those files

Finish by closing only browser windows/tabs or automation that you opened (do not disrupt
unrelated user tabs). In your worker report state whether browser automation closed cleanly,
whether Isometric `how_to` ran, the highest evidence number used, and every file you wrote.
