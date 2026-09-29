const OUTPUT_STOCK_EVENT_LABELS: Record<string, string> = {
  delivery: "Delivery", loss: "Stock loss", count: "Stock count",
  production_draw: "Product creation", product_draw: "Product withdrawal",
  reversal: "Reversal", replacement: "Replacement", moisture_update: "Moisture updated",
  merge: "Merged into one pile",
};

/** A mix bin's one pile goes by the bin's own name, marked as a mix ("BCF mix"). */
export function mixPileName(binName: string): string {
  return `${binName} mix`;
}

export function outputStockEventLabel(kind: string): string {
  return OUTPUT_STOCK_EVENT_LABELS[kind] ?? "Stock movement";
}
