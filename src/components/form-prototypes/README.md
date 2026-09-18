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

## Five inline layouts for each form

| Variant | Product | Order |
| --- | --- | --- |
| A. Compact overview | Complete inputs followed by concise mass totals and separate composition/stock disclosures. | Complete inputs followed by requested wet mass, dry availability and batch disclosure. |
| B. At the source | Source and ingredient stock balances beneath their inputs; output at the destination. | Dry stock and batch details beside formulation, with requested wet mass in a separate section. |
| C. Expandable sections | Four editable summary rows with a live overview below. | Three editable summary rows with a live overview below. |
| D. Guided inline steps | Placement, source, ingredients and destination reveal in sequence, followed by review. | Customer/location, formulation and requested amount reveal in sequence, followed by review. |
| E. Review on demand | Lean inputs; Review reveals full composition and stock detail inline. | Lean inputs; Review reveals requested wet mass and full batch stock inline. |

Guided Continue validates the revealed fields and product stock limits before advancing. Completed steps remain editable inline. Errors open their section or remain clearly identified on its disclosure row. Review validates the whole form, including values in collapsed sections. An open review updates when values change; editing clears the reviewed acknowledgement. Reset example restores fixture values and the initial guided/review state. Native disclosures support keyboard operation. Inputs and action controls have mobile touch targets of at least 44px. No sticky or floating panels are used.

Input errors and exceeded source/ingredient wet stock stay beside the affected field. Switching to unblended biochar excludes ingredient values from validation and clears ingredient errors. Requested wet order mass is never compared against dry stock availability. Destination bins use visible radio choices. All state stays in memory.

The synthetic example is 250 kg wet biochar at 3% moisture + 50 kg water + 100 kg ingredient at 30% moisture: 400 kg wet product, 242.5 kg dry biochar, 70 kg ingredient dry solids. This demo does not enforce formulation ratios or reproduce FIFO/accounting logic. Its calculations are not a production contract.

## Application boundaries

In a configured authenticated development app (`pnpm dev`), `?prototype=stock` on the existing `/biochar-products` and `/orders` routes renders this design under the original protected layout. Normal routes remain unchanged. Production builds disable prototype entry, including deployed PR previews.

The full-page preview verifies information hierarchy and inline interactions. Real drawer geometry, large destination-bin sets, real-data validation, and final production behavior still need verification in the implementation phase. Keep this draft on its prototype branch; apply the selected design separately while preserving authorization, stock conservation, and order semantics.
