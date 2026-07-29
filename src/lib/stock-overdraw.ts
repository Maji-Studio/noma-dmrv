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

export function binStockOverdrawMessage(
  material: StockMaterial,
  availableKg: number,
  requestedKg: number,
): string {
  return `Not enough ${material} in this bin. ${formatStockKg(
    availableKg,
  )} available but this draw needs ${formatStockKg(
    requestedKg,
  )}. Reconcile the bin's stock (Storage Bins → the bin → Reconcile stock), then try again.`;
}

export function deliveryStockOverdrawMessage(
  productCode: string | null,
  availableKg: number,
  requestedKg: number,
): string {
  return `Cannot deliver ${formatStockKg(requestedKg)} from product ${
    productCode ?? "this batch"
  }: only ${formatStockKg(
    availableKg,
  )} remain undelivered. Reconcile the source bin or adjust the product before delivering.`;
}
