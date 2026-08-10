import { describe, expect, it } from "vitest";
import { SUBMISSION_EXTERNAL_MUTATIONS } from "@/lib/certification/submission-metadata";
import {
  readRemovalSubmissionExternalMutation,
  recordRemovalExternalMutation,
} from "./removal-submission-failure";

describe("Removal submission external-mutation recovery", () => {
  it("hydrates a resumed attempt and never downgrades confirmed uncertainty", () => {
    const attempt = {
      externalMutation: readRemovalSubmissionExternalMutation({
        externalMutation: SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
      }),
    };

    expect(attempt.externalMutation).toBe(
      SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
    );
    recordRemovalExternalMutation(
      attempt,
      SUBMISSION_EXTERNAL_MUTATIONS.possible,
    );
    expect(attempt.externalMutation).toBe(
      SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
    );
  });

  it("defaults invalid persisted metadata to no external mutation", () => {
    expect(readRemovalSubmissionExternalMutation(null)).toBe(
      SUBMISSION_EXTERNAL_MUTATIONS.none,
    );
    expect(
      readRemovalSubmissionExternalMutation({ externalMutation: "unknown" }),
    ).toBe(SUBMISSION_EXTERNAL_MUTATIONS.none);
  });
});
