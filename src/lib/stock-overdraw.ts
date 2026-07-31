const STOCK_OVERDRAW_EPSILON_KG = 1e-6;

export type StockMaterial = "feedstock" | "biochar" | "product";

export function isStockOverdraw(
  requestedKg: number,
  availableKg: number,
): boolean {
  return requestedKg - availableKg > STOCK_OVERDRAW_EPSILON_KG;
}

export function formatStockKg(kg: number): string {
  if (kg !== 0 && Math.abs(kg) < 1) return `${kg.toFixed(1)} kg`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

/** Compact field feedback; detailed reconciliation guidance belongs nearby. */
export function binStockOverdrawInlineMessage(
  material: StockMaterial,
  availableKg: number,
): string {
  return `Only ${formatStockKg(availableKg)} of ${material} is available. Reduce the mass.`;
}

/** Compact delivery-form feedback; the server keeps the detailed race message. */
export function deliveryStockOverdrawInlineMessage(
  availableKg: number,
): string {
  return `Only ${formatStockKg(availableKg)} of product is available. Reduce the delivered mass.`;
}

export function binStockOverdrawMessage(
  material: StockMaterial,
): string {
  const userFacingMaterial = material === "feedstock" ? "feedstock" : "biochar";
  return `Not enough ${userFacingMaterial} in this bin`;
}

export function productStockOverdrawMessage(): string {
  return "Not enough biochar in this product";
}

export function deliveryStockOverdrawMessage(): string {
  return "Not enough biochar in this delivery";
}
