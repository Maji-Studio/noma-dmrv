# Inline product and order UI prototype

The user selected an **always-inline flow** for [#816](https://github.com/Maji-Studio/noma-dmrv/issues/816) and [#817](https://github.com/Maji-Studio/noma-dmrv/issues/817). This draft explores the final details of that direction. It is not a production form or accounting change.

## Run

After the repository's usual `pnpm install`, run:

```sh
pnpm prototype:stock-ui
```

- http://127.0.0.1:3116/biochar-products?prototype=stock
- http://127.0.0.1:3116/orders?prototype=stock

Add `&variant=A` through `&variant=E` to either URL. Missing or invalid variants render A. The in-flow switcher above the form preserves entered values; reload and browser back restore the URL-selected layout. Product/Order navigation preserves the variant and starts a fresh synthetic example. Reload resets values because they live only in memory.

When reusing another worktree's dependency directory, `pnpm --config.verify-deps-before-run=false run prototype:stock-ui` skips pnpm's automatic dependency reconciliation. Vite is a pinned direct development dependency; the launcher also resolves the same installed Vite through Vitest in a shared dependency directory.

The preview uses the actual prototype components and app CSS in a synthetic shell. It does not start the Next.js app, read environment files, authenticate, fetch domain data, or write records. It is a loopback-only component preview, not an application authentication bypass.

## Five wet/dry displays for each form

All five options preserve exactly the same synthetic input controls, grouping and order in fixed `FormSection` sections. All fields remain visible, except the existing unblended ingredient condition. Only read-only mass presentation changes. Supporting details expand inline; there are no steps or collapsed input sections.

| Variant | Geometry and tradeoff |
| --- | --- |
| A. Composition strip (recommended for scanning) | One truthful stacked strip, with labeled kg values and shares outside tiny segments. Compact whole-part overview. |
| B. Wet envelope | The 100% total contains a dry subset and water remainder. Mixed-product solids and water are grouped, with constituents labeled separately. Orders use a dry-stock envelope. |
| C. Aligned bars | Component rows start at the same zero and share the total-mass denominator. Easier comparison, more vertical space. |
| D. Mass equation | Additive labeled terms with proportional mini bars, followed by the total. Text terms are arithmetic, not equal-sized mass blocks. |
| E. Visual ledger | A compact semantic table with component mini bars, mass/share columns and a total footer. Useful for auditing. |

Every option combines a chart, direct labeled kg values and the same **View calculation** / **Hide calculation** action immediately below the readout. Source and ingredient readouts stay below their wet/moisture inputs. The final product/order summary stays above Review. Calculation controls use the shared Button, a chevron, a 44px target, unique `aria-controls`, `aria-expanded`, and contextual accessible names. Enter/Space toggles inline formulas, which update while open. Stock before and after remains a separate disclosure.

All order geometries show **available dry biochar by batch**, including the zero batch, with only dry stock in the denominator. Requested wet mass sits separately above the visual. A water-colored batch, wet stock inference or wet-to-dry conversion would misrepresent this fixture.

## Research and eventual access

See the [research note](../../../docs/plans/2026-09-21-wet-dry-composition-research.md) for progressive disclosure, direct labeling and chart accessibility sources. The brief refines that note's exploratory ring into the visual ledger and standardizes the action to View calculation. These are design hypotheses, not user-tested findings.

Keep essential inputs, mass quantities and validation visible; hide only formula details. In eventual read-only record details, retain a **Mass and composition** section with mass values and a small visual always visible, followed by the same **View calculation** disclosure. Use saved inputs and the applicable calculation version. A list link may target that section; an unrelated global info icon should not be the access point. This prototype does not mutate real record UI or persist calculations.

Charts use exact computed proportions with no minimum segment width. External labels and patterned swatches retain tiny components and avoid color-only identification. Small positive quantities below display precision use a less-than label. Shares use the canonical percent formatter. Unknown components suppress the complete visual and derived shares; an actual zero total says No mass entered and has no percentage denominator. Expanded equations use approximation signs and a rounding note.

One Review action validates the form and acknowledges the preview in memory. Editing clears that acknowledgement; Reset example restores fixture values. Switching A–E retains input values without remounting the form controls. Product/Order navigation preserves the variant and starts a fresh fixture. Calculation disclosures contain only read-only formulas; native stock disclosures retain the existing empty-batch display toggle. No sticky or floating panels are used.

Independent source wet/dry stock and ingredient wet-stock feedback remains beside the affected fields even if other fields are invalid. Invalid component inputs render unavailable derived values, never fabricated zeros. Unsupported stock-after values are unavailable rather than negative. Unblended biochar excludes ingredient values from validation and clears ingredient errors. Requested wet order mass is never compared against dry stock availability or converted without moisture.

The unchanged synthetic example is 250 kg wet biochar at 3% moisture + 50 kg water + 100 kg ingredient at 30% moisture: 400 kg wet product, 242.5 kg dry biochar, 70 kg ingredient dry solids, 37.5 kg existing water and 50 kg added water. Derived dry amounts use canonical `splitWetMass`.

Synthetic limits are independent: source 500 kg wet / 485 kg dry biochar; ingredient 400 kg wet. Source moisture can exceed the biochar dry limit before its wet limit, which blocks Review; ingredient dry solids do not limit withdrawals. Order stock is 332.5 kg dry biochar across DEMO-01 (0), DEMO-02 (90), DEMO-03 (242.5). No wet stock or batch moisture is invented. This demo does not enforce formulation ratios or reproduce FIFO/accounting logic. Its calculations are not a production contract. The existing simplified fixtures are retained rather than copying production fields or mutations.

## Application boundaries

In a configured authenticated development app (`pnpm dev`), `?prototype=stock` on the existing `/biochar-products` and `/orders` routes renders this design under the original protected layout. Normal routes remain unchanged. Production builds disable prototype entry, including deployed PR previews.

The full-page preview verifies information hierarchy and inline interactions. Real drawer geometry, large destination-bin sets, real-data validation, and final production behavior still need verification in the implementation phase. Keep this draft on its prototype branch; apply the selected design separately while preserving authorization, stock conservation, and order semantics.

Calculation precision: the shared `splitWetMass` helper rounds dry mass to 0.001 kg before deriving water. At very small inputs (for example 0.001 kg wet at 3% moisture), it returns 0.001 kg dry and 0 kg water, so the prototype shows a rounded 100% dry split. The visual exploration retains that existing calculation contract; sub-gram composition fidelity needs a separate domain decision before production adoption. Browser verification identified this edge case; it is not a claim that the physical water fraction is zero.

Ingredient availability follows the domain wet-stock contract: only wet kg limit ingredient withdrawals. Ingredient dry solids remain a composition calculation, not a stock balance or withdrawal limit. Source biochar retains its wet/dry stock checks.
