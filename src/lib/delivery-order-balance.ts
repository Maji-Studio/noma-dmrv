import { formatStockKg } from "./stock-overdraw";

export function deliveryOrderBalanceMessage(availableKg: number): string {
  return `Only ${formatStockKg(availableKg)} remains on this order. Reduce the delivered mass.`;
}
