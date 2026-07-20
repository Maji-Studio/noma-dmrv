# Executive summary — QA-B `d3f5`

## Outcome

The complete UI chain was created in an isolated browser context:

`FAC-26-001 → R-26-001 → SUP-26-001 / location → FS-26-001 → PR-26-001 → SAM-26-001..003 → BP-26-001 → CUS-26-001 / location → OR-26-001 → DL-26-001 → AP-26-001 → CB-26-001`.

A second completed run and batch (`PR-26-002`, `CB-26-002`) established empty-state and batch-switch coverage. `PR-26-003` and `PR-26-004` exercised failed and cancelled lifecycles. No QA-A or QA-C record was selected or modified, no cleanup was run, and no GitHub issue or product-code change was made.

## Release confidence

**Low — do not promote without resolving or explicitly accepting the four P1 data-integrity findings.** No active P0 remained at the end, but the system can currently create feedstock mass, accept impossible chemistry and yield, and strand stock after a failed run. Those defects can change inventory, lineage, or eventual credit calculations.

The positive controls were substantial: stock overdraw was blocked atomically; a rapid double-create produced one run; overlap, invalid lifecycle states, descendant deletion, and linked-run reopening were blocked; date-only values retained their calendar day; create-time documents persisted; read-only detail did not expose evidence mutation; evidence add/remove refreshed immediately; two-batch Traceability selection survived reload; and the dashboard reconciled the created chain while showing legitimate certification gaps.

## Highest risks

- **Highest data-integrity risk:** `FS-26-001` credited 2,100 kg wet from a declared 2,000 kg delivery with blank justification. The excess flowed into stock, Traceability, and dashboard totals.
- **Highest operator-friction risk:** `PR-26-001` retained a failed canonical readings CSV but hid the actionable import reason behind a generic “1 file could not be imported” summary.
- **Highest unresolved lifecycle risk:** `PR-26-003` failed, but its 80 kg dry draw remained consumed (issue #49).

## Top five fixes

1. Make delivery allocation equality a server-enforced invariant; require an auditable privileged reconciliation instead of an advisory warning.
2. Add sample cross-field chemistry rules: `organic ≤ total`, `inorganic ≤ total`, and reconcile `organic + inorganic` to total within a documented tolerance.
3. Add production mass/yield plausibility policy and an explicit override/reconciliation workflow for exceptional runs.
4. Implement failed-run dump-back or a mandatory disposition transaction, preserving a stock audit trail.
5. Preserve and display safe telemetry-import errors in create/edit mode, including parsed-row and run-window diagnostics.

## Traceability and dashboard result

- CB-26-001 DAG: 400 kg dry feedstock used → 143 kg dry biochar → 150 kg product → 100 kg order → 95 kg dry delivery → 76 kg dry applied.
- Sankey: 400 kg input, 143 kg output, approximately 258 kg conversion loss, 76 kg applied, 67 kg stored/undelivered.
- Map fallback: 30 km supplier leg and 20 km facility-to-application leg.
- Trail: six custody steps and nine attesting records, including delivery and three application photos.
- CB-26-002: explicit no-application empty state; selection switched and persisted.
- Dashboard: 0.7 t dry processed in two completed runs, 0.3 t dry produced, 0.1 t applied, two pending batches, and legitimate evidence/verification gaps.

## Evidence

- [Ranked findings](findings.md)
- [Entity pass matrix](entity-pass-matrix.md)
- [Adversarial coverage](adversarial-coverage.md)
- [Console/network ledger](console-network.md)
- [Issue/PR dedup](issue-dedup.md)
- [Full browser recording](video/qa-b-happy-path.webm)
- [Screenshots](screenshots/)
