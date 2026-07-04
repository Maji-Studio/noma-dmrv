# Credit-batches Aggregate Drift Resolution

Resolved: 2026-07-03

The 2026-05-21 architecture audit flagged `creditBatches` aggregate drift as T2:
stored CO2e and mass columns could diverge from member application and
production-run lineage edits.

Resolution: the stored CO2e/mass aggregate columns were dropped and the figures
are now derived on read. The evergreen decision lives in
`docs/adr/0019-credit-batch-aggregates-derived-on-read.md`.
