const OUTPUT_STOCK_EVENT_LABELS: Record<string, string> = {
  delivery: "Delivery", loss: "Lost mass", count: "Stock count", intake: "Added",
  production_draw: "Product creation", product_draw: "Product withdrawal",
  reversal: "Reversal", replacement: "Replacement", moisture_update: "Moisture updated",
  merge: "Switched to mix", split: "Switched to split",
};

/** A mix bin's one pile goes by the bin's own name, marked as a mix ("BCF mix"). */
export function mixPileName(binName: string): string {
  return `${binName} mix`;
}

export function outputStockEventLabel(kind: string): string {
  return OUTPUT_STOCK_EVENT_LABELS[kind] ?? "Stock movement";
}

/** The one stock action on every bin, and the sheet it opens. */
export const STOCK_ACTION_LABEL = "Adjust stock";
/** What the stock action records: mass that left the bin without a delivery or draw. */
export const LOST_MASS_LABEL = "Lost mass";
export const LOST_MASS_SUBMIT_LABEL = "Save lost mass";

/** An application builds on the delivery, so its stock can no longer change. */
export const deliveryAppliedLockedReason = (applicationCode: string) => `Locked because application ${applicationCode} uses this delivery. Correct or remove the application first.`;
