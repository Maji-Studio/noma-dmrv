# Inline product and order UI prototype

The user selected an **always-inline flow** for [#816](https://github.com/Maji-Studio/noma-dmrv/issues/816) and [#817](https://github.com/Maji-Studio/noma-dmrv/issues/817). This draft explores the final details of that direction. It is not a production form or accounting change.

## Run

After the repository's usual `pnpm install`, run:

```sh
pnpm prototype:stock-ui
```

- http://127.0.0.1:3116/biochar-products?prototype=stock
- http://127.0.0.1:3116/orders?prototype=stock

Old `variant=A`, `B`, and `C` links all render this same inline design. There is no floating switcher, separate review rail, or reserved blank viewport band.

When reusing another worktree's dependency directory, `pnpm --config.verify-deps-before-run=false run prototype:stock-ui` skips pnpm's automatic dependency reconciliation. Vite is a pinned direct development dependency; the launcher also resolves the same installed Vite through Vitest in a shared dependency directory.

The preview uses the actual prototype components and app CSS in a synthetic shell. It does not start the Next.js app, read environment files, authenticate, fetch domain data, or write records. It is a loopback-only component preview, not an application authentication bypass.

## Selected interaction design

The product form follows placement, source, formulation/ingredients, then product bin. Ingredient wet mass and moisture sit together at desktop width. A compact final summary distinguishes wet product, dry biochar, and ingredient dry solids. **Show composition** and **Show stock changes** expand separately beneath their triggers in the normal page flow. Their labels change to **Hide** while open.

The order form puts formulation before requested wet mass, followed by quiet availability. **Show batch stock** reveals the inline breakdown; empty batches remain optional within that detail. The rejected reservation and departure-moisture explanations are absent.

Input errors and exceeded source/ingredient wet stock are always visible beside the affected field. Moisture basis is accessible through the canonical field hint. Destination bins use compact visible choices, avoiding a bottom-of-sheet popup. Review product/order only displays an inline acknowledgement. Reset example restores fixture values. All state stays in memory.

The synthetic example is 250 kg wet biochar at 3% moisture + 50 kg water + 100 kg ingredient at 30% moisture: 400 kg wet product, 242.5 kg dry biochar, 70 kg ingredient dry solids. This demo does not enforce formulation ratios or reproduce FIFO/accounting logic. Its calculations are not a production contract.

## Application boundaries

In a configured authenticated development app (`pnpm dev`), `?prototype=stock` on the existing `/biochar-products` and `/orders` routes renders this design under the original protected layout. Normal routes remain unchanged. Production builds disable prototype entry, including deployed PR previews.

The full-page preview verifies information hierarchy and inline interactions. Real drawer geometry, large destination-bin sets, real-data validation, and final production behavior still need verification in the implementation phase. Keep this draft on its prototype branch; apply the selected design separately while preserving authorization, stock conservation, and order semantics.
