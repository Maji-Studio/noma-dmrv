const OUTPUT_STOCK_EVENT_LABELS: Record<string, string> = {
  delivery: "Delivery", loss: "Stock loss", count: "Stock count",
  production_draw: "Product creation", product_draw: "Product withdrawal",
  reversal: "Reversal", replacement: "Replacement",
};

export function outputStockEventLabel(kind: string): string {
  return OUTPUT_STOCK_EVENT_LABELS[kind] ?? "Stock movement";
}
