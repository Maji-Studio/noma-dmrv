# FIFO bin accounting with dry biochar as the stock currency

**Date:** 2026-09-14 · **Status:** design accepted after review and stakeholder discussion; not implemented · **Branch:** docs/fifo-bin-accounting-plan

**Pickup issue:** [#756](https://github.com/Maji-Studio/noma-dmrv/issues/756), containing the self-contained implementation brief and acceptance criteria.

## Purpose

Track conserved dry biochar from production through product bins, completed deliveries, and applications. A delivery can draw from several product batches. Rain and drying affect the measured load calculation; they cannot create stock, silently write off stock, or change saved allocations.

This plan supersedes the earlier draft and its shared interactive example where they differ. The key changes are formulation-only orders, completed-load deliveries, explicit reconciliation, controlled logged corrections, and deferred transfers and unknown-origin additions.

## What the code does today (reviewed 2026-09-14)

- Stock is largely derived from source records and the append-only movement ledger. Biochar product source allocations spread draws across production runs proportionally; entered biochar-only moisture determines the dry draw (`biochar-product-source-allocations.ts`, `biochar-product-create.ts`).
- Delivery source resolution uses one biochar product, directly or through its order. `delivery-dry-biochar.ts` allocates a homogeneous share of that product's conserved dry mass using its recorded wet basis. Delivery moisture does not change that allocation, and a delivery cannot spill into another product.
- `biochar_storage_inventory` exists in the schema, but the reviewed runtime does not populate/update it as the authoritative delivery stock ledger. Its delivery foreign key is already nullable. Do not implement this plan on the assumption that each current delivery consumes an inventory row.
- Orders require `biocharProductId`; formulation-only ordering needs relationship, validation, read-model, and UI changes. Current delivery stock predicates depend on `delivered` status.
- Product `productionDate` currently derives from source production, not the actual mixing/placement date. Source age must not determine the age of a newly mixed product layer.
- Ingredient composition does not yet retain the moisture and dry-solids basis required below. Existing stocktake/loss rows do not preserve output-layer allocations.
- `allocateTrackedDryBiocharKg` already conserves dry mass to grams with an exact final remainder. Preserve proportional allocation for applications taking part of a mixed delivery.
- Feedstock bins, including bins holding blend ingredients, use wet stock under ADR 0027. Their withdrawal method remains unchanged.

## Evidence and assumptions

The project's pin is [Biochar Production and Storage v1.1](https://registry.isometric.com/protocol/biochar/1.1) and [Biochar Storage in Agricultural Soils v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1), as recorded in `docs/isometric/versions.json`. The earlier v1.3 references do not govern this project. Protocol §8.3.1 covers representative biochar sampling before blending and §8.3.1.1–2 covers mass evidence. A registry production batch maps to our **credit batch**, not automatically to an individual production run.

FIFO is our internal allocation and operating choice; these sources do not establish approval of this particular composition method. Pre-blend dry biochar remains the ceiling. Describe the physical loading practice, fixed ingredient-solids assumptions, measurement evidence, losses, and allocation method in the PDD before using the method to support credit claims. Do not claim that FIFO software proves the composition of a remixed pile.

Operators load the oldest material first and keep new arrivals separate from the material being loaded. Same formulation does not mean identical batch composition. If actual remixing defeats oldest-first loading, the physical assumption needs resolution; recording a FIFO allocation alone does not resolve it. Ingredient moisture is an editable prefill, not a new measurement approval workflow. Ingredient-solids decay is accepted as a conservative bias under the fixed-composition assumptions; no decay correction is included.

For correction design, the [ERPNext immutable-ledger pattern](https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext) supports retaining original entries and reversals. Our explicit, dependency-checked corrections deliberately stop short of a general historical reposting engine. This is engineering context, not registry evidence.

## Accepted rules

1. **Scope:** biochar bins and product bins. Feedstock and ingredient bins retain wet stock and pro-rata draws under ADR 0027.
2. **Stock:** remaining dry biochar per layer is authoritative. A layer is one completed production run in a biochar bin or one product batch in a product bin.
3. **Allocation:** FIFO across layers; proportional source-run shares within a homogeneous product layer. Physical loading also follows oldest-first.
4. **Measurements:** product creation uses source wet biochar and biochar-only departure moisture. Product-bin delivery uses actual wet load and whole-blend departure moisture. No arrival/application moisture workflow.
5. **Composition:** product creation prefills ingredient moisture from the oldest intake of each ingredient bin. The operator can override it. Retain the value and source used and freeze dry ingredient solids and source-run allocations; later source edits cannot silently recompute them.
6. **Formulations:** represent pure biochar with a required 100% biochar formulation with no ingredient lines. Product bins hold one formulation; batch solids ratios can still differ.
7. **Orders:** select a formulation and requested wet quantity. Show all matching bins and their dry availability using storage-bin mini cards. Orders reserve no stock and do not hard-block on insufficient current stock. An order is not a batch/bin allocation.
8. **Deliveries:** record completed loads only. Remove `upcoming`; saving a delivery immediately posts its measured FIFO dry withdrawal and log entry. Select the actual source bin at this point. Reject insufficient stock, including shortages caused by a lower moisture reading.
9. **Mass display:** lead with wet mass removed and show dry biochar directly underneath in smaller text. A draw does not update the recorded pile moisture or its stored wet measurement/estimate. Before/after bin cards may show conditional wet estimates at a common, explicitly stated moisture, with dry biochar underneath; those preview values are not new bin measurements or persisted stock updates.
10. **Record loss:** enter lost wet mass, moisture, and reason. Use the same FIFO allocation as a draw. Log the dry loss and remaining stock; do not apply this moisture to the remaining pile.
11. **Reconcile stock:** enter counted remaining wet mass and current moisture. Compare both expected and counted stock on that same dry-solids basis. Preview any shortage as per-layer FIFO dry losses before posting. A zero count closes the exact dry remainder without needing moisture. Drying alone must not produce a loss.
12. **Positive counts:** unexplained stock additions and unknown-origin layers are out of scope. A count above tracked stock cannot create drawable or creditable stock. Show the difference and route to correcting an identified source record; do not invent provenance.
13. **Corrections:** preserve original entries plus a linked correction/reversal/replacement, with reason, actor, time, before/after allocations, and bin balances. Correcting a mistaken loss restores its original provenance; it is not a new positive stock intake.
14. **Dependencies:** allow corrections only when affected dry mass, composition, allocation, or balance is not relied on by subsequent operations or applications. Block and identify dependent entries. New intake or notes alone are not blanket blockers. Certification guards remain binding.
15. **Late entries:** a late intake never silently rewrites posted deliveries. An unused delivery can be explicitly corrected using eligible stock if balance and dependency checks pass. A later application using that delivery blocks the change. No general replay of downstream history.
16. **Applications:** a partial application takes proportional shares of the recorded mixed truck. Show product-batch dry kilograms and percentages, with run details. Do not walk the bin FIFO again.
17. **Deferred:** all bin-to-bin transfers, including whole-bin moves, remain in [#34](https://github.com/Maji-Studio/noma-dmrv/issues/34). A storage-bin edit must not disguise a move of used stock. Facility-wide history and CSV remain in [#33](https://github.com/Maji-Studio/noma-dmrv/issues/33); this work includes the necessary per-bin transaction history.
18. **Data rollout:** no production backfill or transitional compatibility. Maintain the migration chain for development/tests. Notify the user before resetting shared staging when implementation lands.

## Layer model and FIFO order

| Quantity | Biochar bin | Product bin |
|---|---|---|
| Source | Completed production run | Product batch |
| Physical date | Actual production completion/placement | Actual mixing/placement date |
| Established dry biochar `B` | Established source dry mass | Sum of product source-run dry allocations |
| Established dry ingredients `I` | 0 | Sum of ingredient wet mass × (1 − moisture used) |
| Biochar share of solids `f` | 1 | `B / (B + I)` |
| Remaining dry biochar `R` | `B − active draws − active losses` | Same |
| Remaining dry solids | `R` | `R / f` |
| Run provenance | This run | Frozen allocated dry run shares |

Water added affects wet product mass, not `B`, `I`, or `f`. Use exact stored quantities when deriving `f`, not rounded displayed percentages. Require positive biochar for a drawable layer, so `0 < f ≤ 1`.

Keep physical date, recorded-at time, and a stable posting sequence distinct. Among eligible available layers, order by physical date, then stable creation/posting order for same-day ties. Do not add operator time-of-day input just to break ties. A draw cannot use material physically dated after the draw. New/late receipts are available to subsequent postings, while saved historical allocations remain authoritative. A correction is an explicit new posting linked to its original; it must display any changed historical attribution.

## Draw calculation

Inputs are wet mass `W > 0` and departure moisture fraction `0 ≤ m < 1`:

```text
S = W × (1 − m)                         dry solids requested
capacity_i = R_i / f_i                  dry solids available in layer i
takenSolids_i = min(S_left, capacity_i)
takenBiochar_i = takenSolids_i × f_i
wetShare_i = takenSolids_i / (1 − m)
```

Walk oldest-first until `S_left = 0`. If demand remains after the final eligible layer, reject the entire action. Never post a partial withdrawal as though the full delivery succeeded. Show available dry biochar, requested dry solids, and the load wet equivalent `Σ(R_i/f_i)/(1−m)` at the entered moisture. This equivalent is a capacity for this entered load, not a new measurement of the remaining bin.

Persist the source-layer allocation and its source-run dry split. Retain enough immutable input/basis data to explain the calculation later. Use integer grams/fixed precision and deterministic remainder allocation: dry totals, run splits, and final depletion must close exactly. Round display values separately; a display rounding tolerance must not authorize an overdraw.

## Reconciliation and corrections

For a nonempty count with wet mass `C` and current moisture `m_count`:

```text
expectedSolids = Σ(R_i / f_i)
countedSolids = C × (1 − m_count)
shortageSolids = expectedSolids − countedSolids
```

A positive shortage uses the same FIFO walk with that solids demand. Zero shortage records a count without changing dry stock. A negative shortage records/shows the observation without increasing stock; correcting a known omitted/incorrect source is a separate explicit action. Never calculate the expected pile at yesterday's moisture and compare it with today's wet count. A count of zero removes exactly all remaining layer dry stock.

Preview and commit must use the same balance basis. Within one organization-scoped transaction, lock all affected source/bin/dependency records, re-read balances, validate, and append the movement/allocations/audit event atomically. If stock changes after preview, return a conflict and refreshed preview. Make duplicate submissions idempotent. Readers must use the same authoritative derivation for cards, detail, forms, and credit reporting.

For a correction, undo the original allocation within the validation transaction, calculate the proposed replacement, and reject if it exceeds eligible stock or would invalidate a dependent entry. The original and correction remain visible. A later draw that consumed an affected layer, a balance-dependent stocktake, an application of the delivery, or a certification lock can block a stock-changing correction; unrelated notes/intakes do not. No automatic correction of those dependents is included.

Examples: a loss entered as 100 kg dry instead of 10 kg dry can restore 90 kg to the original layer when dependency checks pass. Entering Monday's missing intake on Wednesday leaves Tuesday's saved delivery alone; explicitly correcting that unused delivery may change its source shares, but only with a before/after preview and a log. Wednesday's physically new production cannot fund Tuesday's delivery.

## Worked examples

The example values below use exact `f`, not its three-decimal display.

| Layer | Biochar input | Ingredient input | Dry biochar | Dry ingredients | `f` |
|---|---|---|---:|---:|---:|
| Mix A, day 1 | 1,000 kg wet at 10% | 500 kg manure at 60% | 900 kg | 200 kg | 9/11 |
| Mix B, day 2 | 700 kg wet; exactly 600 kg dry (14.285714…% moisture) | 300 kg manure at 60% | 600 kg | 120 kg | 5/6 |

Initial total: 1,500 kg dry biochar and 1,820 kg dry solids. Creation wet mass is 2,500 kg, implying combined creation moisture of 27.2%. That historical figure is not the default measurement for a later load.

| Scenario | Inputs | Allocation/result |
|---|---|---|
| Rain | 2,000 kg wet at 30% | 1,400 kg solids; A 900 kg dry + B 250 kg dry; 1,150 kg delivered, 350 kg remains |
| Dried | 2,000 kg wet at 20% | 1,600 kg solids; A 900 + B 416.667 kg dry; 1,316.667 kg delivered, 183.333 kg remains |
| Whole-bin shortage | 2,500 kg wet at 15% | Needs 2,125 kg solids, only 1,820 available; blocked; wet capacity at this reading is 2,141.176 kg |
| Only A remains | 1,500 kg wet at 15% | Needs 1,275 kg solids, only 1,100 available; blocked; wet capacity 1,294.118 kg |
| Loss after rain load | 120 kg lost wet at 30% | 84 kg solids, 70 kg dry biochar lost from B; 280 kg dry remains |
| Reconcile after rain load | Count 600 kg wet at 30% | 420 kg solids equals tracked B remainder; no dry loss |
| Empty after rain load | Count 0 kg | Exact 350 kg dry loss from B, with B provenance |
| Drying without loss | Pure biochar: 100 kg dry; previous count 200 kg at 50%; new count 100 kg at 0% | Still 100 kg dry; zero loss |
| Partial application | Half of rain delivery: 1,000 kg wet | 575 kg dry, A 450 + B 125; same 78.261% / 21.739% shares as the truck |
| Biochar-bin draw | R1: 760 kg dry, R2: 540 kg dry; draw 1,000 kg wet at 8% | R1 760 + R2 160 = 920 kg dry; 380 kg dry remains |

After the rain load, 600 kg is B's wet equivalent **if B is also at 30% moisture**. Saving that delivery must not show 600 kg as a newly measured bin wet balance. The previous draft's claim that the current code would over-credit A on the 2,000 kg dried load was incorrect: the present one-product wet-capacity guard would block that load against A alone.

## Implementation slices and code map

1. **Composition and relationships:** require formulations including Pure biochar; retain ingredient moisture/source and dry solids; add actual product placement date; move orders from product to formulation. Update schemas/forms and shared query contracts, including all matching bins rather than the default first 20.
2. **One allocation engine:** fixed-precision pure FIFO planner, stable order and eligible dates, layer/run splits, dry/solids ceilings, loss and reconciliation inputs. Keep the proportional mixed-delivery application allocator.
3. **Biochar-bin route:** replace `planBiocharProductSourceAllocations` proportional spread with FIFO; persist product run allocations and exact source dry caps. Update overdraw previews and atomic stock guards.
4. **Product-bin delivery route:** source bin plus multiple product-layer allocations and run splits; remove upcoming status across schema, forms, lists, filters, seeds, and stock predicates. Persist authoritative delivery dry mass as allocation sum. Retire obsolete one-product/inventory assumptions without transitional schema compatibility.
5. **Provenance consumers:** migrate `credit-batch-application-slices.ts`, `credit-batch-accounting.ts`, `credit-batch-lineage-filter.ts`, `certification-lineage-guards.ts`, traceability, and transport/source resolution to actual allocations. A delivery touching A and B must find and protect both lineages. Preserve application proportional shares and caps.
6. **Losses, counts, corrections:** extend the append-only movement contract with per-layer/run loss and correction allocations; implement affected-dependency checks, correction preview, actor/reason/history, transactional revalidation, and idempotency. Reuse existing audit seams; do not wait for or build a generic manual-lock product under #200.
7. **Operator surfaces:** reusable bin cards, wet removal with smaller dry biochar underneath, before/after cards with bars on a common scale, visible batch breakdown and blocked state, bin loss/reconciliation actions, linked correction comparison, per-bin history in a More info modal, and application shares. Coordinate history projection with #33; no separate duplicate ledger or facility-wide export scope.
8. **Verification and rollout:** regression coverage below, shared derivation across surfaces, documentation updates and working reset/migration path. No database reset as part of planning.

## Acceptance and verification

- Per layer, active draws plus losses never exceed established dry biochar. Corrections retain the original ceiling and cannot restore more than the original affected allocation.
- Source/run split totals equal layer allocations, layer allocations equal delivery dry mass, and applied dry mass never exceeds the delivery. Multiple partial draws/applications and the final remainder close to grams.
- FIFO exhausts eligible earlier layers before later ones for each posting; saved postings remain unchanged on later intake. Late-date exceptions are visible in history, not silently replayed.
- Measured moisture changes demand for a new draw or proposed correction. It never independently changes dry stock or remaining-pile moisture. Zero/nonfinite/missing inputs and 100% moisture follow explicit validation rules.
- Pin every worked example, including no-loss drying, two-layer shortage, pure biochar, split run shares, and exact zero count.
- Test concurrent delivery/loss/count/correction transactions and repeated submissions: one consistent nonnegative result, no double posting, and no orphaned audit or source rows.
- Test correction without dependents, rejection after an affected draw/count/application, intake-only non-blocking behavior, notes-only edits, late intake without replay, and explicit correction of an unused delivery.
- Test all matching formulation bins beyond the first page, empty stock allowed on orders, source-bin/formulation mismatch on deliveries, and required Pure biochar formulation.
- Test Organization/facility/source isolation and source/target certification locks on create, update, correction, and relationship changes. Every normal data-access seam keeps `OrgContext` and `requireOrgScope`.
- End-to-end: product creation → completed delivery spanning A/B → partial application → both credit-batch lineages and shares; verify card/detail/form agree and no remaining route consumes the old single-product allocation.

## UI specification

Use existing storage-bin mini cards and the project's square, bordered surface style. Orders show formulation, requested wet mass, and matching bins with qualified availability; they do not preview or reserve an allocation. For a removal, wet mass is the primary figure and dry biochar sits immediately below in smaller text. Keep dry stock authoritative for accounting and guards without making it the headline operator quantity.

Use two columns: **Before loading** on the left and **After loading** on the right. Show every affected physical storage bin as its own standard storage-bin card in each column, with the same bin aligned across the row. Each card includes its bin code, formulation/type, wet amount, smaller dry biochar underneath, batch bar, and More info action. Keep emptied bins visible in the after column. Batch layers such as Mix A and Mix B remain segments inside their physical bin; do not turn them into separate bin cards or replace several affected bins with one aggregate card. This display rule also applies to other workflows affecting several bins; it does not define how sources are selected or introduce FIFO across different bins.

Use a common mass basis and scale so an untouched layer never appears to grow. Wet-equivalent cards and bars use one explicitly stated moisture and an estimate marker on both sides; show dry biochar underneath. For the rain example this conditional preview is about 2,600 kg wet before, 2,000 kg wet removed, and 600 kg wet after at 30%, with 1,500 / 1,150 / 350 kg dry biochar respectively. The recorded creation total remains 2,500 kg wet; no shipment reading overwrites it. Dry biochar, dry solids, and wet mass must not be mixed within one unlabeled bar. Keep the batch breakdown visible, grouped by source bin, with wet amounts and smaller dry biochar values beneath, and source-run details accessible without hover. On narrow screens stack each bin's before/after pair with explicit stage labels.

Bin actions are **Record loss** and **Reconcile stock**. A linked **Correct entry** action shows original and proposed measurements, source shares, dry balances, required reason, and any named blocking entry. Open bin history through a **More info** modal instead of an inline history panel. The log contains intake, completed draw, loss, count, and linked correction with actor/time, measured wet mass when available, and dry effect. Show physical date and recorded date when a late entry makes the distinction relevant. The modal also explains the basis of conditional wet estimates. It supports keyboard focus, Escape, and returning focus to its trigger.

Applications show dry kilograms and percentage per product batch, plus source-run detail. Copy follows `docs/ux-writing.md`; no en/em dashes in operator copy. The inline walkthroughs are design previews with sample data, not shipping UI or evidence of registry acceptance.

## Related work

- ADR 0029 records the accepted accounting boundary; CONTEXT.md records the vocabulary.
- #34 remains the backlog for all bin-to-bin transfers. Preserve source provenance and atomic two-bin stock changes when it is picked up; detailed transfer ordering is not settled here.
- #33 owns facility-wide history and CSV; #200 is now a separate manual whole-record lock feature, not the definition of this correction flow.
- PDD methodology/evidence validation remains a registry-facing follow-up before credit use. Arrival/application moisture, unknown-origin additions, and historical replay remain out of scope.
