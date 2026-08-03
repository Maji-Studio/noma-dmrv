# QA-B findings — 2026-07-20 — `d3f5`

Namespace: `QA-B-20260720-d3f5`  
Facility: `FAC-26-001` — E2E QA-B Operations Facility 20260720-d3f5  
Result: complete chain created through the UI; no QA-A or QA-C record was selected or mutated.

| ID | Severity | Area | Result |
|---|---:|---|---|
| QA-B-D3F5-001 | P0, resolved during run | App bootstrap | Branch-local Tailwind compile failure initially blocked every route; a concurrent fix/restart restored the app. |
| QA-B-D3F5-002 | P1 | Feedstock mass accounting | Delivery allocation above declared mass saved and credited the excess without justification. |
| QA-B-D3F5-003 | P1 | Sample chemistry | Organic carbon greater than total carbon saved as “Chemistry complete.” |
| QA-B-D3F5-004 | P1 | Production plausibility | A run with 95 kg dry output from 80 kg dry input saved at 118.8% yield. |
| QA-B-D3F5-005 | P1 | Failed-run stock | Failing a running run did not restore its 80 kg dry feedstock withdrawal. |
| QA-B-D3F5-006 | P2 | Telemetry evidence | A canonical in-window readings CSV failed during create, while the UI discarded the actionable import reason. |
| QA-B-D3F5-007 | P3 | Parent deletion UX | The descendant guard preserved the run, but the operator only received “Failed to delete production run.” |

## QA-B-D3F5-001 — branch-local Tailwind candidate initially made `/login` HTTP 500

- **Severity:** P0 while present; resolved during this run by a concurrent branch fix and shared-server restart.
- **Route / record:** `/login`; no record.
- **Action/input:** Open `/login` in an isolated context and request it repeatedly before authentication.
- **Expected:** HTTP 200 login screen.
- **Actual:** HTTP 500 with generated CSS containing an invalid wildcard custom-property token.
- **Reproducibility:** 9/9 before the concurrent fix; 0/1 after restart. This is not an active end-of-run blocker.
- **Evidence:** [initial 500](screenshots/00-preflight-login-http-500.png), [blocked recording](video/qa-b-preflight-blocked.webm).
- **Likely root cause:** at the time of failure, `docs/design-system.md:35` contained a Tailwind arbitrary-value example that source scanning converted into invalid CSS; `src/app/globals.css:1` enabled the scan and the wildcard theme reset was near `src/app/globals.css:378`. The triggering docs text was sanitized concurrently.

## QA-B-D3F5-002 — bin allocations can manufacture feedstock mass

- **Severity:** P1.
- **Route / record:** `/feedstocks`; `FS-26-001`.
- **Action/input:** Declare a 2,000 kg wet delivery at 20% moisture, allocate 2,100 kg wet to `E2E QA-B Feedstock Bin 20260720-d3f5`, leave the displayed justification blank, and save.
- **Expected:** Block save, or require an explicit privileged override and immutable justification; downstream stock must not exceed received mass.
- **Actual:** Save succeeded. The list and traceability credited 2.1 t wet / 1.68 t dry. The warning was advisory only.
- **Reproducibility:** 1/1.
- **Evidence:** [over-allocation form](screenshots/12-feedstock-allocation-overage-attempt.png), [DAG](screenshots/33-traceability-dag-batch-1.png), [dashboard](screenshots/38-dashboard-overview-chain-gaps.png).
- **Likely root cause:** `src/schemas/feedstocks.ts:51-111` validates each allocation but never compares their sum with `totalWetMassKg`; `overrideJustification` is optional at `:99-103`. `src/data-access/feedstocks.ts:469-475` emits a warning only after all rows have been inserted.

## QA-B-D3F5-003 — contradictory carbon chemistry is accepted as complete

- **Severity:** P1.
- **Route / record:** `/samples`; `SAM-26-001`, batch `CB-26-001`.
- **Action/input:** Enter total carbon `70%`, organic carbon `80%`, inorganic carbon `5%`, plus otherwise valid 1000-year R₀/TGA fields, then create.
- **Expected:** Reject because organic carbon cannot exceed total carbon and the components cannot exceed total carbon.
- **Actual:** Sample saved; list showed total `70.0`, organic `80.0`, and “Chemistry complete.”
- **Reproducibility:** 1/1. Independent caps still worked: total carbon `101%` and pH `15` were rejected.
- **Evidence:** [caps rejected](screenshots/22-sample-caps-validation.png), [contradiction saved](screenshots/23-sample-cross-field-contradiction-saved.png), [three samples](screenshots/24-three-independent-samples.png).
- **Likely root cause:** `src/schemas/samples.ts:125-133` caps the fields independently; the `superRefine` at `:200-249` checks durability/nutrient presence only and has no carbon reconciliation. `src/lib/certification/evidence-ledger/durability-build-model.ts:106-116` can then clamp derived inorganic carbon with `Math.max(0, total - organic)`, masking the contradiction downstream.

## QA-B-D3F5-004 — production permits dry output above dry input

- **Severity:** P1.
- **Route / record:** `/production-runs`; `PR-26-003`.
- **Action/input:** Create a running run with 100 kg wet feedstock at 20% moisture (80 kg dry) and 100 kg wet biochar at 5% moisture (95 kg dry).
- **Expected:** Block or require a documented reconciliation because calculated yield is greater than 100%.
- **Actual:** Run saved at `118.8% yield`; it was later transitioned to Failed for lifecycle testing.
- **Reproducibility:** 1/1.
- **Evidence:** [super-unit yield and failed-end guard](screenshots/41-failed-run-missing-end-and-superunit-yield.png).
- **Likely root cause:** `src/schemas/production-runs.ts:132-198` validates input and output independently but has no cross-field yield/plausibility refinement.
- **Dedup:** Existing issue **#317**.

## QA-B-D3F5-005 — failed run keeps feedstock permanently withdrawn

- **Severity:** P1.
- **Route / record:** `/production-runs`; `PR-26-003`, source `FB-26-001`.
- **Action/input:** Confirm 960 kg dry available, create `PR-26-003` as Running with an 80 kg dry draw, transition it to Failed with an end time, then attempt a 970 kg dry draw.
- **Expected:** Failed-run handling restores or explicitly reconciles the unused 80 kg, leaving 960 kg available.
- **Actual:** The next overdraw message reported only `880 kg available`; the failed run still owned the 80 kg allocation.
- **Reproducibility:** 1/1.
- **Evidence:** [baseline overdraw at 960 kg](screenshots/40-stock-overdraw-blocked.png), [post-failure availability at 880 kg](screenshots/45-failed-run-stock-not-restored.png).
- **Likely root cause:** `src/data-access/production-runs/mutations.ts:464-467` treats only feedstock field changes as allocation changes; `:646-676` deletes/reallocates rows only in that case. A status-only Running → Failed transition leaves `production_run_feedstocks` untouched.
- **Dedup:** Existing issue **#49**.

## QA-B-D3F5-006 — create-time telemetry import fails without showing the cause

- **Severity:** P2.
- **Route / record:** `/production-runs`; `PR-26-001`; `qa-b-readings.csv`.
- **Action/input:** Attach a canonical CSV containing `timestamp_utc,temperature_c,pressure_bar` and three UTC rows covering the Jul 15 08:00–10:00 Europe/Zurich run window, then create the run.
- **Expected:** Import two or three in-window readings, or expose the exact safe parser/window error and a clear retry.
- **Actual:** The run and document saved, but the UI reported only “1 readings file could not be imported.” The detail retained the failed file and retry affordance; no readings were added.
- **Reproducibility:** 1/1; exact underlying failure was not exposed, so root parser cause remains unconfirmed.
- **Evidence:** `qa-b-readings.csv`, [run read-only detail](screenshots/16-run-view-readonly.png), [Trail file evidence](screenshots/36-traceability-trail-evidence.png).
- **Likely root cause / operator-friction seam:** `src/components/production-runs/production-run-list.tsx:261-294` catches and counts import errors but discards their safe message. The import function already creates actionable messages at `src/fn/production-run-reading-imports.ts:59-67`.

## QA-B-D3F5-007 — protected parent deletion reports only a generic failure

- **Severity:** P3.
- **Route / record:** `/production-runs`; `PR-26-001` with product and credit-batch descendants.
- **Action/input:** Actions → Delete → confirm Delete.
- **Expected:** Preserve the parent and identify the blocking child records.
- **Actual:** Parent and children were preserved, but the only message was “Failed to delete production run.”
- **Reproducibility:** 1/1.
- **Evidence:** [generic guard error](screenshots/44-parent-delete-guard-generic-error.png).
- **Likely root cause:** the transactional FK guard is intentional at `src/data-access/production-runs/mutations.ts:737-742`, but `src/fn/production-runs.ts:464-469` collapses the constraint error to a generic fallback; the list shows it at `src/components/production-runs/production-run-list.tsx:364`.

## Non-scored environment observations

- Dashboard first rendered “Select a facility” even though its query parameter and local-storage facility ID were correct; a reload restored the full dashboard. Evidence: [transient state](screenshots/37-dashboard-lost-facility-context.png), [recovered dashboard](screenshots/38-dashboard-overview-chain-gaps.png). Concurrent Next development-mode rendering/HMR prevents attributing this confidently to release code.
- The map renderer could not start WebGL in headless Chromium and correctly showed the transport-rail fallback. Evidence: [map fallback](screenshots/34-traceability-map-graceful-fallback.png).
- Organization creation produced the target record and then showed a slug-conflict message in the same create surface. Because the record existed and the shared environment was concurrent, this was not scored without a clean second reproduction.
