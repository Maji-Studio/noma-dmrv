import { describe, expect, it } from "vitest";
import { chooseGhgSubmitModeFromKnownState } from "./ghg-statement-state";

describe("GHG Statement known-state fallback", () => {
  it.each([{}, { pendingTotalCo2eRemovedKg: 0 }, { pendingTotalCo2eRemovedKg: 1, remoteStatus: "unknown" }])("refuses incomplete registry metadata %j", (metadata) => {
    expect(() => chooseGhgSubmitModeFromKnownState(null, metadata)).toThrow("status is missing");
  });
  it("resubmits a known awaiting statement with a zero pending total", () => {
    expect(chooseGhgSubmitModeFromKnownState(null, { remoteStatus: "AWAITING_VERIFICATION", pendingTotalCo2eRemovedKg: 0 })).toBe("resubmit");
  });
});
