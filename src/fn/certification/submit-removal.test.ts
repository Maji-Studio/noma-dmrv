import { describe, expect, it } from "vitest";
import { firstSubmitBlockerMessage } from "./submit-removal";
import {
  REMOVAL_PREPARATION_BLOCKERS,
  type RemovalPreparationBlocker,
} from "./removal-submission-prepare";

function blocker(code: RemovalPreparationBlocker["code"]): RemovalPreparationBlocker {
  return { code, message: REMOVAL_PREPARATION_BLOCKERS[code] };
}

const TIER_MISMATCH_MESSAGE =
  "This facility uses 1000-year durability, but its default Removal " +
  "template uses an incompatible storage component.";

describe("firstSubmitBlockerMessage", () => {
  it("returns null when nothing blocks", () => {
    expect(firstSubmitBlockerMessage([], null)).toBeNull();
  });

  it("surfaces the tier mismatch even when durability support is off", () => {
    // Regression for PR #840 review thread PRRT_kwDORRVpZc6nImrB: a
    // production template that both mismatches the facility tier and
    // carries durability components must not have the tier diagnostic
    // masked by the durability-availability blocker.
    const message = firstSubmitBlockerMessage(
      [blocker("durabilityUnavailable")],
      TIER_MISMATCH_MESSAGE,
    );
    expect(message).toBe(TIER_MISMATCH_MESSAGE);
  });

  it("still surfaces durability-unavailable when the tier matches", () => {
    const message = firstSubmitBlockerMessage(
      [blocker("durabilityUnavailable")],
      null,
    );
    expect(message).toBe(REMOVAL_PREPARATION_BLOCKERS.durabilityUnavailable);
  });

  it("keeps template-shape blockers ahead of the tier guard", () => {
    const message = firstSubmitBlockerMessage(
      [blocker("notRemovalTemplate"), blocker("durabilityUnavailable")],
      TIER_MISMATCH_MESSAGE,
    );
    expect(message).toBe(REMOVAL_PREPARATION_BLOCKERS.notRemovalTemplate);
  });

  it("surfaces the tier guard alone when prepare finds no blockers", () => {
    const message = firstSubmitBlockerMessage([], TIER_MISMATCH_MESSAGE);
    expect(message).toBe(TIER_MISMATCH_MESSAGE);
  });
});
