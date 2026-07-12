import { describe, expect, it, vi } from "vitest";

vi.mock("./sources", () => ({
  collectCandidateDocumentIdsForRemoval: vi.fn(),
  resolveSourceIdsForRemoval: vi.fn(),
}));

import type { RemovalSubmissionContext } from "./certify-context-core";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import * as sources from "./sources";

describe("buildRemovalSubmissionBuild", () => {
  it("blocks entity certification gaps before preparing registry inputs", async () => {
    const ctx = {
      entityReadinessGaps: [
        "Application APP-TEST-001: Upload the application logbook",
      ],
    } as unknown as RemovalSubmissionContext;

    await expect(
      buildRemovalSubmissionBuild({
        orgCtx: {} as never,
        removalId: "rem-test-1",
        ctx,
        defaultTemplate: {} as never,
        blueprintsByKey: new Map(),
        externalProjectId: "prj-test-1",
        allowPeriodInputStub: false,
        hasDurabilityComponents: false,
      }),
    ).rejects.toThrow(/entity certification readiness/i);

    expect(sources.collectCandidateDocumentIdsForRemoval).not.toHaveBeenCalled();
    expect(sources.resolveSourceIdsForRemoval).not.toHaveBeenCalled();
  });
});
