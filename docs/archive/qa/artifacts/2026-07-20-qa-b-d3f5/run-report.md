# QA-B run report — `d3f5`

## Scope and isolation

- Date: 2026-07-20, Europe/Zurich.
- Browser: isolated headless Chromium context with screenshots, console/network listeners and full video recording.
- Namespace: `QA-B-20260720-d3f5`.
- Organization: E2E QA-B Organization 20260720-d3f5.
- Facility: `FAC-26-001` / E2E QA-B Operations Facility 20260720-d3f5.
- Shared localhost/database: waited for port 3100; did not start a second server.
- Forbidden operations: no reset, push, migration, global teardown, broad cleanup, product-code edit, GitHub issue change, or QA-A/QA-C mutation.

## Created chain

| Stage | Record |
|---|---|
| Facility | `FAC-26-001` |
| Reactor | `R-26-001` |
| Supplier / location | `SUP-26-001` / E2E QA-B Supplier Location 20260720-d3f5 |
| Feedstock Delivery + Feedstock | `FS-26-001` |
| Primary Production Run | `PR-26-001` |
| Samples | `SAM-26-001`, `SAM-26-002`, `SAM-26-003` |
| Biochar Product | `BP-26-001` |
| Customer / location | `CUS-26-001` / E2E QA-B Customer Location 20260720-d3f5 |
| Order | `OR-26-001` |
| Delivery | `DL-26-001` |
| Application | `AP-26-001` |
| Primary Credit Batch | `CB-26-001` |
| Second run / empty-state batch | `PR-26-002` / `CB-26-002` |
| Adversarial lifecycle runs | `PR-26-003` Failed / `PR-26-004` Cancelled |

Application-generated codes do not accept a caller-supplied prefix, so names followed the required E2E QA-B prefix while record codes used the system’s code generator.

## Milestones

1. Initial login was blocked by a branch-local CSS compile regression; a concurrent fix/restart restored the shared app.
2. Organization/facility/reactor/supplier were created, including negative and whitespace validation.
3. Vehicle, feedstock type and feedstock bin quick-adds selected their new records immediately.
4. Intake saved documents and an intentionally excessive allocation, exposing QA-B-D3F5-002.
5. Primary production reached Running and Complete; invalid end-time transitions were rejected; read-only mode was non-mutating.
6. Two credit batches and three independent 1000-year samples were created; individual caps passed and cross-field chemistry failed.
7. Product/customer/order/delivery/application completed the custody chain with create-time evidence.
8. Application evidence was removed and re-added; file count refreshed immediately.
9. Traceability verified CB-002 empty state, CB-001 DAG/Map/Sankey/Trail, and persisted selection after reload.
10. Dashboard reconciled the full chain and exposed legitimate readiness gaps.
11. Stock/lifecycle attacks verified overdraw, duplicate-create, overlap, end/reason, child-mutation and delete guards; super-unit yield and failed-run dump-back failed.

## Evidence inventory

- Screenshots: `screenshots/00` through `screenshots/45` with gaps only where a planned shot was superseded.
- Main video: [qa-b-happy-path.webm](video/qa-b-happy-path.webm).
- Preflight video: [qa-b-preflight-blocked.webm](video/qa-b-preflight-blocked.webm).
- Telemetry fixture: [qa-b-readings.csv](qa-b-readings.csv).
- Browser driver: `qa-b-live-driver.cjs` (credentials loaded locally and never serialized).

## Final state

- Two pending credit batches remain for concurrent inspection.
- QA-B records were intentionally not cleaned up.
- Highest observed available feedstock after the failed-run test: 880 kg dry, demonstrating issue #49.
- Release recommendation: no-go pending the P1 mass/chemistry/yield/failed-stock fixes or an explicit risk acceptance.
