# Output stock and completed deliveries

Biochar bins hold layers from completed production runs. Product bins hold layers
from products placed in that bin. Stock accounting follows dry biochar and frozen
source-run shares. Recorded wet masses remain historical measurements; a current
wet estimate always needs an explicit moisture basis.

## Physical order and mass basis

Raw biochar uses the run completion date. Product stock uses its mixing and
placement date, independently of when its source biochar was produced. Equal
physical dates use the stable posting sequence. A draw cannot use a physically
future layer. A late receipt does not change saved draws or applications.

Each product freezes its source dry biochar and ingredient dry solids. Positive
ingredient amounts use the oldest eligible intake moisture or an explicit
operator measurement. Later intake changes do not rewrite that snapshot. Every
product has a formulation, including Pure biochar.

The shared planner turns measured wet mass and moisture into exact solids. It
walks eligible layers in FIFO order using each layer's frozen dry-biochar share.
Exact physical residuals survive independently of gram attribution, preventing
repeated rounding from authorizing excess consumption. Cumulative source-run
apportionment stays proportional to the frozen composition and closes every
source's final gram.

## Orders, deliveries, and applications

An order records a formulation and requested wet amount. It reserves no product
or bin stock. A completed delivery records its actual source bin, physical date,
measured wet mass, and moisture. Its immutable layer and run allocations determine
its dry biochar total. Legacy storage-inventory rows are not a stock ledger.

Applications take proportional shares of the saved truck allocation. They do not
repeat FIFO against the bin. Saved shares feed batch accounting, certification
guards, traceability, and transport. Product transport loads use measured wet
shares, including physical residuals whose dry grams were already attributed.

## Losses, counts, and corrections

A measured loss consumes stock through the same planner. A count compares measured
solids with expected solids: drying alone causes no loss, an excess observation
creates no stock, and a zero count closes the exact remaining stock without a
moisture reading.

Corrections append a reversal of the original effects and a replacement. They
retain actor, reason, physical and recorded dates, input basis, and before/after
balances. A reduced loss restores its original source provenance even after a
late older intake. An eligible, unapplied delivery correction can explicitly use
newly recorded physically older stock. Later dependent draws, counts,
applications, and certification artifacts block corrections with a named reason.

Preview fingerprints are checked again while holding bin and request locks.
Repeated request keys return the saved result; changing the payload for a reused
key fails. Delivery corrections also lock the delivery before checking for
applications. Posted product and delivery measurements cannot be silently edited
or deleted through ordinary CRUD forms.

## Code and verification

The pure planner lives in `src/lib/output-stock/`. Scoped projections, preview,
posting, correction, and history modules live in `src/data-access/output-stock*`.
`src/data-access/delivery-allocation-provenance.ts` owns saved downstream shares.

Migration 0115 introduces the immutable allocations and required formulation and
placement facts. Existing disposable development data with missing facts needs a
local reset; the migration intentionally supplies no production backfill.

The regression suite includes pure gram conservation, real PostgreSQL writer
races and rollback, consumer SQL, and `tests/e2e/output-bin-fifo.spec.ts`. The dated
execution plan is in `docs/plans/2026-09-14-issue-756-test-plan.md`.
