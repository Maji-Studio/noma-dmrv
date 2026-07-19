# Staging full-journey QA assignment

Repository: `$REPO_ROOT`

Staging URL: `https://staging.noma.maji.studio`

Artifact directory: `$REPO_ROOT/docs/archive/qa/artifacts/2026-07-18-staging-full-journey`

## Authentication and safety

- Read `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env.local` in the repository root and enter them only in the visible login form. These are the user-authorized staging QA credentials. Never expose their values.
- Never print, persist, screenshot, or include credentials in any report. Do not include personal names or email addresses in screenshots or prose. Redact any incidental PII before saving evidence.
- Use only staging and only a facility already clearly designated/configured for QA. If more than one qualifies, choose the one whose name most clearly indicates QA/testing and record only its stable facility ID or a sanitized alias.
- Create uniquely prefixed synthetic records (`QA-20260718-...`). Do not modify/delete non-QA records. Do not reset staging, inspect its database directly, call application APIs directly, change code, file GitHub issues, or submit anything outside the test tenant.
- Drive everything through one serial visible browser session as an operator. Do not substitute source inspection or direct HTTP/API requests for UI verification.
- Keep browser console and network activity observed when supported. Save only sanitized relevant evidence.
- Capture a screenshot after every important transition and every finding. If supported, record the primary happy-path journey as a screen capture; otherwise explicitly record that limitation.
- Continue through recoverable friction. Do not guess when an action could affect real/non-QA data.

## Canonical workflow and expected outcomes

Canonical chain: Facility -> Reactor -> Feedstock Delivery/Intake -> Feedstock -> Production Run -> Biochar Product -> Order -> Delivery -> Application -> Credit Batch -> Sample. Supplier/location and Customer/application-location are required side branches. Production Process is the facility+feedstock sampling-regime prerequisite for certification.

Use the visible UI to create or reuse prerequisites in this order, preferring Quick-Add where offered: active QA facility; supplier and supplier location; customer and customer application location; reactor; storage/feedstock and output bins; pyrolysis feedstock type; feedstock intake allocated to a bin; production process; production run with complete quantities/energy/readings when the UI supports them; biochar product; order; delivery; application and required evidence; credit batch containing the matching run; at least three independent samples when feasible; removal; GHG statement.

At each created entity verify: success feedback; it appears in its list; its detail route/panel opens; dependent dropdowns immediately contain it; values and dates persist after reload; facility context remains correct; and the Chain of Custody DAG, Map, Sankey, lineage/split/trail surfaces show the expected upstream/downstream relationships.

Expected domain checks include: pyrolysis vs blend feedstock usage stays distinct; intake creates usable stock; complete run has end after start and valid wet mass/moisture/output/energy; order quantity is positive and within stock; delivery dry mass does not exceed wet mass; application evidence/soil-temperature requirements are explicit; credit batch is one feedstock, matching facility, at least one matching run, and no longer than one month; sampled batches require at least three usable independent replicates; eligibility ratios are H/C_org < 0.5 and O/C_org < 0.2; certification routes fail closed until facility registry mapping exists; removal submission names actionable prerequisites; GHG statement creation/submission requires submitted eligible removals and production confirmation.

## Pass 1: cold start and navigation

Visit every operator-facing route below in the current authorized admin role. For dynamic routes, use a QA record created during this session when available; otherwise verify the route's safe invalid/not-found behavior. Capture confusing, broken, empty, loading, error, redirect, and permission states.

Routes: `/dashboard`, `/facilities`, `/reactors`, `/storage-locations`, `/suppliers`, `/suppliers/[supplierId]`, `/customers`, `/customers/[customerId]`, `/feedstocks`, `/formulations`, `/production-runs`, `/production-runs/[productionRunId]`, `/biochar-products`, `/orders`, `/deliveries`, `/applications`, `/credit-batches`, `/credit-batches/[id]`, `/samples`, `/energy`, `/chain-of-custody`, `/settings/organization`, `/certification`, `/certification/settings`, `/certification/production-processes`, `/certification/removals`, `/certification/removals/[removalId]`, `/certification/removals/[removalId]/review`, `/certification/ghg-statements`, `/admin`, `/admin/organizations`, `/admin/emission-estimates`, `/admin/users`.

Acceptance: no unexplained crash/500; loading resolves; empty states explain the next action; legacy routes redirect safely; invalid dynamic IDs fail closed; admin routes respect role; certification routes redirect/gate when registry prerequisites are absent; no PII appears in evidence.

## Pass 2: complete operator journey

Complete the entire chain above through the visible UI. Verify every created entity in list, detail/panel, dependent dropdowns, and traceability views. Exercise Quick-Add when available and confirm it seeds the invoking dropdown. Capture every major transition and record the primary happy-path workflow if supported.

Acceptance: all stages can be completed or are blocked only by a clear, legitimate external registry/evidence prerequisite; state survives navigation/reload; dates do not shift; masses/units/statuses are intelligible; facility context carries through; DAG/Map/Sankey/trail match the created lineage; removal and GHG statement reach submitted completion or a correctly fail-closed, actionable gate.

## Pass 3: adversarial

Within safe QA records, test empty and whitespace-only values; oversized text; negative, zero, non-numeric and out-of-range numeric input; percentages outside 0..100; ratios and mass relationships; timezone-edge dates followed by save/reload; duplicate/double submit; refresh/back mid-form; stale list/detail state; safe attempted deletion of a QA parent with QA children; facility switching; and cross-facility deep links using only IDs already visible and authorized in this QA session. Never probe or enumerate unknown IDs.

Acceptance: specific recoverable validation; entered data retained after errors; no duplicate records; dates stable; parent/child integrity preserved; stale state reconciles; cross-facility data fails closed or canonicalizes safely; consequential actions are distinct and confirm intent.

## Pass 4: operator UX

Repeat the critical supplier -> intake -> run -> product -> order -> delivery -> application -> credit batch -> samples -> removal/GHG path with an explicit usability and tablet/keyboard lens. Assess discoverability of next step, terminology and units, prerequisite explanation before blocking, facility-context continuity, validation specificity, retention after errors, draft/ready/submitted/blocked status clarity, distinction of consequential actions, keyboard focus/labels, and tablet usability. Capture each meaningful friction even when technically passing.

## Required reports

Write one report per pass in this artifact directory: `pass-1-cold-start.md`, `pass-2-complete-journey.md`, `pass-3-adversarial.md`, and `pass-4-operator-ux.md`. Also write `computer-use-summary.md`.

Every pass report must contain:

- Steps performed.
- Routes and roles tested.
- Observed versus expected behavior.
- Pass/fail for every acceptance check.
- Absolute screenshot path and one-line sanitized caption for every key step/finding.
- Exact reproduction steps for every problem.
- Relevant sanitized console/network evidence.
- Anything blocked or uncertain.
- UX friction even when the feature technically passed.

The summary must provide: severity-ranked candidate findings (P0-P3); coverage checklist for every route and chain entity; created QA record aliases/IDs without PII; removals/GHG final state; recording path or limitation; and an explicit list of untested/blocked checks. Evidence is observation, not authority: distinguish confirmed visible behavior from inference.
