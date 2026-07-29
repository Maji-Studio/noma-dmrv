# Console and network ledger — QA-B `d3f5`

Monitoring ran for the isolated Playwright context through organization setup, the full entity chain, lifecycle/stock attacks, Traceability and dashboard. The driver emitted browser console warning/error, page-error and HTTP response events with status ≥400.

## Network failures

| Phase | Route | Status | Count / outcome |
|---|---|---:|---|
| Preflight before concurrent fix | `GET /login` | 500 | 9/9; Tailwind-generated CSS parse failure. See QA-B-D3F5-001. |
| Post-restart authenticated run | All visited routes and uploads | No emitted ≥400 response | No browser-observed HTTP 4xx/5xx event in the operational pass. Server-action validation errors arrived as handled UI results. |

## Console warnings

Repeated warning, no functional crash:

```text
The resource .../_next/static/css/app/layout.css?... was preloaded using link preload but not used within a few seconds from the window's load event.
```

The same warning appeared for the dashboard page stylesheet once. This is P3 performance/noise, not a data-integrity finding.

## Page errors

- No uncaught browser `pageerror` event was emitted in the completed operational pass.
- The Traceability Map reported WebGL renderer unavailability in its own UI and provided the intended transport-rail fallback; no uncaught exception was emitted.

## Handled application failures captured in UI

- Feedstock allocation warning after saving excess mass.
- Production readings import failed after file upload; the run/document remained and edit mode exposed retry.
- Stock overdraw rejected with available and requested dry mass.
- Reactor overlap rejected with a conflicting run.
- Lifecycle validations rejected Running-with-end, Complete/Failed-without-end and Cancelled-without-reason.
- Linked-product and descendant guards rejected reopening/deleting `PR-26-001`.

These were server-action/domain results, not raw failing HTTP responses.

## Concurrent development-server effects

- Several client navigations took 20–45 seconds while the shared Next server recompiled under concurrent QA threads.
- A few Playwright reads saw “execution context was destroyed” during expected navigation/HMR replacement; commands were retried after the destination rendered.
- Dashboard initially showed “Select a facility” despite a correct query parameter and `noma:selected-facility-id`; one reload restored the facility and data. This is recorded as a non-scored environment observation because it coincided with development-mode rendering.
- No second server was started and no reset, migration, global teardown or broad cleanup command was run.

## Secret handling

The driver read login values locally, entered them only in the UI, redacted email/password input values from snapshots, and did not write them to Markdown or console logs. Credential values are not present in the text artifacts.
