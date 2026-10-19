import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  getReportByPreparationKey,
  insertPreparedGhgStatementReport,
  listGhgStatementReports,
} from "@/data-access/ghg-statement-reports";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { users } from "@/db/schema/auth";
import {
  certifierGhgStatementReports,
  certifierGhgStatements,
} from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { prepareGhgStatementReport } from "@/fn/certification/ghg-statement-reports";
import { loadLiveReportFacts } from "@/fn/certification/ghg-statement-report-core";
import { requireOrgContext } from "@/lib/auth/server";
import {
  buildGhgStatementReportModel,
  sha256Hex,
  type BuildGhgStatementReportModelInput,
} from "@/lib/certification/ghg-statement-report/model";
import { renderGhgStatementReportPdf } from "@/lib/certification/ghg-statement-report/pdf";
import { hashVerifierToken } from "@/lib/certification/ghg-statement-report/verifier-url";
import { getStorageProvider } from "@/lib/storage";
import {
  TEST_SITE_POSITION,
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

// Keep role checks, org scope, database queries and locks real. Stub the session
// boundary and report-generation dependencies that do not need persistence.
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(),
  requireOrgContext: vi.fn(),
}));
vi.mock("@/fn/certification/ghg-statement-report-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/fn/certification/ghg-statement-report-core")>(),
  loadLiveReportFacts: vi.fn(),
}));
vi.mock("@/lib/certification/ghg-statement-report/pdf", () => ({
  renderGhgStatementReportPdf: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ getStorageProvider: vi.fn() }));

const TEST_USER_ID = `test-user-report-persistence-${crypto.randomUUID()}`;
const FACILITY_ID = crypto.randomUUID();
const STATEMENT_ID = crypto.randomUUID();
const FIRST_VERSION = 1;
const NEXT_VERSION = FIRST_VERSION + 1;
const PREPARED_AT = new Date("2026-07-31T12:00:00.000Z");
const REPORT_BYTES = Buffer.from("test report bytes");
const DOCUMENT_UNIQUE_CONSTRAINT =
  "certifier_ghg_statement_reports_document_id_unique";
const orgCtx = makeTestOrgContext(TEST_USER_ID);

function reportInput(
  reportVersion = FIRST_VERSION,
  preparedAt = PREPARED_AT.toISOString(),
): BuildGhgStatementReportModelInput {
  return {
    reportVersion,
    preparedAt,
    documentControl: {
      organizationName: "Report Persistence Tester",
      facilityCode: "RP-TEST",
      externalProjectId: "prj_test",
      externalGhgStatementId: "ggs_test",
      reportingPeriodStartOn: "2026-07-01",
      reportingPeriodEndOn: "2026-07-31",
      standardVersion: "1.7",
      protocolVersion: "1.1.1",
      configuredProtocolVersion: null,
    },
    authoritativeStatement: {
      externalEntryIds: ["entry_test"],
      pendingTotalCo2eRemovedKg: 0,
      creditAllocation: null,
    },
    remoteEntries: [{
      id: "entry_test",
      startedOn: "2026-07-01",
      completedOn: "2026-07-31",
      netRemovedKg: 0,
      netRemovedWithoutDiscountKg: 0,
      netRemovedStandardDeviationKg: null,
    }],
  };
}

function preparedReportArgs() {
  const reportId = crypto.randomUUID();
  const reportModel = buildGhgStatementReportModel(reportInput());
  return {
    reportId,
    ghgStatementId: STATEMENT_ID,
    documentId: crypto.randomUUID(),
    version: FIRST_VERSION,
    sourceFingerprint: reportModel.sourceFingerprint,
    contentChecksumSha256: sha256Hex(REPORT_BYTES),
    frozenInput: { input: reportInput() },
    reportModel,
    preparationKey: crypto.randomUUID(),
    verifierTokenHash: hashVerifierToken("test-verifier-capability"),
    preparedAt: PREPARED_AT,
    storage: {
      provider: "local-fs",
      bucket: "test",
      key: `org/${TEST_ORG_ID}/reports/${reportId}.pdf`,
      fileName: "report.pdf",
      fileSizeBytes: REPORT_BYTES.byteLength,
    },
  };
}

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({
    id: TEST_USER_ID,
    email: `${TEST_USER_ID}@example.com`,
    name: "Report Persistence Tester",
    role: "admin",
    emailVerified: true,
  });
  await db.insert(facilities).values({
    ...TEST_SITE_POSITION,
    timezone: "UTC",
    id: FACILITY_ID,
    organizationId: TEST_ORG_ID,
    name: `Report Persistence Facility ${FACILITY_ID}`,
    code: `RP-${FACILITY_ID}`,
  });
  await db.insert(certifierGhgStatements).values({
    id: STATEMENT_ID,
    organizationId: TEST_ORG_ID,
    facilityId: FACILITY_ID,
    reportingPeriodEndOn: "2026-07-31",
  });
  vi.mocked(requireOrgContext).mockResolvedValue(orgCtx);
});

afterEach(async () => {
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, TEST_USER_ID));
  await db.delete(certifierGhgStatementReports)
    .where(eq(certifierGhgStatementReports.ghgStatementId, STATEMENT_ID));
  await db.delete(documents).where(eq(documents.createdBy, TEST_USER_ID));
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(certifierGhgStatements)
    .where(eq(certifierGhgStatements.id, STATEMENT_ID));
  await db.delete(facilities).where(eq(facilities.id, FACILITY_ID));
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

describe("GHG Statement report persistence", () => {
  it("replays the preparation key through the writer without inserting another report or document", async () => {
    const args = preparedReportArgs();
    await expect(getReportByPreparationKey(orgCtx, args)).resolves.toBeNull();
    const first = await insertPreparedGhgStatementReport(orgCtx, args);
    const replay = await insertPreparedGhgStatementReport(orgCtx, {
      ...preparedReportArgs(),
      preparationKey: args.preparationKey,
      version: NEXT_VERSION,
      frozenInput: { changed: true },
      contentChecksumSha256: sha256Hex("later request body"),
    });

    expect(replay).toEqual(first);
    await expect(getReportByPreparationKey(orgCtx, args))
      .resolves.toEqual(first.report);
    await expect(listGhgStatementReports(orgCtx, STATEMENT_ID))
      .resolves.toEqual([first.report]);
    const storedDocuments = await db.select().from(documents)
      .where(eq(documents.createdBy, TEST_USER_ID));
    expect(storedDocuments).toEqual([first.document]);
  });

  it("prepares twice through the action and returns the first report when the request body changes", async () => {
    const putObject = vi.fn(async () => {});
    vi.mocked(getStorageProvider).mockReturnValue({
      name: "local-fs",
      bucket: "test",
      putObject,
      deleteObject: vi.fn(),
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      getObject: vi.fn(),
      headObject: vi.fn(),
      readObjectBounded: vi.fn(),
    });
    vi.mocked(renderGhgStatementReportPdf).mockResolvedValue(REPORT_BYTES);
    vi.mocked(loadLiveReportFacts).mockImplementation(async (_ctx, args) => ({
      input: reportInput(args.reportVersion, args.preparedAt),
      frozenInput: { input: reportInput(args.reportVersion, args.preparedAt) },
    }));
    const input = {
      ghgStatementId: STATEMENT_ID,
      preparationKey: crypto.randomUUID(),
      ensureFirst: true,
    };
    const first = await prepareGhgStatementReport(input);
    expect(first).toMatchObject({ success: true, data: { version: FIRST_VERSION } });
    if (!first.success) throw new Error("Report preparation failed.");
    const [storedReport] = await listGhgStatementReports(orgCtx, STATEMENT_ID);

    const replay = await prepareGhgStatementReport({ ...input, ensureFirst: false });

    expect(replay).toEqual(first);
    await expect(getReportByPreparationKey(orgCtx, input)).resolves.toEqual(storedReport);
    await expect(listGhgStatementReports(orgCtx, STATEMENT_ID))
      .resolves.toEqual([storedReport]);
    const storedDocuments = await db.select({ id: documents.id }).from(documents)
      .where(eq(documents.createdBy, TEST_USER_ID));
    expect(storedDocuments).toEqual([{ id: first.data.documentId }]);
    expect(loadLiveReportFacts).toHaveBeenCalledOnce();
    expect(renderGhgStatementReportPdf).toHaveBeenCalledOnce();
    expect(putObject).toHaveBeenCalledOnce();
  });

  it("rejects reusing a document for a different report at the report unique constraint", async () => {
    const first = await insertPreparedGhgStatementReport(orgCtx, preparedReportArgs());

    // The writer inserts documents first, so it would hit the document primary
    // key before reaching the report's document_id constraint. Insert here to
    // isolate that constraint, with a fresh report ID, version and preparation key.
    await expect(db.insert(certifierGhgStatementReports).values({
      ...first.report,
      id: crypto.randomUUID(),
      version: NEXT_VERSION,
      preparationIdempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({
      cause: { code: "23505", constraint: DOCUMENT_UNIQUE_CONSTRAINT },
    });
    await expect(listGhgStatementReports(orgCtx, STATEMENT_ID))
      .resolves.toEqual([first.report]);
  });
});
