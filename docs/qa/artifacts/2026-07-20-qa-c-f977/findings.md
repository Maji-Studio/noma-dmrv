# QA-C findings — 2026-07-20 (`f977`)

Scope: browser-driven adversarial certification QA against the shared localhost server. Namespace: `QA-C-20260720-f977`.

## P1 — resolved during pass: Tailwind scanned an invalid documentation candidate and blanked every route

- **Route:** `/login` and therefore every application route
- **Setup:** fresh isolated in-app browser session, before authentication
- **Exact action/input:** navigate to `/login`, wait, inspect the blank DOM and console, then reload
- **Expected:** visible sign-in form
- **Actual:** blank page; Next/Turbopack rejected generated CSS containing `border-radius: var(--radius-*);`
- **Repeatability:** 2/2 before the fix; 1/1 successful login render after the fix
- **Evidence:** [`screenshots/001-login-compile-blocker.jpg`](screenshots/001-login-compile-blocker.jpg), [`console-network.md`](console-network.md)
- **Likely root cause:** the former literal arbitrary-class example at [`docs/design-system.md:35`](../../../design-system.md#L35) was discovered by Tailwind v4's source scanner. The generated selector matched that documentation text exactly; Tailwind is imported at [`src/app/globals.css:1`](../../../../src/app/globals.css#L1).
- **Resolution in this pass:** with explicit user authorization, the documentation sentence was rewritten so it still warns about the wildcard token without containing the invalid Tailwind candidate. `/login` then rendered with zero console errors. No product code changed.
- **Dedup:** no matching GitHub issue was found; none was created.

## P2 — deferred readings import hides the actionable cause until the operator retries

- **Route:** `/production-runs?facility=c8554eda-7aca-476a-94ad-96155dcff7e5`
- **Setup:** QA-C facility, reactor, feedstock bin, biochar bin, and completed feedstock intake; new run `PR-26-001` created as `Running` with no end time and with `qa-c-upload.csv` attached
- **Exact action/input:** create the run with a CSV whose timestamps fall after the start; inspect the creation result; then click `Re-import`
- **Expected:** the first failed import state explains that an open run has no end time and tells the operator to complete it before importing
- **Actual:** the creation banner only said `Production run created, but 1 readings file could not be imported. Resolve it below.` The document row only said `Import failed`. The specific remediation — `Run PR-26-001 has no end time yet — set the run's end time before importing readings` — appeared only after clicking `Re-import`.
- **Repeatability:** 1/1 create-path failure; the retry consistently exposed the stored reason
- **Evidence:** [`runtime/raw-browser-report.md`](runtime/raw-browser-report.md), [`runtime/action-log.md`](runtime/action-log.md)
- **Likely root cause:** [`src/components/production-runs/production-run-list.tsx:262`](../../../../src/components/production-runs/production-run-list.tsx#L262) catches and counts import exceptions but discards their messages, then emits generic copy at lines 286–292. The precise server message exists at [`src/data-access/production-run-reading-imports.ts:60`](../../../../src/data-access/production-run-reading-imports.ts#L60).
- **Dedup:** adjacent to #453's CSV-storage verification scope; no new issue was created per the brief.

## P3 — direct facility-scoped navigation flashes a false “Select a facility” gate

- **Route:** direct navigation to `/certification/removals?facility=c8554eda-7aca-476a-94ad-96155dcff7e5`; independently repeated on `/production-runs?facility=…`
- **Setup:** signed-in QA-C organization with one active QA-C facility selected
- **Exact action/input:** open the full facility-scoped URL in a new isolated tab and inspect immediately, then again after context hydration
- **Expected:** honor the explicit facility query parameter while loading and show either a loading state or the correct configuration redirect; do not claim that no facility is selected
- **Actual:** the page first rendered `Select a facility` and sidebar links without the facility parameter. About four seconds later the same tab rehydrated the correct facility; the removal route then reached the certification Settings gate.
- **Repeatability:** 2/2 direct full navigations
- **Evidence:** [`runtime/raw-browser-report.md`](runtime/raw-browser-report.md), [`readiness-consistency-matrix.md`](readiness-consistency-matrix.md)
- **Likely root cause:** [`src/components/navigation/facility-provider.tsx:57`](../../../../src/components/navigation/facility-provider.tsx#L57) reads the URL but [`facility-provider.tsx:158`](../../../../src/components/navigation/facility-provider.tsx#L158) resolves it to `null` until the asynchronous facilities query proves membership. Facility pages immediately render [`select-facility-empty-state.tsx:27`](../../../../src/components/navigation/select-facility-empty-state.tsx#L27) rather than distinguishing loading from absent selection.
- **Dedup:** related to open #473; do not file a duplicate.

## Environmental stop

After the operator selected `Complete`, entered an end date/time, and pressed `Save Changes`, the browser driver timed out. A new browser navigation timed out and an independent read-only probe confirmed that nothing was listening on `localhost:3100`. The brief forbids starting or restarting the shared server, so persistence, CSV re-import, and every downstream certification branch were stopped. This is recorded as a blocker, not attributed to the save action as a product defect.

## Release confidence

**Low for certification release.** The configuration gate and a partial operational chain were verified, but the high-integrity application-evidence, sample-distribution, Method A/B, removal, and GHG paths were not reached.

The most serious certification-integrity risk remains open issue **#417**: the unsampled Method-B conservative-estimate failure may not be consumed by the removal submission gate. That conclusion is from current code/GitHub reconnaissance, not a browser reproduction in this interrupted run.
