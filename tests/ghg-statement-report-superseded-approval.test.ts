import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getApprovedGhgStatementReport } from "@/data-access/ghg-statement-reports";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import {
  certifierGhgStatementReports,
  certifierGhgStatements,
} from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = `test-user-superseded-${crypto.randomUUID().slice(0, 8)}`;
const FACILITY_ID = crypto.randomUUID();
const STATEMENT_ID = crypto.randomUUID();
const V1_DOCUMENT_ID = crypto.randomUUID();
const V1_REPORT_ID = crypto.randomUUID();
const V2_DOCUMENT_ID = crypto.randomUUID();
const V2_REPORT_ID = crypto.randomUUID();

function documentRow(id: string, reportId: string) {
  return {
    id,
    organizationId: TEST_ORG_ID,
    entityType: "ghgStatementReport",
    entityId: reportId,
    documentType: "pdf" as const,
    storageProvider: "test",
    storageBucket: "test",
    storageKey: `org/${TEST_ORG_ID}/reports/${reportId}.pdf`,
    fileName: "report.pdf",
    visibility: "private" as const,
    uploadStatus: "uploaded" as const,
    createdBy: TEST_USER_ID,
  };
}

function reportRow(args: {
  id: string;
  documentId: string;
  version: number;
  lifecycle: "prepared" | "approved";
}) {
  const approval =
    args.lifecycle === "approved"
      ? { approvedBy: TEST_USER_ID, approvedAt: new Date() }
      : {};
  return {
    id: args.id,
    organizationId: TEST_ORG_ID,
    ghgStatementId: STATEMENT_ID,
    documentId: args.documentId,
    version: args.version,
    lifecycle: args.lifecycle,
    sourceFingerprint: "a".repeat(64),
    contentChecksumSha256: "b".repeat(64),
    frozenInput: {},
    reportModel: {},
    reviewedNarratives: {},
    preparationIdempotencyKey: crypto.randomUUID(),
    verifierTokenHash: "c".repeat(64),
    preparedBy: TEST_USER_ID,
    preparedAt: new Date(),
    ...approval,
  };
}

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({
    id: TEST_USER_ID,
    email: `${TEST_USER_ID}@example.com`,
    name: "Superseded Approval Tester",
    role: "admin",
    emailVerified: true,
  });
  await db.insert(facilities).values({
    id: FACILITY_ID,
    organizationId: TEST_ORG_ID,
    name: `Superseded Facility ${FACILITY_ID.slice(0, 8)}`,
    code: `SA-${FACILITY_ID.slice(0, 8)}`,
  });
  await db.insert(certifierGhgStatements).values({
    id: STATEMENT_ID,
    organizationId: TEST_ORG_ID,
    facilityId: FACILITY_ID,
    reportingPeriodEndOn: "2026-07-31",
  });
  await db.insert(documents).values(documentRow(V1_DOCUMENT_ID, V1_REPORT_ID));
  await db
    .insert(certifierGhgStatementReports)
    .values(
      reportRow({
        id: V1_REPORT_ID,
        documentId: V1_DOCUMENT_ID,
        version: 1,
        lifecycle: "approved",
      }),
    );
});

afterAll(async () => {
  await db
    .delete(certifierGhgStatementReports)
    .where(
      inArray(certifierGhgStatementReports.id, [V1_REPORT_ID, V2_REPORT_ID]),
    );
  await db
    .delete(documents)
    .where(inArray(documents.id, [V1_DOCUMENT_ID, V2_DOCUMENT_ID]));
  await db
    .delete(certifierGhgStatements)
    .where(eq(certifierGhgStatements.id, STATEMENT_ID));
  await db.delete(facilities).where(eq(facilities.id, FACILITY_ID));
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

describe("getApprovedGhgStatementReport supersession", () => {
  const orgCtx = makeTestOrgContext(TEST_USER_ID);

  it("returns the approved report while it is the latest version", async () => {
    const row = await getApprovedGhgStatementReport(orgCtx, {
      ghgStatementId: STATEMENT_ID,
      reportId: V1_REPORT_ID,
    });
    expect(row?.id).toBe(V1_REPORT_ID);
  });

  it("stops returning an older approval once a newer report is generated", async () => {
    await db
      .insert(documents)
      .values(documentRow(V2_DOCUMENT_ID, V2_REPORT_ID));
    await db
      .insert(certifierGhgStatementReports)
      .values(
        reportRow({
          id: V2_REPORT_ID,
          documentId: V2_DOCUMENT_ID,
          version: 2,
          lifecycle: "prepared",
        }),
      );

    await expect(
      getApprovedGhgStatementReport(orgCtx, {
        ghgStatementId: STATEMENT_ID,
        reportId: V1_REPORT_ID,
      }),
    ).resolves.toBeNull();
    // Without an explicit selection there is no submittable approval either:
    // the latest version is not approved yet.
    await expect(
      getApprovedGhgStatementReport(orgCtx, {
        ghgStatementId: STATEMENT_ID,
      }),
    ).resolves.toBeNull();
  });
});
