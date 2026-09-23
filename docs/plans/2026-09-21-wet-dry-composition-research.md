# Wet and dry composition exploration

Research date: 2026-09-21. Scope: inline prototype presentation, without changing inputs, calculations, stock semantics, or persistence.

## Recommendation

Combine C's visual composition with D's optional calculation. Default to a short proportional strip with direct component labels and exact masses, followed by one **View calculation** disclosure. Keep the wet mass input, moisture input, dry result, and validation visible. The visual answers “what is in this mass?”; the disclosure answers “how was it derived?”. The five alternatives below are design hypotheses to compare, not findings from user testing.

NNGroup recommends deferring secondary complexity while retaining primary options. GOV.UK recommends details for information needed by only some users, advises against hiding information most users need, and prefers a single details section over tabs/accordions for one secondary section. This supports revealing formulas, not gating the form itself. [NNGroup](https://www.nngroup.com/articles/progressive-disclosure/), [GOV.UK details](https://design-system.service.gov.uk/components/details/).

## Five visual alternatives

Each alternative uses identical fields and values, with the same calculation disclosure. Example numbers below are illustrative: 100 kg wet material, 70 kg dry biochar, 30 kg water. Product blends must additionally distinguish ingredient dry solids.

| Option | Concrete design | Best use and tradeoff |
| --- | --- | --- |
| A. Composition strip, recommended | One horizontal bar, dry biochar first, ingredient dry solids next when present, water last. Wet total sits above. Direct labels and exact masses sit immediately below in the same order. Formula expands beneath. | Fast, compact overview. Preserve proportional widths; small segments need external labels. A single bar expresses composition, not a comparison of amounts across cards. |
| B. Wet envelope | A thin outlined full-width track labeled “Wet mass 100 kg”; inside it, a solid portion labeled “Dry biochar 70 kg” and a hatched remainder for “Water 30 kg”. A brace below groups all solids in a blend. | Emphasizes that dry mass is contained within wet mass, avoiding two apparently competing totals. Keep height constant so only length encodes mass; avoid a realistic tank or pile illustration that implies volume or layering. |
| C. Aligned component bars | Separate labeled rows for dry biochar, ingredient dry solids, and water; each begins at the same zero baseline and uses the same kg scale, capped at wet total. Exact numbers align in a right column. | Best for comparing components and tiny quantities. Uses more vertical space; include wet total and an explicit sum so disconnected rows still read as one composition. |
| D. Mass balance equation | Three or four compact visual blocks in one line: “70 kg dry biochar” + “30 kg water” = “100 kg wet mass”. Small horizontal fills inside component blocks encode each share on the same scale. On phones, stack the terms while retaining + and =. | Strongest relationship explanation without exposing a formula by default. Avoid equal-sized colored blocks alone, which could imply equal proportions. The optional calculation supplies moisture input and actual multiplication. |
| E. Visual ledger | A semantic component table with direct row names, exact kg values, share of wet total, and a small bar in each row on the same scale. A final total row closes the table. Formula expands below. | Best for checking exact quantities in a final summary or saved record. Different from C because the numbers and table are primary and mini bars assist scanning. On phones, reduce columns without hiding names or kg values. |

Datawrapper notes that stacked charts suit totals and parts but make comparison of segments away from a shared baseline harder. The aligned-bar alternative deliberately addresses that weakness. Its accessibility guidance favors direct labels and redundant visual distinctions rather than color keys alone. [Stacked-chart guidance](https://www.datawrapper.de/academy/what-to-consider-when-creating-stacked-column-charts), [Colorblind-reader guidance](https://www.datawrapper.de/blog/colorblindness-part2).

For orders, adapt these geometries to **available dry biochar by batch**, which is additive on one basis. Show the requested wet mass separately. Do not create a wet-versus-dry progress meter, inferred moisture conversion, reservation, shortfall, or fulfillment percentage. The current prototype has no order moisture or allocated batch composition from which to derive those claims. A useful additional direction is a compact row for each batch with a common-scale dry mass bar and exact value; its calculation is the batch sum.

## Stable access during and after the form

1. Put the local composition immediately below the existing wet mass and moisture fields. Place **View calculation** directly below that result. Use one predictable treatment everywhere; avoid icon-only info controls and hover-only help.
2. At the end of the form, keep a visible **Product mass** or **Order mass** summary above the existing primary action. Show the final visual and key mass labels here, with a single **View calculation** disclosure containing the complete derivation. This is the final review access point, not a new step or modal.
3. For a future saved record, use the same visible **Mass and composition** section and disclosure in its normal detail view. A **View composition** link from a list can target that section. Any displayed saved calculation must use the saved record's inputs and applicable calculation version, not today's mutable defaults. This is a proposed access pattern, not a claim that persistence exists in this prototype.
4. The prototype variant picker is a design-review tool. Keep it separate from the operator's mass interaction. Do not ship five production viewing modes unless operator research establishes that need.

GOV.UK notes that some users mistake a details link for navigation. A visible chevron, the specific “View calculation” label, and content expanding in place make the action clearer. Avoid multiple competing ways to reveal the same calculation. [GOV.UK details](https://design-system.service.gov.uk/components/details/), [NNGroup](https://www.nngroup.com/articles/progressive-disclosure/).

## Accuracy and accessible behavior

- **Meaning:** wet mass includes water. Dry biochar excludes both water and blend ingredients. Never label all blend dry solids “dry biochar”. Use kg consistently with explicit wet/dry/component labels. Percentages are optional secondary information, not substitutes for masses. These are existing repo domain rules, not conclusions from the visualization sources. See [CONTEXT.md](../../CONTEXT.md).
- **Tiny segments:** allow true proportional size, even below one visible pixel. Keep an exact external mass label. Do not impose a minimum segment width that alters composition. If displayed precision would round a nonzero mass to zero, use a clear less-than value or increase relevant precision.
- **Zero:** show an actual 0 kg label; render no positive slice. A zero total gets an empty visual rather than a full-width “zero” bar.
- **Unknown or invalid:** show the shared “Not available” token for the derived value, with the missing input identified when useful. Suppress a complete-looking composition until all required parts are known. Never turn unknown into zero or normalize known parts to an implied complete whole. Follow [UX writing](../ux-writing.md).
- **Color:** use existing design tokens and stable component order. Pair the water fill with hatch and clear labels; do not rely on hue alone. Labels remain readable outside colored areas. W3C requires another visual means when color communicates meaning. [WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
- **Text equivalent:** expose each component and exact mass as ordinary readable text. A redundant decorative bar can be hidden from assistive technology. Do not add a second verbose screen-reader description of the same values. Complex standalone graphics need a text equivalent conveying their essential relationships. [WAI complex images](https://www.w3.org/WAI/tutorials/images/complex/).
- **Disclosure:** native details/summary or the WAI button disclosure pattern; keyboard Enter/Space toggles, with state conveyed accessibly. Preserve focus on the trigger, keep expanded contents in reading order, and avoid opening a modal. [WAI disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).
- **Touch:** use a generous full-width disclosure row, ideally the existing 44 px minimum-height convention. WCAG 2.2's minimum target criterion is 24 by 24 CSS pixels or permitted spacing/exceptions; 44 px here is a design recommendation, not a claim about that criterion. [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Alternatives to avoid for this task

Avoid Sankey flows as the default: they imply transfers and provenance and need more space than this form's composition question warrants. Avoid waffle grids, which require rounding and make tiny mass fractions hard to preserve. A composition ring is a possible additional exploration but is weaker for this compact form: tiny slices and side labels take space, and exact comparison depends on the labels. Avoid gauges, which suggest progress toward a target. Avoid 3D containers, material piles, and nested circles: they can imply volume, physical layering, or area ratios instead of mass. These are task-specific design judgments, not comparative usability-test results.

## Validation question

With identical example inputs, can an operator identify wet mass, dry biochar, ingredient solids, and water; explain why the wet total changes while dry biochar remains conserved; and reveal the derivation without losing their place? Check zero water, high moisture, tiny ingredients, unknown inputs, blends/unblended material, keyboard use, and a narrow touch viewport. Prefer the smallest visual that succeeds, rather than selecting by novelty.
