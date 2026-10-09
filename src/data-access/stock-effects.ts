import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StockBalance } from "@/lib/representations/stock-effects";
import { requireOrgScope } from "./utils";
import { deriveLaneStock } from "./lane-stock-derivation";
import { getOutputBinAllLayersDryKg, UnresolvedOutputStockError } from "./output-stock";

/** Called once per writer attempt with all old/new bins, after locks and before mutation. */
export type SnapshotStock = (tx: DbTransaction, ids: ReadonlyArray<string | null | undefined>) => Promise<void>;

export async function readStockBalances(ctx: OrgContext, tx: DbTransaction, ids: ReadonlyArray<string | null | undefined>): Promise<StockBalance[]> {
  requireOrgScope(ctx);
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))].sort();
  if (!uniqueIds.length) return [];
  const bins = await tx.select({ id: storageLocations.id, code: storageLocations.code, type: storageLocations.type })
    .from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, uniqueIds)));
  const result: StockBalance[] = [];
  for (const bin of bins.sort((a, b) => a.id.localeCompare(b.id))) {
    if (bin.type === "feedstock_bin") {
      const [stock] = await deriveLaneStock(ctx, tx, { storageLocationIds: [bin.id], lanes: "feedstock" });
      result.push({ storageLocationId: bin.id, storageLocationCode: bin.code, stockKind: bin.type,
        balance: { wetKg: stock?.feedstockStockWetKg ?? 0, dryKg: stock ? stock.feedstockEstimatedDryKg : 0 } });
    } else if (bin.type === "biochar_bin" || bin.type === "product_bin") {
      let dryKg: number | null;
      try {
        dryKg = await getOutputBinAllLayersDryKg(ctx, bin.id, tx);
      } catch (error) {
        // A preview must not add a guard: incomplete historical layers have no
        // established balance. Preserve that unknown instead of inventing mass.
        if (!(error instanceof UnresolvedOutputStockError)) throw error;
        dryKg = null;
      }
      result.push({ storageLocationId: bin.id, storageLocationCode: bin.code, stockKind: bin.type,
        balance: { wetKg: null, dryKg } });
    }
  }
  return result;
}
