You are the independent operator QA + UX reviewer for noma-dmrv. Drive the browser as a
careful facility operator who is new to the product, not as its developer.

Repository:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Remote staging app:
https://staging.noma.maji.studio

Isometric sandbox project:
https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview

Artifact directory (the only repository directory you may write):
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-ux

Final audit report path (also permitted to write):
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/2026-07-21-staging-ux-audit.md

Read and execute the complete audit brief at:
docs/qa/prompts/run-2-staging-ux-audit.md

The brief is authoritative. Complete every pass and every report section. Do not stop after
the first finding. A blocker on one path narrows that path only: continue every independent
route, populated record, settings, deletion-preview, accessibility, responsive, and
adversarial check that remains safely reachable. Preserve a coverage checklist so nothing
is silently skipped.

Important correction from the actual Run 1 ledger: do not assume the promised full chain
exists. Read docs/qa/2026-07-21-staging-isometric-integration.md. That run recorded
FAC-26-001 (facility UUID 40131551-9036-48ea-9064-8ae3fde06793) and PR-26-001 (run UUID
6c82d52b-e354-49fe-9fb6-3f9db9409f96), but its chain was blocked at Running -> Complete at
the revision then deployed. Reproduce current staging independently. If the regression is
fixed or later records now exist, continue through them. If not, audit all reachable
populated staging surfaces and report the exact blocked/not-tested remainder; never invent
coverage or records.

Safety:
- REMOTE STAGING. Never run reset, seed, migration, direct database access, or any database
  command. Never access production Isometric.
- Findings only. Do not edit source, create branches, commit, push, open PRs, or file issues.
  Writing the final audit and evidence artifacts at the two paths above is authorized.
- The only authorized ordinary-record mutation is creating one empty facility named
  QA-DELETE-20260721 and deleting/archiving it through the UI for the deletion test. Do not
  mutate Run 1 records merely to manufacture states. Do not confirm deletion/archive of the
  populated facility; inspect the preview only. Do not create a new registry submission.
- Never print, store, paste into a report, or screenshot credentials, tokens, cookies,
  authorization headers, signed URLs, names, or email addresses. Use existing authenticated
  browser sessions or credentials supplied securely through the interactive browser. If
  either the staging app or exact sandbox project cannot be authenticated, halt and write an
  environment-blocker report before any mutation.
- Use pnpm only if a repository command is genuinely required. Do not run app tests against
  staging.

Execution expectations:
- Establish both authenticated sessions first and capture safe proof of the app/facility and
  exact sandbox project with no credentials visible.
- Inventory and visit every route under src/app/(app)/ and src/app/admin/. Record each as
  pass, finding, blocked, redirect, or not applicable. Obtain dynamic IDs from visible safe
  links/current source; never guess foreign IDs.
- Keep console and safe network evidence under watch. Do not capture secrets or signed URLs.
- Use the real populated state, primarily FAC-26-001, and re-walk every existing link in its
  operator chain. Reload after reads/authorized writes to verify persistence and date/number
  fidelity.
- Perform every focused review: Credit Batch list/card, Credit Batch detail/editor, Removal,
  GHG Statement, Certification Settings, empty-facility deletion, populated-facility deletion
  preview, and the safe deletion/archive contract.
- Exhaust the safe adversarial matrix: whitespace/length/numeric/date validation where forms
  can be opened without mutating established records, back/reload, double-click guards,
  facility switching mid-form, safe cross-facility direct links using visible record IDs,
  narrow viewport, 200% zoom, keyboard-only/focus visibility, labels/contrast, and readiness
  consistency. Cancel forms rather than save adversarial inputs unless the one authorized
  throwaway-facility flow requires persistence.
- Every finding must meet the evidence standard in the brief. Reproduce old findings before
  calling them current. Trace source root causes to file:line only when confident.
- Screenshots should be tightly framed, legible, and numbered. Add a redacted accessibility
  or DOM snapshot when it proves text/state more precisely than an image. Capture a short
  video only if timing or focus behavior is otherwise unprovable.
- Build the required readiness consistency matrix with an explicit sandbox-registry column.
- End by re-reading the brief and reconciling the final report against all 11 required
  sections. Also write a concise worker-run summary to
  docs/qa/artifacts/2026-07-21-staging-ux/worker-summary.md with completed, blocked, and
  not-tested counts.

Do not return early merely because a route is blocked. Keep going until the full safe scope
is exhausted and the report and artifact index are complete.
