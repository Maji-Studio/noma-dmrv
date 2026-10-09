import { expect, it } from "vitest";
import { diffStockBalances, stockEffectsSchema, type StockBalance } from "./stock-effects";
const bin: StockBalance = { storageLocationId: "00000000-0000-4000-8000-000000000001", storageLocationCode: "BIN-1", stockKind: "feedstock_bin", balance: { wetKg: 100, dryKg: 75 } };
it("reports balance changes, including removals, and omits unchanged bins", () => {
  expect(diffStockBalances([bin], [bin])).toEqual([]);
  const effects = diffStockBalances([bin], [{ ...bin, balance: { wetKg: 40, dryKg: 30 } }]);
  expect(stockEffectsSchema.parse(effects)[0]).toMatchObject({ before: bin.balance, after: { wetKg: 40, dryKg: 30 }, delta: { wetKg: -60, dryKg: -45 } });
});
it("preserves untracked wet mass and unknown dry estimates as null", () => {
  const before = { ...bin, stockKind: "biochar_bin" as const, balance: { wetKg: null, dryKg: 20 } };
  expect(diffStockBalances([before], [{ ...before, balance: { wetKg: null, dryKg: 30 } }])[0].delta).toEqual({ wetKg: null, dryKg: 10 });
  expect(diffStockBalances([bin], [{ ...bin, balance: { wetKg: 50, dryKg: null } }])[0].delta).toEqual({ wetKg: -50, dryKg: null });
});

it("preserves unknown observations even when both reads failed", () => {
  const unknown = { ...bin, balance: { wetKg: null, dryKg: null } };
  expect(diffStockBalances([unknown], [unknown])).toMatchObject([{ before: unknown.balance, after: unknown.balance, delta: unknown.balance }]);
  expect(diffStockBalances([bin], [])).toMatchObject([{ after: unknown.balance, delta: unknown.balance }]);
});
