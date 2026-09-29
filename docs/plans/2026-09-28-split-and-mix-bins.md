# Split and mix output bins

**Owner:** Kenji Nguyen · **Status:** agreed in grilling (2026-09-28), not implemented · **Last reviewed:** 2026-09-28

Decisions: [ADR 0029 amendment (2026-09-28)](../adr/0029-output-bin-stock-is-dry-biochar-drawn-fifo.md) and [ADR 0030](../adr/0030-mix-bins-draw-pro-rata.md). Four grilling rounds (21 decisions, with diagrams) are recorded on the [Split and Mix Bins page](https://claude.ai/artifact/ARZrecVgBMHDPa3J91TKnM).

## Purpose

Output bins (biochar bins and product bins) get a stock mode, set per bin:

- **Split** (priority 1): every product batch or production run stays a physically separate **sub-bin** (bay, bag or heap). The operator records which sub-bins a load came from, in the order they were emptied, with a moisture reading for each. Oldest first is the default.
- **Mix** (priority 2): all batches sit in one well-mixed pile. Every removal takes each batch in proportion to what it has left. The pile's moisture is estimated from its history and updated by every reading.

## What the code does today (reviewed 2026-09-28)

- FIFO layers shipped in #759 (ADR 0029). A layer is a completed production run in a biochar bin or a product batch in a product bin. `planOutputStock` (`src/lib/output-stock/planner.ts`) sorts layers by `physicalDate` then posting sequence, walks them oldest first, and conserves exact rational solids per layer. Layer order doesn't affect each layer's own checks, so a different walk order or a pro-rata split is a planner change, not a ledger redesign.
- Every posting writes immutable `output_stock_allocations` per layer with `output_stock_run_allocations` per run. Deliveries, applications and credit slices read these saved rows and never re-run the planner, so a new draw policy is invisible downstream.
- A draw request carries one wet mass and one moisture (`OutputStockRequest`). Departure moisture never changes the remaining pile; wet estimates use each layer's recorded wet mass (`estimateWetAtRecordedMoisture`).
- Stock dates are calendar days: `biochar_products.placed_at` and `bin_movements.physical_date` are `date` columns, and a delivery saves its date at midnight. Production runs already store `end_time`, but layer queries truncate it to the facility's date.
- Ingredient moisture on Create Biochar Product is prefilled from the ingredient bin's weighted remaining stock (`ingredient-moisture-field.tsx`), and `product_ingredient_snapshots.moisture_source` records `weighted_remaining` or `operator_override`. A count's moisture is optional.
- `storage_locations` has no stock mode. Product bins take their formulation from the first batch stored in them (`claimBinFormulationId`).

## Registry evidence

Pinned: Biochar Production and Storage v1.1 and Biochar Storage in Agricultural Soils v1.1 (`docs/isometric/versions.json`). Quotes checked verbatim on 2026-09-28:

- Protocol v1.1, Calculation of C_biochar: "C_biochar can be calculated for either a blend of biochars (Storage Batch), or for individual Production Batches." A mixed pile is an anticipated path.
- Soils module v1.1, Table 2, moisture content: "Measure every production batch as per method A or B applicable. Minimum number of 3 samples per production batch." (Required.) Nothing is said about readings at removal or a computed pile moisture; our method for those belongs in the PDD.
- Soils module v1.1: "It is a requirement that all Projects demonstrate the degree of homogeneity within a single Storage or Production Batch." A mix bin needs its homogeneity shown.

Not found: a ban on mixing, a stockpile time limit, a required FIFO or pro-rata rule, or a minute-level timestamp rule for mass transfers. The draw order, pro-rata attribution and moisture-reading method are internal choices, and the PDD must describe them. This is our reading, not registry approval.

## Accepted rules

### Both modes

1. **Scope.** Biochar bins and product bins. Feedstock and ingredient bins keep wet stock and pro-rata withdrawal (ADR 0027).
2. **Mode.** Chosen on the bin form when the bin is created; default Split, which is how every existing bin already behaves. Split to Mix is allowed at any time as a timed **merge** event: after it, every batch present is drawn pro-rata, and nothing already posted changes. Mix to Split is allowed only when the bin is empty. A draw uses the mode in force at its event time, so an entry timed before a merge is planned as Split.
3. **Time.** Every output stock event carries date and time (product added, delivery, loss, count, merge). Seconds are stored but not shown. Display uses house style ("Sep 15, 2026, 14:30"); input uses the native date-time picker, which follows the viewer's locale.
4. **Moisture readings are required and never prefilled.** This covers delivery, loss, count, product creation (biochar draw) and ingredient moisture. Below each field, one short hint: "Estimated moisture: 29.4%", with the date of the reading it comes from in an ⓘ tooltip. Keep the hint to one figure. A reading must be at least 0% and below 100%, as delivery moisture already requires.
5. **A reading resets what it describes.** A mix-bin reading sets the whole pile's estimated moisture. A split-bin reading sets the moisture of the sub-bin it was taken from. Dry biochar and solids never change; only the wet estimate does.
6. **Reset visibility.** The stock preview shows the change as before → after blocks (moisture and wet estimate, with an arrow between them, not a sentence). It's applied on save with no opt-out. The bin's history gets its own "Moisture updated" row, linked to the removal that measured it.
7. **Plausibility warning.** If a reading differs from the estimate by more than `MOISTURE_READING_WARNING_POINTS` (5 percentage points, in `@/config`), show an advisory warning. It never blocks (ADR 0026). Recording an acknowledgement follows ADR 0026 once that system exists; it is not implemented yet, so this slice shows the advisory only.
8. **Overdraw still blocks.** A reading makes the dry figure right, but it doesn't prove the records hold that much. If the measured solids exceed what the chosen sub-bins (or the mix pile) hold by the records, the save is blocked. The fix is a count first.

### Split bins

9. Sub-bins are physically separate. The operator's choice records a fact, not an assumption.
10. **Picker.** Delivery and loss on product bins, and Create Biochar Product on biochar bins, show one collapsed line in both Simple and Detailed: "Oldest first · Change". Change opens a modal where the operator ticks sub-bins and drags them into the order they were emptied. Arrow buttons do the same for keyboard and touch users.
11. **One load weight, one reading per sub-bin.** Every sub-bin in the draw except the last is emptied at its own reading. The last one takes the rest at its reading. If the weight never reaches a ticked sub-bin, the modal asks to untick it. If the ticked sub-bins can't cover the load, the save is blocked (rule 8).
12. **Inline readings.** The per-sub-bin moisture fields sit under the collapsed line, one row per sub-bin the load reaches. A row appears as the weight grows past the previous sub-bin. The modal is only for choosing sub-bins and their order.
13. **Counts stay whole-bin.** A correction of a split draw starts from the original sub-bins, order and readings, prefilled, and the operator may change them, with the same preview and refusals. That holds only while no later movement, count, application or certification submission depends on the entry; after that it is locked. (Amended 2026-09-29.)
14. **Sub-bin card.** Wet first: batch code, time added, wet estimate, estimated moisture. The cards sit on the bin's detail sheet, opened from its tile on the bin board, so the board keeps one figure per bin. Switch to rows once a bin holds more than `SUB_BIN_CARD_LIMIT` (6) sub-bins.
15. **ⓘ tooltip** on each sub-bin card, opened by hover, focus or tap: dry biochar, solids, time added, last three movements. Clicking the card itself ticks it. Wording is "Added", "Removed", "Loss reported"; never "Placed". Full history stays in the existing history modal.

### Mix bins

16. **One pile on screen.** The bin shows one box (for example "BCF Mix") with its wet estimate and estimated moisture. Batch shares stay underneath in the ledger and in Detailed.
17. **Pro-rata draws.** Every removal takes each batch present at that time in proportion to its remaining solids. Loss and count shortfalls spread the same way. Positive count differences are unknown-origin additions, still an open question (`docs/open-questions.md`).
18. **Estimated moisture timeline.** At a reading, the pile's wet estimate becomes solids ÷ (1 − reading). An addition adds its own recorded wet mass and solids. A removal shrinks every batch by the same fraction, which leaves the moisture unchanged. Estimated moisture = 1 − solids ÷ wet estimate.
19. **Backdating is allowed.** An entry timed before an already-posted removal doesn't change that removal's saved shares. The operator is told which removals were calculated without it. This matches ADR 0029's late-intake rule.

## Draw calculation

Split, operator order `[L1 … Ln]` with readings `m1 … mn` and load weight `W` (all exact rationals, as today):

```
for i in 1 … n-1:  wet_i = remainingSolids(Li) / (1 - m_i);  W -= wet_i   (Li emptied)
                   if W <= 0: error "load never reaches L{i+1}; untick it"
last:              solids_n = W × (1 - m_n);  if solids_n > remainingSolids(Ln): block (rule 8)
```

Mix, reading `m` and load `W`: `drawn = W × (1 - m)`. Block if `drawn` exceeds the pile's solids. Otherwise split `drawn` across eligible layers in proportion to their remaining solids, closing to grams with `splitCumulativeGrams` exactly as run shares do today.

Dry biochar per layer is solids × the layer's biochar share of solids, unchanged from ADR 0029. Source-run shares within a layer stay proportional.

## Worked examples

**Split.** B-0412 holds 843.2 kg solids (1,240 kg wet at 32% when added); B-0419 holds 637.0 kg solids (980 kg at 35%). The load is 1,500 kg wet, emptied B-0412 then B-0419, with readings of 30% and 33%.
B-0412 is emptied: 843.2 ÷ 0.70 = 1,204.6 kg wet. B-0419 takes the remaining 295.4 kg wet × 0.67 = 197.9 kg solids and keeps 439.1 kg, which is 655.3 kg wet at its new 33%.

**Mix.** The pile holds 1,636.8 kg solids, estimated 31.8% (2,400 kg wet), with batch shares of 45%, 35% and 20%. A 1,000 kg delivery reads 26.7%: it draws 733.0 kg solids (329.85, 256.55 and 146.60 kg). The pile keeps 903.8 kg solids, and the reading resets it to 26.7%, so the wet estimate is 1,233.0 kg (before → after: 31.8% / 1,325 kg → 26.7% / 1,233 kg). A later batch of 600 kg wet at 35% (390 kg solids) brings the pile to 1,293.8 kg solids and 1,833.0 kg wet, an estimated 29.4%.

**Why timing matters (mix).** The pile holds 2,000 kg at 30%. If 1,000 kg is removed at 10:00 and 100 kg at 50% is added at 14:00, the removal takes 700.0 kg dry and the pile ends at 31.8%. If the addition happened at 09:00 instead, the removal would read 30.95% and take 690.5 kg. With date-only records the two days look the same.

## Data model

- `storage_locations.stock_mode` (`split` | `mix`), required for output bins, default `split`. A merge posts a `bin_movements` row (`output_kind = 'merge'`, no stock change) at its time and switches the mode in the same transaction.
- **Time precision.** `biochar_products.placed_at` becomes `placed_at timestamptz`, `bin_movements.physical_date` becomes `occurred_at timestamptz`, deliveries store their actual time, and biochar layers use `production_runs.end_time` without truncation. `OutputStockLayer.physicalDate` becomes an instant; eligibility compares instants, and posting sequence still breaks ties.
- **Moisture readings.** New `output_stock_moisture_readings`: organization, bin, layer (`biochar_product_id` or `production_run_id`; null for a whole mix pile), the movement that measured it, moisture percent, the solids basis at the reading (exact rational), and `occurred_at`. Estimated moisture and wet estimates come from the latest reading, not from `estimateWetAtRecordedMoisture`'s creation basis.
- **Allocation basis.** `output_stock_allocations.basis_snapshot` gains `policy` (`fifo` | `operator_order` | `pro_rata`), the operator's order, and the reading used for that layer. A delivery drawn from several sub-bins stores its overall moisture as 1 − solids ÷ wet, derived from the per-layer readings.
- **Ingredient snapshots.** `product_ingredient_snapshots.moisture_source` loses `weighted_remaining` / `operator_override`: the value is always measured, and the snapshot keeps the estimate the operator saw.
- A count's moisture becomes required.
- Pre-production policy: no backfill and no compatibility shims. The migration chain must still run; the shared staging database needs a reset for the time-precision change. **Tell Kenji before that lands.**

## Implementation slices

| PR | Scope | Depends on |
| --- | --- | --- |
| A · docs | This plan, ADR 0029 amendment, ADR 0030, CONTEXT.md terms, open-questions update | — |
| B · time | Timestamp columns, planner instants, native date-time inputs, house-style display. Staging reset notice. | A |
| C · split engine | `stock_mode` column; planner operator order with per-layer readings, "untick" and overdraw errors; `basis_snapshot.policy`; correction replay of the saved order. Pure planner tests first. | B |
| D · readings | Readings table; reset on save; estimated moisture; "Moisture updated" history row; before → after preview block; required, unprefilled moisture everywhere with the one-line hint and ⓘ; the 5-point warning; ingredient moisture without prefill. | C |
| E · split UI | Collapsed line and inline per-sub-bin readings; Change modal with drag order and arrow buttons; ⓘ tooltips; sub-bin cards on the bin's detail sheet, switching to rows past 6 sub-bins. Delivery, loss, Create Biochar Product. | D |
| F · mix | Mode on the bin form; timed merge; Mix → Split only when empty; pro-rata planner policy; one-box mix tile; pro-rata counts and losses; backdating warning. Mix removals must not feed credit batches until the PDD covers the mixing practice (ADR 0030). | E |

Split is usable after E. Each PR runs `pnpm lint`, `pnpm typecheck` and the colocated tests. UI PRs also run the form gallery and a Playwright pass (`docs/testing.md`).

## Acceptance

- The planner's exact-solids and gram-closure checks pass for FIFO, operator order and pro-rata, including an emptied layer, the untick error, overdraw, and a load that closes a bin exactly.
- A delivery from two sub-bins saves one allocation per sub-bin with its own reading; downstream application and credit slices are unchanged.
- A reading updates only the sub-bin or pile it describes, logs a "Moisture updated" row, and never changes dry biochar.
- The mix worked example reproduces to the gram, including the timing example.
- A 100% moisture reading is rejected in every draw and wet-estimate flow.
- Keyboard-only: tick, reorder and enter readings without a pointer.

## Related

- [FIFO bin accounting plan](./2026-09-14-fifo-bin-accounting.md) (the layer model this builds on)
- [#34](https://github.com/Maji-Studio/noma-dmrv/issues/34) bin-to-bin transfers stay out of scope. A merge changes a bin's mode; it doesn't move stock between bins.
- `docs/open-questions.md`, "Output-bin FIFO and physical composition": PDD follow-up for split and mix bins.
