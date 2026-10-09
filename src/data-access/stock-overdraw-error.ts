import { SafeError } from "@/lib/errors";
import {
  binStockOverdrawMessage,
  type StockMaterial,
} from "@/lib/stock-overdraw";

/** SafeError subtype so server actions can attach field-level metadata. */
export class StockOverdrawError extends SafeError {
  constructor(message: string, readonly details?: { storageLocationId: string; availableWetKg: number; requestedWetKg: number }) {
    super(message);
    this.name = "StockOverdrawError";
  }
}

export function overdrawError(
  material: StockMaterial,
  details?: StockOverdrawError["details"],
): StockOverdrawError {
  return new StockOverdrawError(binStockOverdrawMessage(material), details);
}
