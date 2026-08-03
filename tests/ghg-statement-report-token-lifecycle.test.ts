import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  clearPendingVerifierReportToken,
  getVerifierReportDocument,
  promotePendingVerifierReportToken,
  stageVerifierReportToken,
} from "@/data-access/ghg-statement-reports";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import {
  certifierGhgStatementReports,
  certifierGhgStatements,
} from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { hashVerifierToken } from "@/lib/certification/ghg-statement-report/verifier-url";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = `test-user-report-token-${crypto.randomUUID().slice(0, 8)}`;
const FACILITY_ID = crypto.randomUUID();
const STATEMENT_ID = crypto.randomUUID();
const DOCUMENT_ID = crypto.randomUUID();
const REPORT_ID = crypto.randomUUID();
const ACTIVE_TOKEN = "active-verifier-capability";

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({
    id: TEST_USER_ID,
    email: `${TEST_USER_ID}@example.com`,
    name: "Report Token Tester",
    role: "admin",
    emailVerified: true,
  });
  await db.insert(facilities).values({
    id: FACILITY_ID,
    organizationId: TEST_ORG_ID,
    name: `Report Token Facility ${FACILITY_ID.slice(0, 8)}`,
    code: `RT-${FACILITY_ID.slice(0, 8)}`,
  });
  await db.insert(certifierGhgStatements).values({
    id: STATEMENT_ID,
    organizationId: TEST_ORG_ID,
    facilityId: FACILITY_ID,
    reportingPeriodEndOn: "2026-07-31",
  });
  await db.insert(documents).values({
    id: DOCUMENT_ID,
    organizationId: TEST_ORG_ID,
    entityType: "ghgStatementReport",
    entityId: REPORT_ID,
    documentType: "pdf",
    storageProvider: "test",
    storageBucket: "test",
    storageKey: `org/${TEST_ORG_ID}/reports/${REPORT_ID}.pdf`,
    fileName: "report.pdf",
    visibility: "private",
    uploadStatus: "uploaded",
    createdBy: TEST_USER_ID,
  });
  await db.insert(certifierGhgStatementReports).values({
    id: REPORT_ID,
    organizationId: TEST_ORG_ID,
    ghgStatementId: STATEMENT_ID,
    documentId: DOCUMENT_ID,
    version: 1,
    lifecycle: "approved",
    sourceFingerprint: "a".repeat(64),
    contentChecksumSha256: "b".repeat(64),
    frozenInput: {},
    reportModel: {},
    reviewedNarratives: {},
    preparationIdempotencyKey: crypto.randomUUID(),
    verifierTokenHash: hashVerifierToken(ACTIVE_TOKEN),
    preparedBy: TEST_USER_ID,
    preparedAt: new Date(),
    approvedBy: TEST_USER_ID,
    approvedAt: new Date(),
  });
});

afterAll(async () => {
  await db
    .delete(certifierGhgStatementReports)
    .where(eq(certifierGhgStatementReports.id, REPORT_ID));
  await db.delete(documents).where(eq(documents.id, DOCUMENT_ID));
  await db
    .delete(certifierGhgStatements)
    .where(eq(certifierGhgStatements.id, STATEMENT_ID));
  await db.delete(facilities).where(eq(facilities.id, FACILITY_ID));
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

describe("GHG Statement verifier token lifecycle", () => {
  const orgCtx = makeTestOrgContext(TEST_USER_ID);

  it("stages and clears a pending token without changing the active token", async () => {
    const pendingToken = await stageVerifierReportToken(orgCtx, REPORT_ID);
    const staged = await getVerifierReportDocument(REPORT_ID);

    expect(staged).toMatchObject({
      verifierTokenHash: hashVerifierToken(ACTIVE_TOKEN),
      pendingVerifierTokenHash: hashVerifierToken(pendingToken),
    });

    await expect(
      clearPendingVerifierReportToken(orgCtx, {
        reportId: REPORT_ID,
        expectedTokenHash: hashVerifierToken(pendingToken),
      }),
    ).resolves.toBe(true);
    await expect(getVerifierReportDocument(REPORT_ID)).resolves.toMatchObject({
      verifierTokenHash: hashVerifierToken(ACTIVE_TOKEN),
      pendingVerifierTokenHash: null,
    });
  });

  it("promotes only the staged token and makes promotion idempotent", async () => {
    const pendingToken = await stageVerifierReportToken(orgCtx, REPORT_ID);

    await expect(
      promotePendingVerifierReportToken(orgCtx, {
        reportId: REPORT_ID,
        token: pendingToken,
      }),
    ).resolves.toBe(true);
    await expect(
      promotePendingVerifierReportToken(orgCtx, {
        reportId: REPORT_ID,
        token: pendingToken,
      }),
    ).resolves.toBe(true);

    const [row] = await db
      .select({
        lifecycle: certifierGhgStatementReports.lifecycle,
        verifierTokenHash: certifierGhgStatementReports.verifierTokenHash,
        pendingVerifierTokenHash:
          certifierGhgStatementReports.pendingVerifierTokenHash,
      })
      .from(certifierGhgStatementReports)
      .where(eq(certifierGhgStatementReports.id, REPORT_ID));
    expect(row).toEqual({
      lifecycle: "submitted",
      verifierTokenHash: hashVerifierToken(pendingToken),
      pendingVerifierTokenHash: null,
    });
  });
});
