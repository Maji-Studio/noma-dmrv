# Throwaway product and order UI prototype

Question: how can operators enter quantities without large stock visualizations interrupting the form?

Related issues: [#816](https://github.com/Maji-Studio/noma-dmrv/issues/816), [#817](https://github.com/Maji-Studio/noma-dmrv/issues/817). No design has been selected. This branch is a draft prototype, not a production implementation or an accounting change.

## Run the synthetic preview

After the repository's usual `pnpm install`, run:

```sh
pnpm prototype:stock-ui
```

Open:

- http://127.0.0.1:3116/biochar-products?prototype=stock&variant=A
- http://127.0.0.1:3116/orders?prototype=stock&variant=A

When reusing an existing worktree's dependency directory, `pnpm --config.verify-deps-before-run=false run prototype:stock-ui` skips pnpm's automatic dependency reconciliation. Vite is pinned as a direct development dependency; the launcher can also resolve the same installed Vite through Vitest in a shared dependency directory.

The preview renders the actual prototype components and app CSS in a synthetic shell. It does not start the Next.js app, read environment files, authenticate, fetch domain data, or write records. This is a component preview, not a bypass of application authentication. It binds to loopback only.

## Compare variants

Use the floating arrows, keyboard arrows outside controls, or the shareable `variant=A`, `B`, `C` query parameter:

- **A, bottom summary:** compact final masses below all inputs; details expand on demand.
- **B, review rail:** input column with a separate review panel on wide screens; panel follows inputs on narrow screens.
- **C, inline ledger:** relevant derived values accompany source and ingredient inputs; the destination carries the final summary.

All three keep formulation before ingredient selection, pair ingredient wet mass and moisture at desktop width, give product bin its own fourth step, and use visible destination-bin choices instead of a bottom-of-sheet popup. Order quantity appears before optional batch details. Empty batches are opt-in. The two unwanted order explanations are absent.

Change masses and moisture, switch formulations and bins, expand details, show empty batches, review the prototype, and reset the example. Invalid numeric inputs and exceeded synthetic source stock remain visible. State is in memory and can be inspected through “Prototype state and assumptions.”

Fixture quantities illustrate presentation only: 250 kg source wet at 3% moisture + 50 kg water + 100 kg ingredient at 30% = 400 kg final wet, including 242.5 kg dry biochar and 70 kg ingredient dry solids. The demo does not enforce formulation ratios or reproduce FIFO/accounting logic. Do not treat its calculations as a production contract.

## Existing application routes

In a configured, authenticated development app (`pnpm dev`), the same query parameters on `/biochar-products` and `/orders` render these variants under the existing protected layout. Normal routes remain unchanged. All prototype routing and the switcher are disabled in production builds, including deployed PR previews. Use the local synthetic preview to review the draft without database setup.

The current full-page harness demonstrates information hierarchy; final drawer geometry, viewport placement, and real-data behavior need verification after a design is selected. The visible bin choices are a design alternative, not a production dropdown fix.

Keep this prototype on its throwaway branch. Implement the selected design separately and preserve existing authorization, stock conservation, validation, and order semantics.
