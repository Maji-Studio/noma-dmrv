# Output bin stock is dry biochar per layer, drawn first-in first-out

**Status: Accepted** (2026-09-14; implemented in [#759](https://github.com/Maji-Studio/noma-dmrv/pull/759); amended 2026-09-28, see below). [Design and examples](../plans/2026-09-14-fifo-bin-accounting.md).

## Amendment (2026-09-28) — split bins, moisture readings, mix bins

Agreed with Kenji in the [split and mix bins plan](../plans/2026-09-28-split-and-mix-bins.md). Where this conflicts with the decision below, the amendment wins. Not implemented yet.

- **Stock mode.** Output bins are Split (default, today's behaviour) or Mix. Mix bins draw pro-rata under [ADR 0030](./0030-mix-bins-draw-pro-rata.md).
- **Split bins are physical.** Layers are physically separate sub-bins. For delivery, loss and product-creation draws, the operator ticks sub-bins and sets the order they were emptied; oldest first is only the default. Each sub-bin in the draw has its own measured moisture, with one load weight: every sub-bin except the last is emptied at its reading, and the last takes the rest. Insufficient stock still blocks the whole action. Counts stay whole-bin, and corrections reuse the saved order and readings.
- **Readings reset moisture.** Replaces "Departure readings do not update the remaining pile's moisture or wet estimate". A measured reading now sets the estimated moisture, and so the wet estimate, of the sub-bin or mix pile it describes. It's shown before and after in the preview and logged as its own history row. Dry biochar is unaffected.
- **No prefilled moisture.** Replaces the ingredient-moisture prefill. Every moisture field in stock forms (delivery, loss, count, product creation, ingredients) is required and starts empty. The current estimate is shown as a hint, and a reading that differs from it by more than a configured margin raises an advisory warning. Ingredient snapshots record a measured value.
- **Time.** Layer placement and stock events carry date and time; FIFO order and eligibility compare instants.

## Context

Moisture changes make recorded wet quantities an unreliable limit for biochar leaving storage. Biochar bins and product bins therefore conserve **dry biochar per source layer**, with oldest-first physical loading and FIFO accounting across layers. Product layers retain a fixed biochar share of dry solids and proportional source-run provenance; a mixed delivery's applications inherit proportional shares of that delivery.

## Decision

- A layer is a completed production run in a biochar bin or a product batch in a product bin. Eligible stock is ordered by actual production or mixing/placement date, then stable posting order. New arrivals are kept separate during loading. The software's FIFO attribution does not itself prove the composition of a remixed pile.
- Entered departure moisture determines the dry solids in the measured wet draw. A pure biochar draw has dry biochar equal to those solids. A product-bin draw uses each layer's fixed biochar share of solids, exhausts older layers, then continues into later layers. Insufficient stock blocks the whole action.
- Product creation establishes source dry biochar and ingredient dry solids. Ingredient moisture is prefilled from the bin's weighted remaining wet/dry basis, matching its pro-rata withdrawal, and can be overridden for the material used; retain the value and its source. An oldest-intake default can overstate biochar share when that intake is wetter than the mix. Pre-blend dry biochar remains the ceiling, independent of subsequent moisture changes.
- Every positive ingredient line needs retained moisture and dry solids before a product layer is posted. Ingredients without a bin require entered moisture and contribute solids without a tracked ingredient-stock draw. Missing values block posting; they never imply zero ingredient solids.
- Orders select a formulation, reserve no stock, and can be recorded before stock exists. Pure biochar has a 100% biochar formulation. Deliveries represent completed loads only and post their dry withdrawal when saved; there is no upcoming state.
- Departure readings do not update the remaining pile's moisture or wet estimate. **Record loss** uses measured lost mass and moisture. **Reconcile stock** compares counted and tracked stock on the same moisture/solids basis, previews any FIFO dry loss, and can close an empty bin exactly. Drying alone is not a loss; unknown-origin stock additions are excluded.
- Corrections retain original entries and append linked, explained before/after changes. A mistaken loss can restore its original provenance. A stock-changing correction is blocked when affected later allocations, balance-dependent operations, applications, or certification locks rely on it. Unrelated intake or notes alone do not block it.
- Late intake leaves posted allocations unchanged. An unused delivery may be explicitly corrected when stock and dependency checks pass; no automatic downstream replay is included.
- Feedstock bins, including bins holding blend ingredients, retain wet-stock accounting under ADR 0027. All bin-to-bin transfers are deferred to [#34](https://github.com/Maji-Studio/noma-dmrv/issues/34).

## Consequences

Multiple source-layer allocations must reach deliveries, applications, credit-batch slices, traceability, and certification guards. Source and allocation sums close to grams; one transaction validates and posts stock changes and their audit trail. The interface leads with wet mass removed and smaller dry biochar beneath, before/after bin cards with bars, visible batch shares, and explicit correction effects. Conditional wet estimates are labelled and do not become new bin measurements; bin history opens through More info.

The project's registry basis remains [Biochar v1.1](https://registry.isometric.com/protocol/biochar/1.1) and [Agricultural Soils v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1). This is an internal method, not a claim of registry approval. The PDD must justify its physical loading and composition assumptions and evidence before credit use. Ingredient-solids decay remains an accepted conservative bias under those assumptions. No production backfill or transitional compatibility is required; the migration chain must work, and shared staging resets require prior notice.
