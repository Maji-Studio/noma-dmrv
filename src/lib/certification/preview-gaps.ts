export const STORED_CO2E_PREVIEW_REVERIFICATION_GAP =
  "Stored CO₂e preview pending current-module re-verification";

/** True when the local estimate is withheld by the protocol-version drift lock. */
export function isStoredCo2ePreviewReverificationGap(input: string): boolean {
  return input === STORED_CO2E_PREVIEW_REVERIFICATION_GAP;
}

/**
 * Whether an operator can resolve at least one preview gap by recording data or
 * completing setup. The drift lock is product-owned and must never be presented
 * as a missing operator input.
 */
export function hasStoredCo2eOperatorInputGap(
  missingInputs: readonly string[],
): boolean {
  return missingInputs.some(
    (input) => !isStoredCo2ePreviewReverificationGap(input),
  );
}
