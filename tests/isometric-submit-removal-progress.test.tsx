import {
  REMOVAL_ID,
  USER_ID,
  fakeExternalIds,
  makeContext,
} from "./fixtures/submit-removal-orchestrator";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SubmissionProgress } from "@/components/certification/submission-progress";
import * as biocharApplications from "@/fn/certification/biochar-applications";
import * as certifyContext from "@/fn/certification/certify-context-core";
import { submitRemoval } from "@/fn/certification/submit-removal";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";
import * as isometric from "@/lib/isometric";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/fn/certification/protocol-version-preflight", () => ({
  checkProtocolVersionAtSubmit: vi.fn(),
}));
vi.mock("@/lib/isometric/source-binding-verification", () => ({
  verifyRemovalSourceBindings: vi.fn(),
}));

it("shows a completed creation and failed evidence check when a dependent registry artifact fails", async () => {
  vi.mocked(certifyContext.loadRemovalSubmissionContext).mockResolvedValue(
    makeContext(),
  );
  vi.mocked(isometric.createDatapoint).mockImplementation(
    fakeExternalIds("dp") as never,
  );
  vi.mocked(isometric.createGhgEntry).mockImplementation(
    fakeExternalIds("rmv") as never,
  );
  const error =
    "The registered Storage Location differs from its current site facts.";
  vi.mocked(
    biocharApplications.ensureRemovalBiocharApplications,
  ).mockRejectedValueOnce(new Error(error));

  // Render the actual emitted events, so a missing completion event cannot be
  // hidden by a manually constructed, internally consistent UI fixture.
  const updates: SubmissionProgressUpdate[] = [];
  await expect(
    submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID),
      removalId: REMOVAL_ID,
      onProgress: (update) => updates.push(update),
    }),
  ).rejects.toThrow(error);
  expect(isometric.createGhgEntry).toHaveBeenCalledTimes(1);

  const html = renderToStaticMarkup(
    <SubmissionProgress kind="removal" updates={updates} error={error} />,
  );
  const creationStep = html.match(
    /<li\b[^>]*>(?:(?!<\/li>)[\s\S])*Creating Removal in Isometric(?:(?!<\/li>)[\s\S])*<\/li>/,
  )?.[0];
  expect(creationStep).toContain("Complete. ");
  expect(html).toContain("Checking evidence links failed.");
  expect(html).not.toContain("Creating Removal in Isometric failed.");
  expect(html).not.toContain("In progress. ");
  expect(html).not.toContain("animate-spin");
});
