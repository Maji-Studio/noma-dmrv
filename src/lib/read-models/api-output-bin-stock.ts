import { readApiOutputBinStock as readStock, type ApiOutputBinStockInput } from "@/data-access/api-output-bin-stock";
import type { OrgContext } from "@/lib/auth/server";
import { representOutputBinStock } from "@/lib/representations/output-bin-stock";

/** Both transports return the same finalized representation envelope. */
export async function readApiOutputBinStock(ctx: OrgContext, input: ApiOutputBinStockInput) {
  const stock = await readStock(ctx, input);
  return { data: representOutputBinStock(stock) };
}
