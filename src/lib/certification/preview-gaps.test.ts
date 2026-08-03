import { describe, expect, it } from "vitest";
import {
  hasStoredCo2eOperatorInputGap,
  STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
} from "./preview-gaps";

describe("stored CO₂e preview gaps", () => {
  it("does not present the protocol-version drift lock as an operator input gap", () => {
    expect(
      hasStoredCo2eOperatorInputGap([
        STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
      ]),
    ).toBe(false);
  });

  it("keeps recordable and setup gaps actionable", () => {
    expect(hasStoredCo2eOperatorInputGap(["dryMassTonnes"])).toBe(true);
    expect(
      hasStoredCo2eOperatorInputGap([
        STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
        "facilityCertifierProject",
      ]),
    ).toBe(true);
  });
});
