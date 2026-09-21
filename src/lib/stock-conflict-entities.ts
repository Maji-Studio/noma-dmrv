/**
 * Entity keys a stock refusal puts in its `conflict` and `blockers`
 * (`src/lib/conflict-ref.ts`). Shared by the server that raises the refusal
 * and the forms that read it, so neither side carries a copied string.
 * Kept free of server-only imports so client components can use it.
 */

export const STOCK_CONFLICT_ENTITY = {
  storageLocation: "storageLocation",
  productionRun: "productionRun",
  biocharProduct: "biocharProduct",
  binMovement: "binMovement",
} as const;
