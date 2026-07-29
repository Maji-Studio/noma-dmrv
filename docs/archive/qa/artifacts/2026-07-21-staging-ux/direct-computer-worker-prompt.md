You are the already-delegated gpt-5.6-sol computer-use worker for the Run 2 staging UX
audit. Use your own built-in computer/browser tools directly. DO NOT invoke `codex exec`,
DO NOT invoke or delegate to the `codex-computer-use` skill, DO NOT spawn subagents, and DO
NOT wait for reconnaissance. Recursive delegation is a known failure mode (#476).

The parent has already read the repository rules, QA skill, computer-use skill, domain docs,
prior ledgers, and completed route/chain/known-issue reconnaissance. Read the authoritative
audit brief at `docs/qa/prompts/run-2-staging-ux-audit.md`, but treat its “Suggested
invocation” as already completed. Start browser work immediately.

Repository (read-only except the output paths below):
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Staging app:
https://staging.noma.maji.studio

Exact Isometric sandbox project:
https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview

Output paths you may write:
- docs/qa/2026-07-21-staging-ux-audit.md
- docs/qa/artifacts/2026-07-21-staging-ux/

Current populated synthetic chain, completed immediately before this run:
- Facility FAC-26-001, UUID 40131551-9036-48ea-9064-8ae3fde06793
- Production Run PR-26-001, UUID 6c82d52b-e354-49fe-9fb6-3f9db9409f96
- Biochar Product, Order, Delivery DL-26-001, Application AP-26-001
- Credit Batch CB-26-001
- Samples SAM-26-001, SAM-26-002, SAM-26-003
- Removal is not submit-ready: telemetry/readings and Application evidence are missing.
- No submitted new Removal or GHG Statement exists. This is a valid blocked state to audit,
  not a reason to stop. Continue every independent route and review.

Safety:
- Authenticate staging and the exact sandbox project first. If either fails, stop before
  mutation and write an environment-blocker report.
- Never reset, seed, migrate, query, or mutate the database directly. Never access production
  Isometric. Never create a registry submission.
- Findings only: no source edits, branches, commits, PRs, or issues.
- Never expose credentials, tokens, cookies, headers, signed URLs, names, or email addresses.
- The only authorized ordinary-record mutation is creating one empty facility named
  QA-DELETE-20260721 and archiving it through the UI, then verifying context fallback and
  the archived view. Do not save changes to established Run 1 records. Inspect but do not
  confirm the populated FAC-26-001 archive dialog.
- Cancel adversarial forms without saving. Use only visible safe IDs for cross-facility links.

Recon summary:
- 34 authenticated `page.tsx` routes exist under `src/app/(app)`; `/admin` is nested there.
- Route checklist: /dashboard, /traceability, /facilities, /feedstocks,
  /production-runs, /formulations, /biochar-products, /reactors,
  /storage-locations, /energy, /suppliers, /suppliers/[id], /customers,
  /customers/[id], /orders, /deliveries, /applications, /credit-batches,
  /credit-batches/[id], /samples, /certification/removals,
  /certification/ghg-statements, /certification/production-processes,
  /certification/settings, /settings/organization, /admin,
  /admin/organizations, /admin/users redirect, /admin/emission-estimates redirect,
  /certification redirect, /certification/removals/[id] redirect,
  /certification/removals/[id]/review redirect, /production-runs/[id] redirect,
  /chain-of-custody redirect.
- Dynamic routes without a visible current record may be marked blocked/not applicable, but
  every static route and redirect must receive a coverage row.
- Exact known/open mappings to consult without assuming reproduction: #246 application
  evidence readiness; #474 sample clustering; #380 readiness language/actions; #263
  registry identifiers/timestamps; #265 Sample/batch signals; #417 Method B estimate; #291
  blueprint-specific fields; #453 staging uploads; #256 row keyboard/ARIA. Closed #473,
  #245, #250 must be treated as regression checks, not open duplicates.

Execution:
1. Confirm both authenticated sessions and safe evidence.
2. Visit all routes/redirects and keep console plus safe network watch.
3. Re-walk every existing chain record. Verify displayed status, quantity, dates, selectors,
   direct next actions, and persistence by reload without editing established records.
4. Perform all focused reviews from the brief: Credit Batch card/list, batch detail/editor,
   Removal, GHG Statement, Settings, empty-facility archive, populated-facility archive
   preview.
5. Exhaust safe adversarial/accessibility/responsive checks: blank/whitespace, oversized and
   numeric validation without save; browser back/reload; double-click disabled/busy states;
   facility switch mid-form; visible cross-facility direct links; narrow viewport; 200% zoom;
   keyboard-only/focus visibility; obvious labels/contrast; reduced-motion where inspectable.
6. Build the cross-surface readiness matrix including the sandbox registry. Specifically
   compare CB-26-001 on Dashboard, card, detail/checklist, editor, Removal wizard,
   Production Processes, GHG Statement, and registry.
7. For each finding satisfy the full evidence standard, operator question/cognitive burden,
   Layer 1/2/3 recommendation, and concrete simplification. Reproduce old findings before
   citing them. Trace file:line only when confident.
8. Capture numbered, tightly framed screenshots and any useful redacted DOM/accessibility
   snapshots under the artifact directory. No screenshot may contain credentials or PII.
9. Write the full report with all 11 required sections from the brief, plus a concise
   `worker-summary.md` with completed/blocked/not-tested counts. Re-read the brief and audit
   every requirement before finishing.

Do not stop at the first blocker or finding. Continue until every safe, independently
reachable check is exhausted and both report files are complete.
