# Evidence 26 — staging traceability reconciliation

Route: `/traceability?facility=40131551-9036-48ea-9064-8ae3fde06793&batch=c705e487-864e-4749-b5fa-77a7e773e0d3`

The selected `CB-26-001` showed one production run and one application.

## DAG

The rendered chain included:

`FS-26-001` → `PR-26-001` → `BP-26-001` → `OR-26-001` → `DL-26-001` → `AP-26-001`

Visible quantities included 9,200 kg feedstock used, 3,000 kg product wet mass,
2,760 kg product dry mass, 2,500 kg ordered/delivered/applied wet mass, and 2,300 kg
applied dry mass.

## Map

The map loaded the synthetic supplier, `FAC-26-001`, and `AP-26-001`, with the expected
42 km supplier leg and 18 km application leg.

## Sankey

The mass balance rendered one record in each applicable group: 9,200 kg feedstock,
2,760 kg production/biochar lot, 6,440 kg conversion loss, 460 kg in storage/undelivered,
and 2,300 kg applied.

After reload, the same batch and Sankey view remained selected. No fatal traceability error
or browser warning/error was exposed.
