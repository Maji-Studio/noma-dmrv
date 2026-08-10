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

function formatNonNegativeTenthKg(kg: number): string {
  if (kg !== 0 && kg < 1) {
    return `${kg.toFixed(1)} kg`;
  }
  return `${kg.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} kg`;
}

/** Actionable maximum: clamp deficits to zero and never round above stock. */
export function formatStockLimitKg(kg: number): string {
  const safeLimitKg = Math.max(0, Math.floor(kg * 10) / 10);
  return formatNonNegativeTenthKg(safeLimitKg);
}

/** Actionable minimum: never round below the mass that must be retained. */
export function formatStockMinimumKg(kg: number): string {
  const safeMinimumKg = Math.max(
    0,
    Math.ceil((kg - STOCK_OVERDRAW_EPSILON_KG) * 10) / 10,
  );
  return formatNonNegativeTenthKg(safeMinimumKg);
}

/** Compact field feedback; detailed reconciliation guidance belongs nearby. */
export function binStockOverdrawInlineMessage(
  material: StockMaterial,
  availableKg: number,
): string {
  const userFacingMaterial =
    material === "feedstock"
      ? "wet feedstock"
      : material === "product"
        ? "biochar"
        : material;
  const massLabel = material === "feedstock" ? "wet mass" : "mass";
  return `Only ${formatStockLimitKg(availableKg)} of ${userFacingMaterial} is available. Reduce the ${massLabel}.`;
}

/** Compact delivery-form feedback; the server keeps the detailed race message. */
export function deliveryStockOverdrawInlineMessage(
  availableKg: number,
): string {
  return `Only ${formatStockLimitKg(availableKg)} of biochar is available. Reduce the delivered mass.`;
}

export function binStockOverdrawMessage(
  material: StockMaterial,
): string {
  const userFacingMaterial = material === "feedstock" ? "wet feedstock" : "biochar";
  return `Not enough ${userFacingMaterial} in this bin`;
}

export function productStockOverdrawMessage(): string {
  return "Not enough biochar in this product";
}

export function deliveryStockOverdrawMessage(): string {
  return "Not enough biochar in this delivery";
}
