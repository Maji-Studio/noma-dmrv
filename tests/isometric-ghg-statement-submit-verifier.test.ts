/**
 * Happy-path orchestrator test for the Phase 4.5 GHG-Statement flow.
 *
 * Exercises `createGhgStatementDraft` → `submitGhgStatementToVerifier`
 * end-to-end with the data-access + Isometric HTTP boundaries faked. The
 * unit pieces (state machine, reconciliation, membership decisions) have
 * their own tests — this one proves the orchestrator wires them together
 * across the create → reconcile-removals → submit-to-verifier path.
 *
 * Coverage:
 *   1. First create  → ledger draft → POST /ghg_statements →
 *                       reconcileRemovalMembership stamps the local removal
 *                       → ledger 'submitted' with externalId.
 *   2. Re-create with same period → `return-existing`, no new POST.
 *   3. Submit-to-verifier on the created statement → POST /submit →
 *                       remote status flips to AWAITING_VERIFICATION,
 *                       report document attached.
 *   4. Empty-statement guard (#245): create fail-closes before any local row
 *                       or remote POST when the window holds no submitted
 *                       removal (none open, or the only one out-of-window).
 *   5. Zero-linked backstop (#245): submit fail-closes when the registry's
 *                       authoritative membership is empty.
 *
 * Out of scope (left to dedicated tests): resubmit-after-failure,
 * stale-lock recovery, double-create dedup details, and the verified
 * terminal-state transition.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";

import type {
  CertificationSubmissionRow,
  CertifierProjectRow,
  DocumentRow,
} from "@/data-access/certification";
import type { InsertDraftSubmissionInput } from "@/data-access/certification-submissions";
import type {
  CertifierGhgStatementRow,
  OpenRemoval,
  ReconcileResult,
} from "@/data-access/certifier-ghg-statements";
import type { CertifierRemovalRow } from "@/data-access/certifier-removals";
import type { GhgStatementReportRow } from "@/data-access/ghg-statement-reports";
import type { GhgStatement } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { hashVerifierToken } from "@/lib/certification/ghg-statement-report/verifier-url";

// ---------------------------------------------------------------------------
// Module mocks — declared before the system under test imports.
// ---------------------------------------------------------------------------

vi.mock("@/data-access/certification");
vi.mock("@/data-access/certification-submissions");
vi.mock("@/data-access/certifier-ghg-statements");
vi.mock("@/data-access/ghg-statement-reports");
vi.mock("@/fn/certification/ghg-statement-reports", () => ({
  assertGhgStatementReportFresh: vi.fn(),
  // Mints a fresh capability token and returns the link carrying it.
  issueVerifierReportUrl: vi.fn(
    async () =>
      "http://localhost:3100/api/ghg-statement-reports/55555555-5555-4555-8555-555555555555?token=opaque",
  ),
}));
vi.mock("@/data-access/facilities", () => ({
  getFacilityById: vi.fn(),
}));
// The facility↔org read guard (DEF-001) does a real db.select; the db mock
// below only fakes transaction(), so stub the guard like other data-access.
vi.mock("@/data-access/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data-access/utils")>();
  return {
    ...actual,
    requireOrgFacility: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/lib/auth/server", () => ({
  requireOrgRole: vi.fn(),
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "user-test-1",
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  }),
}));
// The remote-state data-access helper uses `db.transaction(cb)` — fake it by
// invoking the callback with a sentinel tx that our mocked data-access ignores.
vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ __fakeTx: true, execute: vi.fn() }),
    ),
  },
  withDedicatedLockConnection: vi.fn(
    async (cb: (tx: unknown) => unknown) =>
      cb({ __fakeTx: true, execute: vi.fn() }),
  ),
  withDedicatedSessionAdvisoryLock: vi.fn(
    async (_lockKey: string, cb: () => unknown) => cb(),
  ),
}));
vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => ({} as import("@/lib/isometric").IsometricClient)),
    createGhgStatement: vi.fn(),
    getGhgStatement: vi.fn(),
    submitGhgStatement: vi.fn(),
    resubmitGhgStatement: vi.fn(),
    listGhgStatementsForProject: vi.fn(),
    reconcileGhgStatement: vi.fn(),
    findDraftGhgStatementsByPeriod: vi.fn(),
  };
});

import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as ghgDA from "@/data-access/certifier-ghg-statements";
import * as reportDA from "@/data-access/ghg-statement-reports";
import * as reportActions from "@/fn/certification/ghg-statement-reports";
import { makeClaimSubmissionDraftFake } from "./fixtures/fake-claim";
import * as facilitiesDA from "@/data-access/facilities";
import * as authServer from "@/lib/auth/server";
import * as isometric from "@/lib/isometric";
import * as database from "@/db";
import { __resetRateLimitForTests } from "@/lib/rate-limit/in-memory";
import {
  createGhgStatementDraft,
  submitGhgStatementToVerifier,
} from "@/fn/certification/ghg-statements";
import { submitGhgStatementToVerifierCore } from "@/fn/certification/submit-ghg-statement";

// ---------------------------------------------------------------------------
// Test constants.
// ---------------------------------------------------------------------------

// Zod 4's .uuid() enforces version + variant bits, so the synthetic ids
// here are valid v4 UUIDs (version=4, variant=8) rather than all-ones.
const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const STATEMENT_ID = "22222222-2222-4222-8222-222222222222";
const REMOVAL_ID = "33333333-3333-4333-8333-333333333333";
const EXTERNAL_PROJECT_ID = "prj_test_1";
const EXTERNAL_STATEMENT_ID = "ggs_test_1";
const EXTERNAL_REMOVAL_ID = "rmv_test_1";
const REPORTING_PERIOD_END = "2026-01-31";
// Inside the reporting window (no prior statement → unbounded start, so any
// completion on or before REPORTING_PERIOD_END is in-window).
const IN_WINDOW_COMPLETED_ON = "2026-01-15";
const REPORT_URL = "https://example.com/report.pdf";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const REPORT_DOCUMENT_ID = "66666666-6666-4666-8666-666666666666";
const GENERATED_REPORT_URL =
  `http://localhost:3100/api/ghg-statement-reports/${REPORT_ID}?token=opaque`;

// ---------------------------------------------------------------------------
// In-memory stores. We model just the slice each orchestrator path reads
// (latest-ledger lookup, statement upsert, removal reconciliation result).
// ---------------------------------------------------------------------------

let storedLedger: CertificationSubmissionRow[];
let nextLedgerRowId: number;
let storedStatements: CertifierGhgStatementRow[];

function makeStatementRow(): CertifierGhgStatementRow {
  return {
    id: STATEMENT_ID,
    provider: "isometric",
    facilityId: FACILITY_ID,
    reportingPeriodEndOn: REPORTING_PERIOD_END,
    reportingPeriodStartOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertifierGhgStatementRow;
}

function makeOpenRemoval(
  overrides: Partial<CertifierRemovalRow> = {},
): OpenRemoval {
  return {
    removal: {
      id: REMOVAL_ID,
      facilityId: FACILITY_ID,
      provider: "isometric",
      startedOn: null,
      completedOn: IN_WINDOW_COMPLETED_ON,
      ghgStatementId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as CertifierRemovalRow,
    externalId: EXTERNAL_REMOVAL_ID,
  };
}

function makeMapping(): CertifierProjectRow {
  return {
    id: "cert-proj-1",
    facilityId: FACILITY_ID,
    provider: "isometric",
    externalProjectId: EXTERNAL_PROJECT_ID,
    protocolSlug: "biochar",
    protocolVersion: "1.2",
    defaultRemovalTemplateId: "rvt_1",
    webhookSecret: null,
    metadata: null,
    gensetEnergyYieldKwhPerLitre: 3.375,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertifierProjectRow;
}

function makeRemoteStatement(
  overrides: Partial<GhgStatement> = {},
): GhgStatement {
  return {
    id: EXTERNAL_STATEMENT_ID,
    project_id: EXTERNAL_PROJECT_ID,
    verifier: null,
    ghg_entry_ids: [EXTERNAL_REMOVAL_ID],
    removal_ids: [EXTERNAL_REMOVAL_ID],
    credit_allocation: null,
    ghg_statement_report_url: null,
    status: "DRAFT",
    reporting_period_start_at: "2026-01-01",
    reporting_period_end_at: REPORTING_PERIOD_END,
    submitted_at: null,
    credits_issued_at: null,
    pending_total_co2e_removed_kg: null,
    ...overrides,
  } as GhgStatement;
}

function storedLatestForStatement(): CertificationSubmissionRow | null {
  const matching = storedLedger.filter(
    (row) =>
      row.provider === "isometric" &&
      row.submissionType === "ghg_statement" &&
      row.localEntityType === "ghgStatement" &&
      row.localEntityId === STATEMENT_ID,
  );
  if (matching.length === 0) return null;
  return matching.sort((a, b) => b.version - a.version)[0];
}

function newLedgerRow(
  input: InsertDraftSubmissionInput,
): CertificationSubmissionRow {
  return {
    id: `sub-${nextLedgerRowId++}`,
    provider: input.provider,
    submissionType: input.submissionType,
    localEntityType: input.localEntityType,
    localEntityId: input.localEntityId,
    version: input.version,
    status: "draft",
    externalId: null,
    payloadSnapshot: input.payloadSnapshot as Record<string, unknown>,
    payloadHash: input.payloadHash,
    metadata: (input.metadata ?? null) as Record<string, unknown> | null,
    submittedAt: null,
    lockedAt: new Date(),
    supersededAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertificationSubmissionRow;
}

// ---------------------------------------------------------------------------
// Wire fakes onto mocked modules.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  // The submit actions share a per-user in-memory rate limiter (5/min); all
  // tests here run as the same synthetic user, so clear it between tests.
  __resetRateLimitForTests();
  storedLedger = [];
  storedStatements = [makeStatementRow()];
  nextLedgerRowId = 1;

  // vi.resetAllMocks() clears the .mockResolvedValue from the factory; re-set
  // a default admin user here so every withAction-wrapped path is authed.
  vi.mocked(authServer.requireOrgContext).mockResolvedValue({
    userId: "user-test-1",
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  });

  // Certifier-project mapping is shared across all paths.
  vi.mocked(ledger.getCertifierProjectByFacility).mockResolvedValue(
    makeMapping(),
  );
  vi.mocked(ledger.getSubmissionByExternalId).mockResolvedValue(null);
  vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue(null);
  vi.mocked(reportDA.promotePendingVerifierReportToken).mockResolvedValue(true);
  vi.mocked(reportDA.clearPendingVerifierReportToken).mockResolvedValue(true);
  vi.mocked(database.withDedicatedSessionAdvisoryLock).mockImplementation(
    async (_lockKey, callback) => callback(),
  );
  vi.mocked(
    reportActions.assertGhgStatementReportFresh,
  ).mockResolvedValue(undefined);

  // Statement upsert: returns the seed row; orchestrator treats it as
  // already-present.
  vi.mocked(ghgDA.getOrCreateGhgStatementDraft).mockImplementation(async () => ({
    statement: storedStatements[0],
    created: storedStatements.length === 1,
  }));
  vi.mocked(
    ghgDA.createGhgStatementForRegistryDiscovery,
  ).mockImplementation(async () => storedStatements[0]);
  vi.mocked(ghgDA.getCertifierGhgStatementById).mockImplementation(async () =>
    storedStatements[0] ?? null,
  );

  // Ledger ops — same in-memory simulation as the Removal test. The claim
  // choreography is one mocked function backed by the in-memory ledger +
  // the real pure decision core; lock/CAS/re-resolution behavior is the
  // module's own concern (DB-backed tests).
  vi.mocked(ledgerClaim.getLatestSubmission).mockImplementation(async () =>
    storedLatestForStatement(),
  );
  vi.mocked(ledgerClaim.getLatestSubmissionWithExecutor).mockImplementation(
    async () => storedLatestForStatement(),
  );
  vi.mocked(ledgerClaim.claimSubmissionDraft).mockImplementation(
    makeClaimSubmissionDraftFake({
      latest: () => storedLatestForStatement(),
      insert: (input) => {
        const row = newLedgerRow(input);
        storedLedger.push(row);
        return row;
      },
      resetToDraft: (rowId) => {
        const row = storedLedger.find((r) => r.id === rowId);
        if (!row) throw new Error(`Test ledger missing row ${rowId}`);
        row.status = "draft";
        row.lockedAt = new Date();
        return row;
      },
    }),
  );
  vi.mocked(ledger.markSubmissionSubmitted).mockImplementation(
    async (_userId, id, args) => {
      const row = storedLedger.find((r) => r.id === id);
      if (row) {
        row.status = "submitted";
        row.externalId = args.externalId;
        row.submittedAt = new Date();
        row.lockedAt = null;
      }
    },
  );
  vi.mocked(ledger.markSubmissionRejected).mockImplementation(
    async (_userId, id, args) => {
      const row = storedLedger.find((candidate) => candidate.id === id);
      if (row) {
        row.status = "rejected";
        row.lockedAt = null;
        row.metadata = {
          ...(row.metadata ?? {}),
          lastError: args.errorMessage,
        } as Record<string, unknown>;
      }
    },
  );
  vi.mocked(ledger.updateSubmissionMetadata).mockImplementation(
    async (_userId, id, patch) => {
      const row = storedLedger.find((r) => r.id === id);
      if (row) {
        row.metadata = {
          ...(row.metadata ?? {}),
          ...patch,
        } as Record<string, unknown>;
      }
    },
  );
  vi.mocked(ledger.setSubmissionTerminalStatus).mockImplementation(
    async (_userId, id, args) => {
      const row = storedLedger.find((r) => r.id === id);
      if (row) {
        row.status = args.status;
        row.metadata = {
          ...(row.metadata ?? {}),
          ...(args.metadataPatch ?? {}),
        } as Record<string, unknown>;
      }
    },
  );
  vi.mocked(ledger.clearTerminalStatusForResubmit).mockImplementation(
    async (_userId, id, args) => {
      const row = storedLedger.find((r) => r.id === id);
      if (row) {
        row.status = "submitted";
        row.metadata = {
          ...(row.metadata ?? {}),
          ...(args?.metadataPatch ?? {}),
        } as Record<string, unknown>;
      }
    },
  );
  vi.mocked(ledger.appendSyncEvent).mockResolvedValue(undefined as never);
  vi.mocked(ledger.attachReportDocument).mockImplementation(
    async (_userId, args) =>
      ({
        id: "doc-1",
        entityType: "ghgStatement",
        entityId: args.submissionId,
        fileUrl: args.reportUrl,
        documentType: "pdf",
      }) as unknown as DocumentRow,
  );

  // The non-overlap guard reads the facility's existing statements before
  // get-or-create; no siblings here, so nothing to overlap.
  vi.mocked(ghgDA.listGhgStatementsForFacility).mockResolvedValue([]);
  vi.mocked(ghgDA.listFacilityIdsForExternalProject).mockResolvedValue([
    FACILITY_ID,
  ]);

  // The empty-statement guard (#245) predicts period membership from the
  // facility's open removals. Default to one completed in-window so creates
  // pass the guard unless a test overrides this to exercise the fail-closed
  // branches.
  vi.mocked(ghgDA.listOpenRemovalsForFacility).mockResolvedValue([
    makeOpenRemoval(),
  ]);

  // The idempotent `return-existing` arm reports the statement's REAL
  // membership rather than claiming zero linked removals (ADR 0023 follow-up).
  vi.mocked(ghgDA.getRemovalsByGhgStatementId).mockResolvedValue([]);

  // GHG-statement DA ops touched after the remote create.
  vi.mocked(ghgDA.reconcileRemovalMembership).mockResolvedValue({
    linkedRemovalIds: [REMOVAL_ID],
    warnings: [],
  } satisfies ReconcileResult);
  vi.mocked(ghgDA.updateGhgStatementReportingWindow).mockResolvedValue(
    undefined as never,
  );

  vi.mocked(facilitiesDA.getFacilityById).mockResolvedValue({
    id: FACILITY_ID,
    code: "F-TEST",
    name: "Test Facility",
  } as never);

  // Default Isometric HTTP — the per-test overrides extend these.
  vi.mocked(isometric.reconcileGhgStatement).mockResolvedValue({ found: false });
  vi.mocked(isometric.findDraftGhgStatementsByPeriod).mockResolvedValue([]);
  vi.mocked(isometric.listGhgStatementsForProject).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitGhgStatementToVerifier — zero-linked backstop (#245)", () => {
  it("refuses to submit a statement whose registry membership is empty", async () => {
    // Create succeeds, but the registry links nothing into the statement —
    // the authoritative `ghg_entry_ids` stays empty.
    const remoteEmpty = makeRemoteStatement({
      ghg_entry_ids: [],
      removal_ids: [],
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteEmpty);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteEmpty);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportUrl: REPORT_URL,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no linked removals/i);
    // The backstop trips before the report attach and the verifier POST.
    expect(ledger.attachReportDocument).not.toHaveBeenCalled();
    expect(isometric.submitGhgStatement).not.toHaveBeenCalled();
  });
});

describe("submitGhgStatementToVerifier — happy path", () => {
  it("reports every verifier submission step in order", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    const remoteAfter = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: REPORT_URL,
      submitted_at: "2026-02-01T10:00:00Z",
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.submitGhgStatement).mockResolvedValue(remoteAfter);
    const progress = vi.fn();

    await submitGhgStatementToVerifierCore({
      orgCtx: makeTestOrgContext("user-test-1"),
      ghgStatementId: STATEMENT_ID,
      input: { reportUrl: REPORT_URL },
      onProgress: progress,
    });

    expect(progress.mock.calls.map(([update]) => update)).toEqual([
      { step: "ghg_statement.checking", state: "active" },
      { step: "ghg_statement.checking", state: "complete" },
      { step: "ghg_statement.preparing_report", state: "active" },
      { step: "ghg_statement.preparing_report", state: "complete" },
      { step: "ghg_statement.sending", state: "active" },
      { step: "ghg_statement.sending", state: "complete" },
      { step: "ghg_statement.confirming", state: "active" },
      { step: "ghg_statement.confirming", state: "complete" },
      { step: "ghg_statement.complete", state: "complete" },
    ]);
  });

  it("POSTs /ghg_statements/{id}/submit, flips remote status, attaches a report document, and updates ledger metadata", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    const remoteAfter = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: REPORT_URL,
      submitted_at: "2026-02-01T10:00:00Z",
    });

    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.submitGhgStatement).mockResolvedValue(remoteAfter);

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportUrl: REPORT_URL,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      externalId: EXTERNAL_STATEMENT_ID,
      remoteStatus: "AWAITING_VERIFICATION",
    });

    expect(isometric.submitGhgStatement).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      EXTERNAL_STATEMENT_ID,
      { ghg_statement_report_url: REPORT_URL },
    );

    // The report document was attached against the ledger row.
    expect(ledger.attachReportDocument).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      expect.objectContaining({
        submissionId: storedLedger[0].id,
        reportUrl: REPORT_URL,
      }),
    );

    // Ledger metadata absorbed the post-submit remote state (status +
    // submitted-at), so a subsequent state refresh sees the new shape.
    const row = storedLedger[0];
    expect(row.metadata).toMatchObject({
      remoteStatus: "AWAITING_VERIFICATION",
      submittedToVerifierAt: expect.any(String),
      reportUrl: REPORT_URL,
    });
  });

  it("submits the approved immutable report through its stable verifier URL", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    const remoteAfter = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: GENERATED_REPORT_URL,
      submitted_at: "2026-02-01T10:00:00Z",
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "approved",
      sourceFingerprint: "a".repeat(64),
    } as GhgStatementReportRow);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.submitGhgStatement).mockResolvedValue(remoteAfter);

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });

    expect(result).toMatchObject({
      success: true,
      data: { remoteStatus: "AWAITING_VERIFICATION" },
    });
    expect(
      reportActions.assertGhgStatementReportFresh,
    ).toHaveBeenCalledOnce();
    expect(isometric.submitGhgStatement).toHaveBeenCalledWith(
      expect.any(Object),
      EXTERNAL_STATEMENT_ID,
      { ghg_statement_report_url: GENERATED_REPORT_URL },
    );
    expect(authServer.requireOrgRole).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      "admin",
    );
    expect(ledger.attachReportDocument).not.toHaveBeenCalled();
    // The submitted link carries a freshly minted capability token rather than
    // a value derivable from the report id and a global secret.
    expect(reportActions.issueVerifierReportUrl).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      REPORT_ID,
    );
    expect(reportDA.promotePendingVerifierReportToken).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      { reportId: REPORT_ID, token: "opaque" },
    );
  });

  it("preserves the active and pending URLs when a resubmit outcome is ambiguous", async () => {
    const remoteDraft = makeRemoteStatement({ status: "DRAFT" });
    const activeReportUrl =
      `http://localhost:3100/api/ghg-statement-reports/${REPORT_ID}?token=active`;
    const remoteBefore = makeRemoteStatement({
      status: "FAILED_VERIFICATION",
      ghg_statement_report_url: activeReportUrl,
      pending_total_co2e_removed_kg: 1,
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteDraft);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteDraft);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "submitted",
      sourceFingerprint: "a".repeat(64),
      verifierTokenHash: hashVerifierToken("active"),
      pendingVerifierTokenHash: null,
    } as GhgStatementReportRow);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.resubmitGhgStatement).mockRejectedValue(
      new Error("network unavailable"),
    );

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
      summaryOfChanges: "Corrected report evidence.",
    });

    expect(result).toMatchObject({ success: false });
    expect(remoteBefore.ghg_statement_report_url).toBe(activeReportUrl);
    expect(ledger.attachReportDocument).not.toHaveBeenCalled();
    expect(reportDA.promotePendingVerifierReportToken).not.toHaveBeenCalled();
    expect(reportDA.clearPendingVerifierReportToken).not.toHaveBeenCalled();
  });

  it("rejects a stale approved report before provider submission", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "approved",
      sourceFingerprint: "a".repeat(64),
    } as GhgStatementReportRow);
    vi.mocked(
      reportActions.assertGhgStatementReportFresh,
    ).mockRejectedValue(
      new SafeError(
        "The approved report is stale. Prepare and approve a new report.",
      ),
    );

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });

    expect(result).toEqual({
      success: false,
      error:
        "The approved report is stale. Prepare and approve a new report.",
    });
    expect(isometric.submitGhgStatement).not.toHaveBeenCalled();
    expect(ledger.attachReportDocument).not.toHaveBeenCalled();
  });

  it("marks the selected report submitted when reconciliation proves provider success", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    const remoteAfter = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: GENERATED_REPORT_URL,
      submitted_at: "2026-02-01T10:00:00Z",
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "approved",
      sourceFingerprint: "a".repeat(64),
    } as GhgStatementReportRow);
    vi.mocked(isometric.getGhgStatement)
      .mockResolvedValueOnce(remoteBefore)
      .mockResolvedValueOnce(remoteAfter);
    vi.mocked(isometric.submitGhgStatement).mockRejectedValue(
      new Error("response lost"),
    );

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });

    expect(result).toMatchObject({
      success: true,
      data: { remoteStatus: "AWAITING_VERIFICATION" },
    });
    expect(reportDA.promotePendingVerifierReportToken).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      { reportId: REPORT_ID, token: "opaque" },
    );
  });

  it("promotes a resubmit token when reconciliation sees the new URL after rapid verification failure", async () => {
    const remoteDraft = makeRemoteStatement({ status: "DRAFT" });
    const remoteBefore = makeRemoteStatement({
      status: "FAILED_VERIFICATION",
      ghg_statement_report_url: "https://example.com/previous-report.pdf",
      pending_total_co2e_removed_kg: 1,
    });
    const remoteAfter = makeRemoteStatement({
      status: "FAILED_VERIFICATION",
      ghg_statement_report_url: GENERATED_REPORT_URL,
      pending_total_co2e_removed_kg: 1,
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteDraft);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteDraft);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "submitted",
      sourceFingerprint: "a".repeat(64),
      pendingVerifierTokenHash: null,
    } as GhgStatementReportRow);
    vi.mocked(isometric.getGhgStatement)
      .mockResolvedValueOnce(remoteBefore)
      .mockResolvedValueOnce(remoteAfter);
    vi.mocked(isometric.resubmitGhgStatement).mockRejectedValue(
      new Error("response lost"),
    );

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
      summaryOfChanges: "Corrected report evidence.",
    });

    expect(result).toMatchObject({
      success: true,
      data: { remoteStatus: "FAILED_VERIFICATION" },
    });
    expect(reportDA.promotePendingVerifierReportToken).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      { reportId: REPORT_ID, token: "opaque" },
    );
    expect(reportDA.clearPendingVerifierReportToken).not.toHaveBeenCalled();
  });

  it("preserves a pending capability when reconciliation returns unrelated stale state", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    const unrelatedAfter = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url:
        "https://app.example.com/api/ghg-statement-reports/another?token=other",
      submitted_at: "2026-02-01T10:00:00Z",
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "approved",
      sourceFingerprint: "a".repeat(64),
    } as GhgStatementReportRow);
    vi.mocked(isometric.getGhgStatement)
      .mockResolvedValueOnce(remoteBefore)
      .mockResolvedValueOnce(unrelatedAfter);
    vi.mocked(isometric.submitGhgStatement).mockRejectedValue(
      new Error("response lost"),
    );

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });

    expect(result).toMatchObject({ success: false });
    expect(reportDA.promotePendingVerifierReportToken).not.toHaveBeenCalled();
    expect(reportDA.clearPendingVerifierReportToken).not.toHaveBeenCalled();
  });

  it("clears a pending capability after an explicit definitive provider rejection", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "approved",
      sourceFingerprint: "a".repeat(64),
    } as GhgStatementReportRow);
    vi.mocked(isometric.submitGhgStatement).mockRejectedValue(
      new isometric.IsometricApiError(
        "invalid report URL",
        422,
        { detail: "invalid report URL" },
        "http",
      ),
    );

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });

    expect(result).toMatchObject({ success: false });
    expect(reportDA.clearPendingVerifierReportToken).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      {
        reportId: REPORT_ID,
        expectedTokenHash: hashVerifierToken("opaque"),
      },
    );
  });

  it("finalizes an already-applied matching external report without resubmitting", async () => {
    const remoteDraft = makeRemoteStatement({ status: "DRAFT" });
    const remoteApplied = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: REPORT_URL,
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteDraft);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteDraft);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteApplied);

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportUrl: REPORT_URL,
    });

    expect(result).toMatchObject({
      success: true,
      data: { remoteStatus: "AWAITING_VERIFICATION" },
    });
    expect(isometric.submitGhgStatement).not.toHaveBeenCalled();
    expect(storedLedger[0].metadata).toMatchObject({
      remoteStatus: "AWAITING_VERIFICATION",
      reportUrl: REPORT_URL,
    });
  });

  it("finalizes an already-promoted generated report without replacing its summary", async () => {
    const remoteDraft = makeRemoteStatement({ status: "DRAFT" });
    const activeGeneratedReportUrl =
      `http://localhost:3100/api/ghg-statement-reports/${REPORT_ID}?token=active`;
    const remoteApplied = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: activeGeneratedReportUrl,
      submitted_at: "2026-02-01T10:00:00Z",
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteDraft);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteDraft);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    storedLedger[0].metadata = { summaryOfChanges: "Existing summary" };
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "submitted",
      sourceFingerprint: "a".repeat(64),
      verifierTokenHash: hashVerifierToken("active"),
      pendingVerifierTokenHash: null,
    } as GhgStatementReportRow);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteApplied);

    const result = await submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });

    expect(result).toMatchObject({
      success: true,
      data: { remoteStatus: "AWAITING_VERIFICATION" },
    });
    expect(isometric.submitGhgStatement).not.toHaveBeenCalled();
    expect(storedLedger[0].metadata).toMatchObject({
      summaryOfChanges: "Existing summary",
      remoteStatus: "AWAITING_VERIFICATION",
      lastReportDocumentId: REPORT_DOCUMENT_ID,
    });
    expect(ledger.appendSyncEvent).toHaveBeenCalledWith(
      makeTestOrgContext("user-test-1"),
      expect.objectContaining({
        operation: "ghg_statement:blocked-awaiting:reconciled",
        status: "succeeded",
      }),
    );
  });

  it("serializes concurrent generated-report submits before minting a token", async () => {
    const remoteBefore = makeRemoteStatement({ status: "DRAFT" });
    const remoteAfter = makeRemoteStatement({
      status: "AWAITING_VERIFICATION",
      ghg_statement_report_url: GENERATED_REPORT_URL,
      submitted_at: "2026-02-01T10:00:00Z",
    });
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remoteBefore);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remoteBefore);
    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    vi.mocked(reportDA.getApprovedGhgStatementReport).mockResolvedValue({
      id: REPORT_ID,
      ghgStatementId: STATEMENT_ID,
      documentId: REPORT_DOCUMENT_ID,
      version: 1,
      lifecycle: "approved",
      sourceFingerprint: "a".repeat(64),
      pendingVerifierTokenHash: null,
    } as GhgStatementReportRow);

    let lockTail = Promise.resolve();
    vi.mocked(database.withDedicatedSessionAdvisoryLock).mockImplementation(
      async (_lockKey, callback) => {
        const previous = lockTail;
        let releaseLock = () => {};
        lockTail = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await previous;
        try {
          return await callback();
        } finally {
          releaseLock();
        }
      },
    );

    let releaseProvider = () => {};
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let currentRemote = remoteBefore;
    vi.mocked(isometric.getGhgStatement).mockImplementation(
      async () => currentRemote,
    );
    vi.mocked(isometric.submitGhgStatement).mockImplementation(async () => {
      await providerReleased;
      currentRemote = remoteAfter;
      return remoteAfter;
    });

    const first = submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });
    await vi.waitFor(() => {
      expect(isometric.submitGhgStatement).toHaveBeenCalledOnce();
    });
    const second = submitGhgStatementToVerifier(STATEMENT_ID, {
      reportId: REPORT_ID,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reportActions.issueVerifierReportUrl).toHaveBeenCalledOnce();
    releaseProvider();
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toEqual({
      success: false,
      error: "This GHG Statement is already awaiting verification.",
    });
    expect(reportActions.issueVerifierReportUrl).toHaveBeenCalledOnce();
  });
});
