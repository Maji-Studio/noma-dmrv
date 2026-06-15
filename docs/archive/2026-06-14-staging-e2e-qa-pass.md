# Staging E2E QA Pass — 2026-06-14

Browser-based QA against the **deployed staging** environment
`https://staging.noma.maji.studio` (admin session). Goal: sweep every reachable
route, exercise the operator workflow, and probe edge cases for UX + engineering
issues, including the Isometric certification path.

## Method & safety

- Authenticated via the normal Better-Auth email sign-in (no auth bypass). One
  sign-in, session reused (staging has rate limiting). **Credentials were not
  written to any file or committed.**
- Driven with a headless Chromium script (the repo's `pnpm test:e2e` config
  hard-blocks non-localhost, by design — so this used a manual driver, not the
  test runner).
- **Isometric environment confirmed SANDBOX** (Settings banner: "SANDBOX ·
  ISOMETRIC REGISTRY — Changes don't reach the verifier"). No production-registry
  calls were made.
- Active facility: **Arusha Green Energy Hub** (`FAC-26-002`,
  `de00…1001`), Isometric-linked (project `Tanzania biochar`, template
  `rvt_1KS4S43VPSBXA26X`, telemetry disabled).
- **Test data:** one supplier was created and then deleted; staging verified
  clean afterward (0 rows). No other mutations persisted.

## Scope & limitations (read this)

- **Non-mutating coverage was thorough** (all routes, states, auth, validation
  gating, broken-state handling, Isometric gating).
- **CRUD lifecycle** verified on one entity (supplier create → list → delete).
- **The full 13-entity chain → removal → GHG-statement submission was NOT run
  end-to-end.** Scripting that blind against a remote app (custom EntitySelects,
  maps, file uploads, multi-step wizards) is fragile and would add churn to a
  shared environment mid-promotion (PR #261). The GHG flow was assessed via its
  gating, empty states, wizards, and the readiness model instead. Completing the
  full chain is best done in a maintained Playwright spec or a manual session —
  see Recommended fixes.

## Tested routes (all 200 / reachable, admin)

`/dashboard` · `/facilities` · `/chain-of-custody` · `/feedstocks` ·
`/production-runs` · `/formulations` · `/biochar-products` · `/reactors` ·
`/storage-locations` · `/energy` · `/suppliers` · `/customers` · `/orders` ·
`/deliveries` · `/applications` · `/credit-batches` · `/samples` ·
`/certification/settings` · `/certification/removals` ·
`/certification/ghg-statements` · `/admin` · `/admin/users` ·
`/admin/emission-estimates` (→ redirects to `/certification/settings`, expected).

## Tested workflows

- **Auth gating** — logged-out access to `/dashboard`, `/admin`,
  `/certification/removals` → all redirect to `/login?from=<path>`. ✅
- **CRUD lifecycle** — supplier create (name + required GPS) → appears in list →
  row `⋮` → Delete → confirm dialog → removed from list. ✅ (self-cleaned)
- **Form validation** — empty facility-create submit → 6 "required" errors, form
  stays open (no submit). ✅
- **Certification/Isometric** — Settings shows linked project + sandbox banner;
  Removals + GHG Statements render (both empty here) with correct enable/gating;
  `/admin/emission-estimates` consolidates into Settings.

## Edge cases attempted

Auth: logged-out route access; admin route while logged out. Broken state:
non-existent entity IDs on `/credit-batches/[id]`, `/customers/[id]`,
`/production-runs/[id]`. Validation: empty-form submit. Create/Delete: full
supplier lifecycle. (Planned but not executed end-to-end: numeric boundary/int
overflow, moisture >100, GPS one-coordinate, date end<start, long/HTML strings,
yield>100%, allocation>delivery, period overlap, full chain → GHG submit.)

## Bugs found

| # | Severity | Area | Issue |
|---|---|---|---|
| B1 | **P2** | customers / detail routes | **→ filed as #266.** A non-existent/inaccessible **customer ID hangs forever on "Loading customer details…"** — no not-found or empty state; page header and facility selector never render. Inconsistent with `/credit-batches/[id]` (renders a 404 inside app chrome) and `/production-runs/[id]` (redirects to the list). Likely the same on `/suppliers/[id]`. An operator following a stale/deleted link gets a dead screen. |
| B2 | P3 | production-runs | `/production-runs` emits a **background `404` resource** on load (page itself renders fine). Likely a detail-route prefetch or an API call returning 404 — verify in network panel. |

## UX issues found

- **U1 (P3, tables):** the certification-readiness column is still labeled
  **"Certifier"** on staging (it shows a *readiness* pill, not a person). Already
  fixed → "Certification" on branch `fix/ux-navigation-table-review` (commit
  `e55e023`); just not yet on staging.
- Broken-state UX is **inconsistent across detail routes** (404-in-chrome vs
  redirect vs infinite-load) — pick one pattern (see B1).

## Engineering risks found

- **E1 (P3, dashboard/map):** the dashboard MapLibre map **failed to initialize**
  (`WebGL context` error) in headless Chromium. Most likely a headless-GPU
  artifact, but if it reproduces in real browsers on low-end/no-GPU clients it
  needs a graceful fallback (static map / message) rather than a console error.
  **Verify in a real browser before acting.**
- **E2 (process):** the repo's E2E runner forbids non-localhost on purpose;
  there is no maintained automated E2E that exercises staging/prod safely. The
  full create→GHG chain therefore has no automated guard.

## Recommended fixes

1. **B1** — add a not-found/empty state to the customer detail route (and audit
   supplier detail + other `[id]` routes) so a missing record resolves to a clear
   "not found" with a back-to-list action, not perpetual loading. Standardize the
   broken-state pattern across all detail routes.
2. **B2** — inspect the `/production-runs` 404 (network tab); if it's a prefetch
   of a detail route that 404s, fix the link target or the route.
3. **E1** — confirm the map error in a real browser; if real, add a WebGL-absent
   fallback.
4. **Full GHG chain** — add a maintained Playwright spec (or a documented manual
   script) that builds facility→…→removal→GHG statement against the **sandbox**,
   so this flow has a repeatable guard.

## Suggested owner areas

- B1 / broken-state standardization → **customers + shared detail-route shell**
- B2 → **production-runs**
- E1 → **dashboard / map (MapLibre integration)**
- E2 / GHG chain spec → **certification + QA tooling**

## Positive confirmations

Auth gating solid; form validation blocks bad submits; Isometric correctly
sandboxed and gated; credit-batch/production-run broken-state handling graceful;
CRUD create+delete clean with confirm dialog; all 23 routes reachable.
