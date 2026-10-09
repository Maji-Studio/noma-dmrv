import { z } from "zod";

const balanceSchema = z.object({
  wetKg: z.number().nullable().describe("Wet kilograms; null for output bins where wet stock is not tracked."),
  dryKg: z.number().nullable().describe("Dry kilograms. Feedstock uses the existing intake-moisture estimate, null when its basis is unavailable; output bins use the established dry-layer balance, null for unresolved layers."),
});
export const stockBalanceSchema = z.object({
  storageLocationId: z.uuid().describe("Stock bin identifier, UUID."),
  storageLocationCode: z.string().describe("Human-readable stock bin code."),
  stockKind: z.enum(["feedstock_bin", "biochar_bin", "product_bin"]).describe("Stock lane: feedstock bin, biochar output bin, or product output bin."),
  balance: balanceSchema.describe("Current bin balance in kilograms."),
});
export const stockEffectSchema = stockBalanceSchema.omit({ balance: true }).extend({
  before: balanceSchema.describe("Bin balance before the write, in kilograms."),
  after: balanceSchema.describe("Bin balance after the write, before rollback, in kilograms."),
  delta: balanceSchema.describe("After minus before, in kilograms; negative means stock removed."),
});
export const stockEffectsSchema = z.array(stockEffectSchema).describe("Changed bin balances inside the dry-run transaction, before rollback. All masses are kilograms.");
export type StockBalance = z.infer<typeof stockBalanceSchema>;
export type StockEffects = z.infer<typeof stockEffectsSchema>;

export function diffStockBalances(before: StockBalance[], after: StockBalance[]): StockEffects {
  return before.flatMap(({ balance, ...bin }) => {
    const next = after.find((row) => row.storageLocationId === bin.storageLocationId)?.balance;
    if (!next) throw new Error("A snapshotted stock bin disappeared during the operation.");
    if (next.wetKg === balance.wetKg && next.dryKg === balance.dryKg) return [];
    return [{ ...bin, before: balance, after: next, delta: {
      wetKg: next.wetKg === null || balance.wetKg === null ? null : next.wetKg - balance.wetKg,
      dryKg: next.dryKg === null || balance.dryKg === null ? null : next.dryKg - balance.dryKg,
    } }];
  });
}
