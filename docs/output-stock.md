# Output stock and completed deliveries

Biochar bins hold layers from completed production runs. Product bins hold layers
from products placed in that bin. Stock accounting follows dry biochar and frozen
source-run shares. Recorded wet masses remain historical measurements; a current
wet estimate always needs an explicit moisture basis.

## Physical order and mass basis

Every output stock event carries a date and time (seconds stored, not shown).
Raw biochar uses the run end time. Product stock uses its mixing and placement
time, independently of when its source biochar was produced. Layers and events
compare as instants, so two events on the same day keep their real order; equal
instants use the stable posting sequence. A draw cannot use a physically future
layer. A late receipt does not change saved draws or applications.

Stock event times are entered and shown on the facility's clock, the same
clock production run times use, so every viewer reads one wall clock. Forms
take the time through the native date-time picker with a "Facility time" hint
and submit an ISO 8601 UTC instant; a wall clock skipped or repeated by
daylight saving is refused, not shifted. Read surfaces and server messages show
it in house style ("Sep 15, 2026, 14:30").

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

## Split bins: operator order

Every output bin has a stock mode (`storage_locations.stock_mode`, default
`split`); mix bins arrive with ADR 0030. In a split bin each layer is a
physically separate sub-bin. A delivery or loss may name the sub-bins it came
from in the order they were emptied, each with its own moisture reading
(`sources`); product creation follows with the sub-bin picker. Every sub-bin but the last is emptied at its
reading; the last takes the rest of the one load weight at its reading. If the
weight never reaches a named sub-bin the draw is refused with "Untick" advice,
and if the last sub-bin would give more solids than its records hold the save
is blocked until a count. Without `sources` the draw is oldest first at one
reading. Counts stay whole-bin.

Each allocation's `basis_snapshot` records `policy` (`fifo` or
`operator_order`), the operator's `order`, and the `readingPercent` used for
that layer. A draw from several sub-bins stores its overall moisture as
1 − solids ÷ wet, which history also shows. A correction starts from the saved
order and readings and may change them (Kenji, 2026-09-29), through the same
preview and refusals as a new draw, and only while no later movement,
application or certification submission depends on the original. The last
sub-bin's partial solids are floored to a nanogram so exact balances stay
bounded across many split draws.

## Orders, deliveries, and applications

An order records a formulation and requested wet amount. It reserves no product
or bin stock. A completed delivery records its actual source bin, physical time,
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
retain actor, reason, physical and recorded times, input basis, and before/after
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
