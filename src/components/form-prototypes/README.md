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

| Variant | Product | Order |
| --- | --- | --- |
| A. Quiet captions | Small dry captions under each wet/moisture pair and compact final mass facts. | Compact requested wet and available dry biochar facts. |
| B. Paired readouts | Wet and explicitly named dry values side by side, with ingredient dry solids separate. | Requested wet and available dry biochar side by side. |
| C. Visual composition | Token-based strips separate dry biochar, ingredient dry solids and water, with text values. | Clearly labeled available dry biochar composition by batch only. |
| D. Inline calculation | Visible mass facts with optional live wet-basis equations and final sums. | Visible mass facts with optional batch-total basis; no wet-to-dry conversion. |
| E. Compact ledger | Material wet/dry rows and optional stock before/after. Whole-product dry includes ingredient solids. | Concise rows with explicit mass bases and optional batch stock. |

One Review action validates the form and acknowledges the preview in memory. Editing clears that acknowledgement; Reset example restores fixture values. Switching A–E retains input values without remounting the form controls. Product/Order navigation preserves the variant and starts a fresh fixture. Native disclosures contain only read-only detail and the existing empty-batch display toggle. No sticky or floating panels are used.

Independent wet and dry stock feedback remains beside each affected material's mass or moisture field even if other fields are invalid. Invalid component inputs render unavailable derived values, never fabricated zeros. Unsupported stock-after values are unavailable rather than negative. Unblended biochar excludes ingredient values from validation and clears ingredient errors. Requested wet order mass is never compared against dry stock availability or converted without moisture.

The unchanged synthetic example is 250 kg wet biochar at 3% moisture + 50 kg water + 100 kg ingredient at 30% moisture: 400 kg wet product, 242.5 kg dry biochar, 70 kg ingredient dry solids. Derived dry amounts use canonical `splitWetMass`.

Synthetic limits are independent: source 500 kg wet / 485 kg dry biochar; ingredient 400 kg wet / 280 kg dry solids. Changing moisture can exceed the dry limit before the wet limit, which blocks Review. Order stock is 332.5 kg dry biochar across DEMO-01 (0), DEMO-02 (90), DEMO-03 (242.5). No wet stock or batch moisture is invented. This demo does not enforce formulation ratios or reproduce FIFO/accounting logic. Its calculations are not a production contract. The existing simplified fixtures are retained rather than copying production fields or mutations.

## Application boundaries

In a configured authenticated development app (`pnpm dev`), `?prototype=stock` on the existing `/biochar-products` and `/orders` routes renders this design under the original protected layout. Normal routes remain unchanged. Production builds disable prototype entry, including deployed PR previews.

The full-page preview verifies information hierarchy and inline interactions. Real drawer geometry, large destination-bin sets, real-data validation, and final production behavior still need verification in the implementation phase. Keep this draft on its prototype branch; apply the selected design separately while preserving authorization, stock conservation, and order semantics.
