import { formatStockLimitKg, isStockOverdraw } from "@/lib/stock-overdraw";

export function orderAvailabilityWarning(
  quantityKg: unknown,
  availableKg: number | null | undefined,
  options: { suppress?: boolean } = {},
): string | undefined {
  if (
    options.suppress ||
    typeof quantityKg !== "number" ||
    !Number.isFinite(quantityKg) ||
    availableKg == null ||
    !Number.isFinite(availableKg) ||
    !isStockOverdraw(quantityKg, availableKg)
  ) {
    return undefined;
  }

  return `Only ${formatStockLimitKg(availableKg)} is currently available. Reduce the quantity or plan replenishment before fulfilling the order.`;
}
