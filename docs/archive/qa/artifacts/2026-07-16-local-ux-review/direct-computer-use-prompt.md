# Direct computer-use QA mission

You are the innermost Codex CLI worker. Use your own built-in local Computer Use/browser capability to operate the running app at `http://localhost:3100` directly.

Hard execution rules:

- Do not invoke `codex`, `codex exec`, or any nested model/worker.
- Do not read or apply the `codex-computer-use` skill; its orchestration has already been performed by the parent.
- Do not spawn agents, delegate, or merely write another prompt.
- Do not reset the database. The user already reset it and the database is intentionally empty.
- Do not fetch, switch branches, or modify application source code.
- Do not submit anything to an external registry, verifier, or production service.
- Do not file issues. This is a findings-only review.
- Do not expose credentials in logs or reports. Obtain the local admin login from `.env.local` if authentication is required.

Environment:

- Repository: `/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv`
- Exact checkout: `staging` at `05272d11571ada982a950363d948c1ababfed1d3`, equal to freshly pulled `origin/staging`
- App: `http://localhost:3100`
- Database: sanitized local development database, reset once before the first computer-use pass; it is no longer empty — it now holds the two synthetic facilities noted below. Do not reset it again.
- Evidence directory: `docs/qa/artifacts/2026-07-16-local-ux-review/`
- Final findings ledger: `docs/qa/2026-07-16-qa-empty-start-ux-review.md`

Work already completed by the parent; do not repeat it:

- Signed in and swept 27 empty/static routes.
- Captured `00-empty-dashboard.png` and `01-suppliers-empty-table.png`.
- Confirmed: direct navigation can temporarily lose organization context; Suppliers/Customers/Formulations show unexplained empty skeleton tables; Samples uses inconsistent `NOMA dMRV` page title.
- Opened and validated the blank facility form, then cancelled without creating data.
- A first computer-use pass then created two synthetic facilities and began the primary facility's reactor workflow before the user requested a fresh staging pull. Inspect the current UI state and reuse those records; do not create duplicates unless required.

Now perform the remaining full browser-driven QA mission, continuing from the state left by the first pass (the two existing facilities); do not re-reset or start over from empty.

1. Create a coherent synthetic end-to-end chain through the UI only. Use obviously fictional, non-PII names. The intended chain is Facility → Reactor plus Supplier/location → pyrolysis Feedstock type → Feedstock intake/storage → Production run → Biochar product → Customer/location → Order → delivered Delivery → Application → Credit Batch → at least three Samples → Removal → GHG Statement. Production Process may be auto-created by the Credit Batch flow.
2. Exercise normal create, detail, edit, list, filter, back-navigation, and status transitions while building the chain. Verify saved values survive navigation and refresh.
3. Run focused adversarial checks without corrupting the chain: required fields, invalid GPS/ranges, zero/negative throughput, allocation exceeding intake, missing telemetry/completion, date/time boundaries, storage constraints, invalid percentages, readiness/gating messages, cross-facility context, escape/cancel behavior, and false-empty states. Prefer reversible attempts and cancel invalid drafts.
4. Create a second synthetic facility and inspect whether facility-scoped and cross-facility supplier/customer behavior is clear and safe.
5. Test the facility deletion/archive contract only if the UI provides an explicit safe path. Record the confirmation language, dependent-record behavior, and outcome. Do not delete the primary completed-chain facility unless a recoverable secondary facility is sufficient.
6. Inspect desktop and a narrow/mobile viewport for high-value screens, forms, tables, dialogs/sheets, and the chain-of-custody view. Capture screenshots for important defects and representative successful states.
7. Check visible error handling and browser console/runtime errors during the walkthrough. Record exact route and reproduction steps, but never credentials or PII.

Known issues for deduplication include readiness inconsistencies (#246), Removal/GHG expert UX (#380), Removal/GHG list metadata (#263), GHG status (#250), Credit Batch/Sample cards (#265), Credit Batch filters/false-empty (#399/#400), date shift (#46), sampling timezone (#455), back-entered Credit Batch process (#445), facility context (#253/#372), cross-facility supplier/customer (#456), certification settings mapping (#453), settings unlink (#139), onboarding (#262), chain-of-custody map (#308), date formatting/title consistency (#248), dashboard terminology (#260), and nested interactions (#256). Mark a finding as known when it clearly matches; do not open issues.

Write the final ledger at `docs/qa/2026-07-16-qa-empty-start-ux-review.md`. Include:

- Scope, exact revision, environment, and explicit statement that the database was already reset by the user. Note that the run began at `622e8bbe4a66363e2db3139f28f2af18019a6564`, was paused for a user-requested pull, and resumed at `05272d11571ada982a950363d948c1ababfed1d3`.
- Coverage matrix by route/entity and whether create/view/edit/adversarial/responsive/deletion was exercised.
- Synthetic chain summary using stable fictional identifiers only.
- Findings ordered by severity, each with route, reproducible steps, expected vs actual, impact, evidence filename, and known-issue mapping when applicable.
- Passing observations and blocked/untested areas.
- Screenshot index.
- A concise readiness verdict. Keep it a draft/local findings ledger; no external submission.

Save a short completion summary to the output path provided by the parent process. Do the browser work now; do not stop after planning.
