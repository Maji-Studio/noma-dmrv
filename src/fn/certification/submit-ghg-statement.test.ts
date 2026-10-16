import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data-access/certifier-credentials", () => ({
  resolveIsometricClient: vi.fn(),
}));

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

vi.mock("@/data-access/documents", () => ({ getDocumentById: vi.fn() }));
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
  getGhgStatement: vi.fn(),
  submitGhgStatement: vi.fn(),
  resubmitGhgStatement: vi.fn(),
}));

import { getDocumentById } from "@/data-access/documents";
import { __setStorageProviderForTests, StorageError, type StorageProvider } from "@/lib/storage";
import * as certification from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { getCertifierGhgStatementById } from "@/data-access/certifier-ghg-statements";
import { getFacilityById } from "@/data-access/facilities";
import * as reports from "@/data-access/ghg-statement-reports";
import { getGhgStatement, submitGhgStatement, resubmitGhgStatement } from "@/lib/isometric";
import { logger } from "@/lib/log";
import { issueVerifierReportUrl } from "./ghg-statement-report-core";
import { submitGhgStatementToVerifierCore } from "./submit-ghg-statement";

const CHECKSUM = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const readObjectBounded = vi.fn<StorageProvider["readObjectBounded"]>();
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
    organizationId: orgCtx.organizationId, version: 1, contentChecksumSha256: CHECKSUM,
    documentId: REPORT_DOCUMENT_ID,
    verifierTokenHash: hashVerifierToken("opaque"),
    pendingVerifierTokenHash: null,
  } as GhgStatementReportRow);
  vi.mocked(getDocumentById).mockResolvedValue({
    id: REPORT_DOCUMENT_ID, entityType: "ghgStatementReport", entityId: REPORT_ID,
    storageProvider: "local-fs", storageBucket: "test", uploadStatus: "uploaded",
    storageKey: `org/${orgCtx.organizationId}/ghgStatementReport/${REPORT_ID}/pdf/report.pdf`,
    mimeType: "application/pdf", fileSizeBytes: 3, checksumSha256: CHECKSUM,
  } as NonNullable<Awaited<ReturnType<typeof getDocumentById>>>);
  readObjectBounded.mockResolvedValue({ bytes: Buffer.from("abc"), sizeBytes: 3, sha256: CHECKSUM, contentType: "application/pdf" });
  __setStorageProviderForTests({
    name: "local-fs", bucket: "test", readObjectBounded,
    createUploadUrl: vi.fn(), createDownloadUrl: vi.fn(), getObject: vi.fn(),
    headObject: vi.fn(), deleteObject: vi.fn(), putObject: vi.fn(),
  });
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
      vi.mocked(getGhgStatement).mockResolvedValueOnce(
        path === "already-applied" ? remoteAfter : remoteBefore,
      ).mockResolvedValue(remoteAfter);
      if (path === "lost-response") {
        vi.mocked(submitGhgStatement).mockRejectedValue(
          new Error("response lost"),
        );
      } else {
        vi.mocked(submitGhgStatement).mockResolvedValue(remoteAfter);
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
      expect(submitGhgStatement).toHaveBeenCalledTimes(
        path === "already-applied" ? 0 : 1,
      );
      expect(reports.promotePendingVerifierReportToken).toHaveBeenCalledTimes(
        path === "already-applied" ? 0 : 1,
      );
    },
  );
});

afterEach(() => __setStorageProviderForTests(null));

describe("stored report verification before registry submission", () => {
  it.each([
    ["DRAFT", "ab", "file size"],
    ["DRAFT", "xyz", "report checksum"],
    ["FAILED_VERIFICATION", "ab", "file size"],
    ["FAILED_VERIFICATION", "xyz", "report checksum"],
  ] as const)("blocks %s with changed bytes %s", async (status, bytes, check) => {
    vi.mocked(getGhgStatement).mockResolvedValue(makeRemoteStatement({ status }));
    const remoteAfter = makeRemoteStatement({ status: "AWAITING_VERIFICATION", ghg_statement_report_url: GENERATED_REPORT_URL });
    vi.mocked(submitGhgStatement).mockResolvedValue(remoteAfter);
    vi.mocked(resubmitGhgStatement).mockResolvedValue(remoteAfter);
    readObjectBounded.mockResolvedValue({ bytes: Buffer.from(bytes), sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "application/pdf" });
    await expect(submitGhgStatementToVerifierCore({
      orgCtx, ghgStatementId: STATEMENT_ID,
      input: { reportId: REPORT_ID, summaryOfChanges: "Prepared corrected report." },
    })).rejects.toMatchObject({
      code: "report_verification_failed",
      message: `Version 1 of the GHG Statement report failed the ${check} check. Generate and approve a new report.`,
    });
    expect(submitGhgStatement).not.toHaveBeenCalled();
    expect(resubmitGhgStatement).not.toHaveBeenCalled();
    expect(issueVerifierReportUrl).not.toHaveBeenCalled();
    expect(reports.promotePendingVerifierReportToken).not.toHaveBeenCalled();
  });

  it.each([
    new StorageError("read timed out", "get_object_timeout"),
    Object.assign(new Error("network failure"), { code: "ECONNRESET" }),
    Object.assign(new Error("service unavailable"), { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } }),
  ])("preserves the cause and retryability before any report URL is issued: %s", async (cause) => {
    vi.mocked(getGhgStatement).mockResolvedValue(makeRemoteStatement({ status: "DRAFT" }));
    readObjectBounded.mockRejectedValue(cause);
    await expect(submitGhgStatementToVerifierCore({
      orgCtx, ghgStatementId: STATEMENT_ID, input: { reportId: REPORT_ID },
    })).rejects.toMatchObject({ code: "storage_unavailable", retryable: true, cause });
    expect(submitGhgStatement).not.toHaveBeenCalled();
    expect(resubmitGhgStatement).not.toHaveBeenCalled();
    expect(issueVerifierReportUrl).not.toHaveBeenCalled();
  });

  it.each([
    [new StorageError("denied", "object_access_denied"), "report_verification_failed"],
    [new StorageError("configuration", "storage_misconfigured"), "storage_not_configured"],
    [new StorageError("unavailable", "storage_unavailable"), "storage_unavailable"],
    [new StorageError("unsafe", "unsafe_key"), "storage_unavailable"],
    [new StorageError("failed", "get_object_failed"), "storage_unavailable"],
    [new TypeError("invalid argument"), "storage_unavailable"],
    [Object.assign(new Error("bad request"), { $metadata: { httpStatusCode: 400 } }), "storage_unavailable"],
    [null, "storage_unavailable"],
  ])("classifies read errors before issuing a report URL: %s", async (cause, code) => {
    vi.mocked(getGhgStatement).mockResolvedValue(makeRemoteStatement({ status: "DRAFT" }));
    readObjectBounded.mockRejectedValue(cause);
    await expect(submitGhgStatementToVerifierCore({
      orgCtx, ghgStatementId: STATEMENT_ID, input: { reportId: REPORT_ID },
    })).rejects.toMatchObject({ code, retryable: code === "storage_unavailable", cause });
    expect(submitGhgStatement).not.toHaveBeenCalled();
    expect(resubmitGhgStatement).not.toHaveBeenCalled();
    expect(issueVerifierReportUrl).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "FAILED_VERIFICATION"] as const)("submits intact stored bytes from %s", async (status) => {
    vi.mocked(getGhgStatement).mockResolvedValue(makeRemoteStatement({ status }));
    const remoteAfter = makeRemoteStatement({ status: "AWAITING_VERIFICATION", ghg_statement_report_url: GENERATED_REPORT_URL });
    vi.mocked(submitGhgStatement).mockResolvedValue(remoteAfter);
    vi.mocked(resubmitGhgStatement).mockResolvedValue(remoteAfter);
    await expect(submitGhgStatementToVerifierCore({
      orgCtx, ghgStatementId: STATEMENT_ID,
      input: { reportId: REPORT_ID, summaryOfChanges: "Prepared corrected report." },
    })).resolves.toMatchObject({ remoteStatus: "AWAITING_VERIFICATION" });
    expect(readObjectBounded).toHaveBeenCalledOnce();
    expect(status === "DRAFT" ? submitGhgStatement : resubmitGhgStatement).toHaveBeenCalledOnce();
  });
});
