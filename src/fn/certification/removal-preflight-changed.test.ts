import { describe, expect, it, vi } from "vitest";
import {
  makeContext, REMOVAL_ID, USER_ID,
} from "../../../tests/fixtures/submit-removal-orchestrator";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { appendSyncEvent } from "@/data-access/certification";
import { claimSubmissionDraft } from "@/data-access/certification-submissions";
import { loadRemovalSubmissionContext } from "@/lib/certification/certify-context-core";
import { createDatapoint, createGhgEntry } from "@/lib/isometric";
import { InterruptedRemovalChangedError, CHANGED_SINCE_REVIEW_FAILURE_KIND } from "@/lib/certification/interrupted-removal-copy";
import { SafeError } from "@/lib/errors";
import { submitRemoval } from "./submit-removal";
import { assertRemovalPreflightBlockers } from "./removal-submission-freshness";

const SETTINGS_MESSAGE = "The template settings changed.";
const SETTINGS_BLOCKER = { code: "notRemovalTemplate" as const, message: SETTINGS_MESSAGE };

function draft(externalId: string | null, metadata: Record<string, unknown> | null): CertificationSubmissionRow {
  return { status: "draft", externalId, metadata } as CertificationSubmissionRow;
}

async function submit(ctx: ReturnType<typeof makeContext>) {
  vi.mocked(loadRemovalSubmissionContext).mockResolvedValue(ctx);
  return submitRemoval({ orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID, confirmProduction: true });
}

function expectNoClaimOrSend() {
  expect(claimSubmissionDraft).not.toHaveBeenCalled();
  expect(createDatapoint).not.toHaveBeenCalled();
  expect(createGhgEntry).not.toHaveBeenCalled();
}

describe("possibly sent Removal preflight", () => {
  it.each([
    draft("rmv-1", null),
    draft(null, { externalMutation: "possible" }),
    draft(null, { externalMutation: "confirmed" }),
  ])("records a changed stop for a settings blocker before claiming", async (latestSubmission) => {
    const ctx = makeContext(undefined, { latestSubmission, templateBlockers: [SETTINGS_BLOCKER] });
    const before = structuredClone(latestSubmission);
    await expect(submit(ctx)).rejects.toBeInstanceOf(InterruptedRemovalChangedError);
    expect(appendSyncEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      operation: "removal:submit:attempt-summary",
      responsePayload: expect.objectContaining({ failure_kind: CHANGED_SINCE_REVIEW_FAILURE_KIND }),
    }));
    expect(latestSubmission).toEqual(before);
    expectNoClaimOrSend();
  });

  it("keeps the first generic refusal when a failed template read accompanies settings blockers", async () => {
    const ctx = makeContext(undefined, {
      latestSubmission: draft(null, { externalMutation: "possible" }),
      templateBlockers: [SETTINGS_BLOCKER, { code: "templateNotFullyRead", message: "Template could not be read." }],
    });
    await expect(submit(ctx)).rejects.toThrow(SETTINGS_MESSAGE);
    expectNoClaimOrSend();
    expect(appendSyncEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      responsePayload: expect.objectContaining({ failure_kind: CHANGED_SINCE_REVIEW_FAILURE_KIND }),
    }));
  });

  it("keeps a never-sent evidence-refresh draft's generic refusal", async () => {
    const ctx = makeContext(undefined, {
      latestSubmission: draft(null, { externalMutation: "none", evidenceRefreshCandidates: [] }),
      templateBlockers: [SETTINGS_BLOCKER],
    });
    await expect(submit(ctx)).rejects.toThrow(SETTINGS_MESSAGE);
    expectNoClaimOrSend();
  });

  it("also stops on blockers from the full build pass", async () => {
    const ctx = makeContext(undefined, {
      latestSubmission: draft("rmv-1", null),
      submissionLineageBlockers: [{ detail: "Delivery proof changed.", fixTarget: "deliveryEvidence" } as never],
    });
    await expect(submit(ctx)).rejects.toBeInstanceOf(InterruptedRemovalChangedError);
    expectNoClaimOrSend();
  });

  it.each(["templateNotFullyRead", "noCredentials", "noProject"])("treats %s as an incomplete read", (code) => {
    expect(() => assertRemovalPreflightBlockers(draft("rmv-1", null), [
      SETTINGS_BLOCKER, { code, message: "Could not read." },
    ])).toThrow(SETTINGS_MESSAGE);
  });

  it.each([null, draft(null, null), { ...draft("rmv-1", null), status: "submitted" as const }])(
    "keeps the generic refusal outside possibly sent drafts", (latest) => {
      expect(() => assertRemovalPreflightBlockers(latest, [SETTINGS_BLOCKER])).toThrow(SafeError);
      expect(() => assertRemovalPreflightBlockers(latest, [SETTINGS_BLOCKER])).toThrow(SETTINGS_MESSAGE);
    },
  );
});
