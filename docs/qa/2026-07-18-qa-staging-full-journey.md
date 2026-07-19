# Staging QA — 2026-07-18

Scope: visible-UI staging verification in the authorized QA organization/facility. No code fixes, database access, direct API calls, external registry submissions, or GitHub changes were made.

## Executive summary

The existing synthetic chain is visible through a credit batch with one production run, one application, and three eligible lab samples. Certification correctly fails closed: the batch identifies missing telemetry and boundary-logbook evidence, and the facility is not linked to an Isometric project. A removal and GHG statement could therefore not be submitted.

The largest operator gap is facility-context reliability. Direct navigation to a URL carrying a valid `facility` query repeatedly rendered “Select a facility”; expanding the organization selector later restored the same facility and populated the page. This prevents a dependable end-to-end operator journey and made the requested creation/adversarial passes unsafe to complete.

## Findings ledger

| Area | Severity | Type | Reproduction | Expected vs actual | Suggested fix |
|---|---|---|---|---|---|
| Facility context | P1 | Engineering / UX | Open an authenticated entity URL with the valid QA `facility` query; wait for render. Repeat on dashboard, feedstocks, runs, products, orders, deliveries, applications, batches, samples, energy, CoC and certification. | Expected the facility to resolve from the URL. Actual: most routes showed “Select a facility”; expanding the organization switcher later restored the facility and data. | Make URL facility resolution authoritative before empty-state rendering and preserve it across direct navigation. Add a staging E2E regression. |
| Removal route | P1 | UX / Engineering | With QA facility context active, open `/certification/removals?facility=…` and wait four seconds. | Expected removal list or an actionable registry gate. Actual: main content remained blank in the observed pass. | Render a deterministic loading/error/gated state and instrument the failed transition. |
| Certification readiness | P2 | UX | Open the existing credit-batch detail. | Expected one coherent readiness result. Actual: “3 of 3 usable” and “Eligible” coexist with “Clustered on one run/day”; checklist separately blocks telemetry/evidence but the sampling contradiction is easy to misread. | Make certification eligibility status explicitly incorporate independent-sampling distribution. |
| GHG navigation | P2 | UX | Open GHG statements for the unmapped QA facility. | Expected an actionable GHG-specific gate. Actual: redirected to general certification settings, which says the facility is not linked. | Preserve task context and provide a return path plus exact prerequisite. Likely overlaps issue #380. |
| Computer-use runner | P3 | QA infrastructure | Invoke the repository `$codex-computer-use` flow with full browser permission. | Expected browser control. Actual: CLI recursively invoked itself and never reached a browser. | Prevent recursive skill invocation and expose the browser surface directly. |

## Confirmed acceptance results

- PASS: Authentication and admin route guards were reachable in the authorized role.
- PASS: 27 static/legacy routes were visited; legacy admin routes redirected as designed.
- PASS: Existing credit-batch detail loaded, showed one run and three samples, and persisted the July 17 date after navigation.
- PASS: Removal/GHG submission failed closed because registry mapping and source evidence were incomplete.
- PASS: No console warnings/errors were captured in the observed tab.
- FAIL: Facility context did not reliably resolve from valid URLs.
- FAIL: Removal route did not produce a usable visible state in the observed pass.
- BLOCKED: New supplier/customer creation through the entire downstream chain, duplicate-submit, parent/child deletion, facility-switch authorization checks, keyboard/tablet pass, and actual removal/GHG submission. Continuing would not have produced a coherent serial workflow once context detached.

## Evidence

- [Credit-batch loading screenshot](./artifacts/2026-07-18-staging-full-journey/sanitized-credit-batch-readiness.png) — main-content-only crop showing the detail shell and asynchronous readiness/sample loading state; the completed values are recorded from the later DOM observation.
- [GHG gate screenshot](./artifacts/2026-07-18-staging-full-journey/sanitized-ghg-gate.png) — main-content-only crop showing the registry setup gate.
- [Computer-use assignment](./artifacts/2026-07-18-staging-full-journey/computer-use-assignment.md)

No screen recording was available. Full-page captures were deleted after independent review found incidental account PII in the sidebar; only sanitized main-content crops are retained.

## Proposed issues — triage outcome (2026-07-19)

1. P1: Resolve active facility from URL before rendering facility-gated pages — **filed as #473**.
2. P1: Blank removal main content — **already fixed on staging**: `RemovalsList` always renders header plus error/loading/empty states; the observed blank was a downstream symptom of the stuck facility context, folded into #473's regression test.
3. P2: Reconcile “eligible” sample messaging with independent-distribution requirements — **filed as #474**.
4. P3: Stop recursive Codex computer-use invocation — **filed as #476** (QA infrastructure).

GHG navigation (P2): largely addressed by the inline gate in `ghg-statements-list.tsx`; the remaining clickable-link/return-path residual is **commented on epic #380** rather than filed separately.

Dedup notes: #246 is the evidence-document readiness split (adjacent to #474, not a duplicate); #253 is cross-facility reconciliation (related to #473, distinct root cause); durability date boundaries were covered by #455, closed via PR #466.
