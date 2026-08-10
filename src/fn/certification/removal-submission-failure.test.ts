import { describe, expect, it } from "vitest";
import {
  readRemovalSubmissionExternalMutation,
  recordRemovalExternalMutation,
} from "./removal-submission-failure";

describe("Removal submission external-mutation recovery", () => {
  it("hydrates a resumed attempt and never downgrades confirmed uncertainty", () => {
    const attempt = {
      externalMutation: readRemovalSubmissionExternalMutation({
        externalMutation: "confirmed",
      }),
    };

    expect(attempt.externalMutation).toBe("confirmed");
    recordRemovalExternalMutation(attempt, "possible");
    expect(attempt.externalMutation).toBe("confirmed");
  });

  it("defaults invalid persisted metadata to no external mutation", () => {
    expect(readRemovalSubmissionExternalMutation(null)).toBe("none");
    expect(
      readRemovalSubmissionExternalMutation({ externalMutation: "unknown" }),
    ).toBe("none");
  });
});
