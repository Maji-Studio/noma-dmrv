import { formatStockKg } from "./stock-overdraw";

export function deliveryOrderBalanceMessage(availableKg: number): string {
  return `Exceeds order balance: ${formatStockKg(availableKg)} remaining.`;
}
