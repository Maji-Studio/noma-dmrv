export const PROTOTYPE_VARIANTS = ["A", "B", "C"] as const;
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number];
export const PROTOTYPE_NAMES = { A: "Bottom summary", B: "Review rail", C: "Inline ledger" };

