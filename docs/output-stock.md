# Output stock and completed deliveries

Biochar bins hold layers from completed production runs. Product bins hold layers
from products placed in that bin. Stock accounting follows dry biochar and frozen
source-run shares. Wet stock is wet mass added less wet mass taken out, per
layer, from the last posted count on (`estimateStock` in
`src/lib/output-stock/moisture-estimate.ts`). A removal's moisture fixes its dry
draw only and never changes the bin's moisture; only a count does. Counts and
removals apply in posting order, as dry stock does: a backdated entry still
sees every posted count and draw, and a backdated count's solids already
reflect what was posted before it. A product draw saved before the ledger counts before every count.
Dry biochar alone blocks a draw, so wet stock can still show once dried biochar
has none left.

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
walks eligible layers in the split bin's default or operator-supplied order,
using each layer's frozen dry-biochar share; mix bins draw pro rata.
Exact physical residuals survive independently of gram attribution, preventing
repeated rounding from authorizing excess consumption. Cumulative source-run
apportionment stays proportional to the frozen composition and closes every
source's final gram.

## Split bins: operator order

Every output bin has a stock mode (`storage_locations.stock_mode`, default
`split`; mix bins are below). In a split bin each layer is a
physically separate sub-bin. A delivery or loss may name the sub-bins it came
from in the order they were emptied, each with its own moisture reading
(`sources`); product creation follows with the sub-bin picker. Every sub-bin but the last is emptied at its
reading; the last takes the rest of the one load weight at its reading. If the
weight never reaches a named sub-bin the draw is refused with "Untick" advice,
and if the last sub-bin would give more solids than its records hold the save
is blocked. Without `sources` the draw follows the bin's default at one
reading. API counts stay whole-bin.

Each allocation's `basis_snapshot` records `policy` (`fifo`, `lifo`, `operator_order`
or `pro_rata`), `defaultDrawOrder` (the split-bin setting, null for mix), the operator's `order`, and the `readingPercent` used for
that layer. A draw from several sub-bins stores its overall moisture as
1 − solids ÷ wet, which history also shows. The server correction path starts from the saved
order and readings and may change them, through the same
preview and refusals as a new draw, and only while no later movement,
application or certification submission depends on the original. The last
sub-bin's partial solids are floored to a microgram (1e-9 kg) so exact balances stay
bounded across many split draws.

## Mix bins: pro-rata

A mix bin ([ADR 0030](./adr/0030-mix-bins-draw-pro-rata.md)) is one blended
pile. Every removal, loss and count shortfall takes each layer present in
proportion to its remaining solids (`planOutputStock(…, 'pro_rata')`). The
draw's exact dry, rounded half up to the gram, is apportioned as whole grams
across layers; every layer but the largest takes the solids of its grams, and
the largest takes the rest of the measured solids (floored to the microgram), so
no layer rounds on its own. A removal takes its wet mass from the pile and
leaves its moisture as it was; a count's reading is saved on every layer
present (`planReadings`).

The mode is timed. Switching a split bin to mix posts a `merge` movement at
"Merged at", which must be later than the bin's last recorded movement; switching
back to split needs an empty bin and posts a `split` movement. `stockModeAt`
reads this timeline, so every entry, including a later correction, is planned in
the mode in force at its own time, and no correction crosses a later switch to
split. Every output-stock command refuses `sources` on a bin that is mix at
the command instant with 422 `validation_failed` at `/sources`. An entry timed
before saved mix removals lists them in its preview (`calculatedWithout`); their
saved shares stay.

Mix-drawn applications (a delivery from a mix bin, or a product made from a mix
biochar bin) are held out of credit-batch slices while
`MIX_BIN_REMOVALS_CREDITABLE` (`src/config/output-stock.ts`) is `false`
(`src/data-access/mix-bin-credit-hold.ts`).

## Orders, deliveries, and applications

An order records a formulation and requested wet amount. It reserves no product
or bin stock. A completed delivery records its actual source bin, physical time,
measured wet mass, and moisture. Its immutable layer and run allocations determine
its dry biochar total. Future delivery times are refused in both the app and API.
REST/MCP create previews and committed creates expose the drawn product allocations;
PATCH changes metadata only. Mass and moisture corrections stay in the app.
See [delivery API contracts](./api.md#deliveries-on-rest-and-mcp).
Legacy storage-inventory rows are not a stock ledger.

Applications take proportional shares of the saved truck allocation. They do not
repeat the planner against the bin. Saved shares feed batch accounting, certification
guards, traceability, and transport. Product transport loads use measured wet
shares, including physical residuals whose dry grams were already attributed.

## Operator stock sheets

Every bin uses the same stock card and a separate Stock over time card. Split
output bins show fixed-width bays in the bin's default draw order, wrapping when
needed, with a key below. Mix and feedstock bins show one pile. A lone vessel
fills against the configured capacity and lists its parts beside it. Multiple
split bays compare wet mass against the largest bay. Without capacity, a lone
vessel fills its available height. Split bays and Next out follow the bin's configured default draw order.

Adjust stock in the stock card header opens Lost mass directly. There is no
count action or generic Correct entry action in the UI. History sits under the chart, groups
entries by facility-local day, and keeps old counts and corrections readable.
Corrections show separate Original and Corrected blocks with an arrow between.
Mode changes say Switched to mix or Switched to split.

History links to the originating production run, biochar product, delivery or
feedstock intake when the entry has one. Fix a wrong entry in the form where it
was entered (decision 1). An output-bin Lost mass entry has an Edit action that opens its
own form with the saved time, mass, moisture, draw and reason (decision 3).
Delivery mass, moisture and split-bin draw readings can be edited in the delivery
form. Both saves append a reversal and replacement, shown as Original and Corrected.
The delivery row stays in agreement with its replacement movement.

These edits use the same dependency predicate as the server correction path
([Record locks](./database.md#record-locks)). Later draws that use the affected
stock, balance-dependent counts, applications and certification lineage lock
protected values. Unrelated intake alone does not lock an entry. An explicitly
ordered draw from another sub-bin does not lock stock it did not use. History
and the delivery form show the same dependency reason as the server, which
rechecks under the posting path's bin-stock lock. Delivery source, order,
and date/time retain their existing posting restrictions.
Old counts remain readable without an edit action. Feedstock Lost mass supports
creation only; feedstock intake changes retain ADR 0027's wet-lane guard.

Output postings retain their receipt marker as historical snapshot metadata.
A changed stock basis requires a fresh preview; a new receipt alone does not
permanently lock an otherwise independent correction.

The chart uses steps: dry biochar (output) or estimated solids (feedstock), plus
hatched estimated water. Product ingredient solids are a separate solid band,
not water. Output points replay frozen stock effects, including reversals, in
physical-time order; explanatory moisture rows are not counted twice. Missing
historical wet or solids bases leave water unknown. Bay, pile-band and chart
point details open on hover, keyboard focus or tap.

Feedstock's org-scoped `feedstock-bin-ledger.ts` reads completed intakes,
production-run draws, product ingredient draws, losses and old counts. The pile
is pooled. Saved per-batch run draws are subtracted from their own intake batches.
Draws without saved batch shares, such as ingredients and losses, are estimated
pro rata over the remaining batches present at that entry. Each chart point uses
the same ordered prefix as its wet balance, including recorded-order timestamp
ties. Each batch's estimated dry solids use
its intake dry-to-wet ratio. This does not rewrite saved feedstock allocations.
Chart points start at the first intake, so an earlier dated run draw does not
claim that an intake has missing mass. Missing intake mass basis leaves composition unavailable;
the wet ledger remains readable. Pending intakes stay outside stock.

## Losses, counts, and corrections

A measured loss consumes stock through the same planner. Counts and corrections
remain supported by the native server writer. The browser stock action accepts
corrections only for Lost mass; delivery edits go through delivery CRUD and its
version check, and count corrections are refused. REST/MCP do not publish a
correction input. Output-bin Lost mass corrections use the entry's own Edit
action; counts have no stock-sheet action. A count compares measured
solids with expected solids: drying alone causes no loss, an excess observation
creates no stock, and a zero count closes the exact remaining stock without a
moisture reading.

Corrections append a reversal of the original effects and a replacement. They
retain actor, reason, physical and recorded times, input basis, and before/after
balances. A reduced loss restores its original source provenance even after a
late older intake through the existing server correction contract. The Lost mass form and delivery update use
that same dependency-based contract. Later dependent draws, counts, applications,
and certification artifacts continue to block server corrections with a named reason.

Preview fingerprints are checked again while holding bin and request locks.
Repeated request keys return the saved result; changing the payload for a reused
key fails. Delivery corrections also lock the delivery before checking for
applications. Posted product measurements stay immutable. Delivery mass edits append corrections;
Open products and deliveries can be deleted through app operations. The writer
appends an exact inverse of the frozen source allocations under the bin stock
lock before removing the live record. History retains the original and its
linked reversal. Later active draws, counts, applications and Sent lineage
refuse deletion with `certification_locked` and record-lock guidance. Reversed
draws no longer block earlier delivery corrections or deletion. Product layers
referenced by historical allocations remain protected. Orders, including archived
orders and orders that never had deliveries, can be deleted when no delivery
remains; archived deliveries still count. These product and delivery deletes
are not exposed in REST or MCP.

## API stock read

`GET /api/v1/storage-locations/{idOrCode}/stock` and MCP `get_bin_stock`
return the same current stock body, under `biochar-products:read`. An optional
`facilityId` narrows the lookup. Only biochar and product bins answer, including
archived bins; a feedstock bin returns 422 `validation_failed`.

Representation revision 2 includes `drawOrder` (`oldest_first` or
`newest_first` for split bins, null for mix). `subBins` stays oldest first.

`subBins` lists held layers with their run or product code and the `layerId`
a split-bin loss takes in `sources`. Mix bins still list each layer's dry
biochar and solids, but per-layer `estimatedWetKg`, `estimatedMoisturePercent`
and `moistureBasis` are null. The pile's wet and moisture figures are in
`totals`, because a mix pile has one moisture.

Unresolved stock returns 200 with `status: "unresolved"`, a fixed sentence in
`unresolvedReason`, `totals: null` and `subBins: []`. A resolved empty bin has
zero mass totals. Kilograms round to 3 decimal places and percentages to 2.
The read includes stock figures only. Use `find_output_stock_movements` for
history and the product detail read for source runs.

See [api.md](./api.md#output-bin-stock-read) for the snapshot
and ETag contract. A read reserves no stock; use the loss dry run's
`basisFingerprint` for its optimistic check.

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

## Per-bin default draw order

Split biochar and product bins have a **Default draw order**: **Oldest first**
(`oldest_first`, the default) or **Newest first** (`newest_first`). The setting
appears below Stock mode in the form and on the read view. The illustrated
cards play on hover and keyboard focus; reduced motion shows the settled bay.
The picker, bays and Next out all start in that order. An operator can still
supply a different order and readings for one draw.

The default resolves to `fifo` or `lifo` in the shared preview/posting planner,
including delivery, product creation (`production_draw`), loss and API counts.
Newest first reverses both physical placement time and posting-sequence ties.
An explicit `sources` list wins and records `operator_order`. REST/MCP dry runs
execute the same writer and roll it back, so their stock effects agree with saves.
Mix remains `pro_rata`; feedstock and ingredient draws are unchanged.

Allocation `basis_snapshot` retains the resolved `policy`, `defaultDrawOrder`,
manual `order` (null without `sources`), and each layer's `readingPercent`,
alongside its existing mass and provenance basis. Changing the setting uses the
bin's existing version check and stock lock, invalidates preview fingerprints,
and does not rewrite saved allocations. The current setting applies to a new
backdated draw too; default changes are preferences, not timed merge events.

Migration `0134_output_draw_order.sql` adds the non-null `draw_order` column
and `output_draw_order` enum. Existing rows and seed inserts that omit it get
`oldest_first`. REST/MCP storage-location reads expose `drawOrder`; there is no
new public write endpoint for the setting.
