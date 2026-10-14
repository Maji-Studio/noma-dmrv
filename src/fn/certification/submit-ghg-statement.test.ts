import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { GhgStatementReportRow } from "@/data-access/ghg-statement-reports";
import { hashVerifierToken } from "@/lib/certification/ghg-statement-report/verifier-url";
import {
  EXTERNAL_STATEMENT_ID,
  GENERATED_REPORT_URL,
  makeRemoteStatement,
  makeStatementRow,
  REPORT_DOCUMENT_ID,
  REPORT_ID,
  STATEMENT_ID,
} from "../../../tests/fixtures/isometric-ghg-statement";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/server", () => ({ requireOrgRole: vi.fn() }));
vi.mock("@/lib/log", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    child: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock("@/data-access/certification", () => ({
  appendSyncEvent: vi.fn(),
  attachReportDocument: vi.fn(),
  updateSubmissionMetadata: vi.fn(),
  clearTerminalStatusForResubmit: vi.fn(),
  setSubmissionTerminalStatus: vi.fn(),
}));
vi.mock("@/data-access/certification-submissions", () => ({
  getLatestSubmission: vi.fn(),
}));
vi.mock("@/data-access/certifier-ghg-statements", () => ({
  getCertifierGhgStatementById: vi.fn(),
  countRemovalsByGhgStatementIds: vi.fn(),
}));
vi.mock("@/data-access/facilities", () => ({ getFacilityById: vi.fn() }));
vi.mock("@/data-access/facility-durability-lock", () => ({
  withFacilityDurabilitySessionLock: vi.fn(
    async (_ctx, _facilityId, callback: () => Promise<unknown>) => callback(),
  ),
}));
vi.mock("@/data-access/ghg-statement-reports", () => ({
  getApprovedGhgStatementReport: vi.fn(),
  promotePendingVerifierReportToken: vi.fn(),
  clearPendingVerifierReportToken: vi.fn(),
}));
vi.mock("./ghg-statement-report-core", () => ({
  assertGhgStatementReportFresh: vi.fn(),
  issueVerifierReportUrl: vi.fn(),
}));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  getIsometricClientForOrg: vi.fn(),
  getGhgStatement: vi.fn(),
  submitGhgStatement: vi.fn(),
  resubmitGhgStatement: vi.fn(),
}));

import * as certification from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { getCertifierGhgStatementById } from "@/data-access/certifier-ghg-statements";
import { getFacilityById } from "@/data-access/facilities";
import * as reports from "@/data-access/ghg-statement-reports";
import * as isometric from "@/lib/isometric";
import { logger } from "@/lib/log";
import { issueVerifierReportUrl } from "./ghg-statement-report-core";
import { submitGhgStatementToVerifierCore } from "./submit-ghg-statement";

const SUBMISSION_ID = "submission-audit-test";
const orgCtx = {
  userId: "user-audit-test",
  organizationId: "org-audit-test",
  orgRole: "owner" as const,
  isPlatformAdmin: false,
};
let submission: CertificationSubmissionRow;

beforeEach(() => {
  vi.resetAllMocks();
  submission = {
    id: SUBMISSION_ID,
    externalId: EXTERNAL_STATEMENT_ID,
    status: "submitted",
    metadata: { remoteStatus: "DRAFT" },
  } as CertificationSubmissionRow;
  vi.mocked(getLatestSubmission).mockResolvedValue(submission);
  vi.mocked(getCertifierGhgStatementById).mockResolvedValue(makeStatementRow());
  vi.mocked(getFacilityById).mockResolvedValue({ code: "F-AUDIT" } as never);
  vi.mocked(reports.getApprovedGhgStatementReport).mockResolvedValue({
    id: REPORT_ID,
    documentId: REPORT_DOCUMENT_ID,
    verifierTokenHash: hashVerifierToken("opaque"),
    pendingVerifierTokenHash: null,
  } as GhgStatementReportRow);
  vi.mocked(reports.promotePendingVerifierReportToken).mockResolvedValue(true);
  vi.mocked(issueVerifierReportUrl).mockResolvedValue(GENERATED_REPORT_URL);
  vi.mocked(certification.updateSubmissionMetadata).mockImplementation(
    async (_ctx, _id, metadata) => {
      submission.metadata = {
        ...(submission.metadata as Record<string, unknown> | null),
        ...metadata,
      };
    },
  );
});

describe("GHG verifier success audit failures", () => {
  it.each(["direct", "lost-response", "already-applied"] as const)(
    "finalizes %s success when the audit insert fails",
    async (path) => {
      const remoteBefore = makeRemoteStatement();
      const remoteAfter = makeRemoteStatement({
        status: "AWAITING_VERIFICATION",
        ghg_statement_report_url: GENERATED_REPORT_URL,
        submitted_at: "2026-02-01T10:00:00Z",
      });
      vi.mocked(isometric.getGhgStatement).mockResolvedValueOnce(
        path === "already-applied" ? remoteAfter : remoteBefore,
      ).mockResolvedValue(remoteAfter);
      if (path === "lost-response") {
        vi.mocked(isometric.submitGhgStatement).mockRejectedValue(
          new Error("response lost"),
        );
      } else {
        vi.mocked(isometric.submitGhgStatement).mockResolvedValue(remoteAfter);
      }
      vi.mocked(certification.appendSyncEvent).mockRejectedValue(
        new Error("audit insert failed"),
      );

      await expect(submitGhgStatementToVerifierCore({
        orgCtx,
        ghgStatementId: STATEMENT_ID,
        input: { reportId: REPORT_ID },
      })).resolves.toEqual({
        externalId: EXTERNAL_STATEMENT_ID,
        remoteStatus: "AWAITING_VERIFICATION",
      });

      expect(submission.metadata).toMatchObject({
        remoteStatus: "AWAITING_VERIFICATION",
        lastReportDocumentId: REPORT_DOCUMENT_ID,
        submittedToVerifierAt: expect.any(String),
      });
      expect(certification.appendSyncEvent).toHaveBeenCalledOnce();
      const event = vi.mocked(certification.appendSyncEvent).mock.calls[0][1];
      const response = event.responsePayload as Record<string, unknown>;
      expect(event.status).toBe("succeeded");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          ghgStatementId: STATEMENT_ID,
          submissionId: SUBMISSION_ID,
          submissionAttemptId: response.submission_attempt_id,
        }),
        "failed to record certifier sync event",
      );
      expect(isometric.submitGhgStatement).toHaveBeenCalledTimes(
        path === "already-applied" ? 0 : 1,
      );
      expect(reports.promotePendingVerifierReportToken).toHaveBeenCalledTimes(
        path === "already-applied" ? 0 : 1,
      );
    },
  );
});
