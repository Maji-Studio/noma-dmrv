import { SafeError } from "@/lib/errors";
import {
  binStockOverdrawMessage,
  type StockMaterial,
} from "@/lib/stock-overdraw";

/** SafeError subtype so server actions can attach field-level metadata. */
export class StockOverdrawError extends SafeError {
  constructor(message: string) {
    super(message);
    this.name = "StockOverdrawError";
  }
}

export function overdrawError(
  material: StockMaterial,
): StockOverdrawError {
  return new StockOverdrawError(binStockOverdrawMessage(material));
}
