import { formatStockKg, isStockOverdraw } from "@/lib/stock-overdraw";

export function orderAvailabilityWarning(
  quantityKg: unknown,
  availableKg: number | null | undefined,
): string | undefined {
  if (
    typeof quantityKg !== "number" ||
    !Number.isFinite(quantityKg) ||
    availableKg == null ||
    !Number.isFinite(availableKg) ||
    !isStockOverdraw(quantityKg, availableKg)
  ) {
    return undefined;
  }

  return `Only ${formatStockKg(availableKg)} is currently available. Reduce the quantity or plan replenishment before fulfilling the order.`;
}
