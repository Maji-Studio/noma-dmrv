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
import type { GhgStatement } from "@/lib/isometric";

// ---------------------------------------------------------------------------
// Module mocks — declared before the system under test imports.
// ---------------------------------------------------------------------------

vi.mock("@/data-access/certification");
vi.mock("@/data-access/certification-submissions");
vi.mock("@/data-access/certifier-ghg-statements");
vi.mock("@/data-access/facilities", () => ({
  getFacilityById: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn().mockResolvedValue({
    id: "user-test-1",
    email: "tester@example.com",
    name: "Tester",
    emailVerified: true,
    role: "admin" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));
// `finalizeGhgStatement` uses `db.transaction(cb)` — fake it by invoking
// the callback with a sentinel tx that our mocked data-access ignores.
vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ __fakeTx: true }),
    ),
  },
}));
vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    createGhgStatement: vi.fn(),
    getGhgStatement: vi.fn(),
    submitGhgStatement: vi.fn(),
    resubmitGhgStatement: vi.fn(),
    reconcileGhgStatement: vi.fn(),
    findDraftGhgStatementsByPeriod: vi.fn(),
  };
});

import * as ledger from "@/data-access/certification";
import * as ledgerClaim from "@/data-access/certification-submissions";
import * as ghgDA from "@/data-access/certifier-ghg-statements";
import { makeClaimSubmissionDraftFake } from "./fixtures/fake-claim";
import * as facilitiesDA from "@/data-access/facilities";
import * as authServer from "@/lib/auth/server";
import * as isometric from "@/lib/isometric";
import { __resetRateLimitForTests } from "@/lib/rate-limit/in-memory";
import {
  createGhgStatementDraft,
  submitGhgStatementToVerifier,
} from "@/fn/certification/ghg-statements";

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
const OUT_OF_WINDOW_COMPLETED_ON = "2026-02-15";
const REPORT_URL = "https://example.com/report.pdf";

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
  vi.mocked(authServer.getUser).mockResolvedValue({
    id: "user-test-1",
    email: "tester@example.com",
    name: "Tester",
    emailVerified: true,
    role: "admin" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);

  // Certifier-project mapping is shared across all paths.
  vi.mocked(ledger.getCertifierProjectByFacility).mockResolvedValue(
    makeMapping(),
  );

  // Statement upsert: returns the seed row; orchestrator treats it as
  // already-present.
  vi.mocked(ghgDA.getOrCreateGhgStatementDraft).mockImplementation(async () => ({
    statement: storedStatements[0],
    created: storedStatements.length === 1,
  }));
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
  vi.mocked(ledger.markSubmissionRejected).mockResolvedValue(undefined as never);
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

  // The empty-statement guard (#245) predicts period membership from the
  // facility's open removals. Default to one completed in-window so creates
  // pass the guard unless a test overrides this to exercise the fail-closed
  // branches.
  vi.mocked(ghgDA.listOpenRemovalsForFacility).mockResolvedValue([
    makeOpenRemoval(),
  ]);

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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createGhgStatementDraft — happy path", () => {
  it("inserts a v=1 draft, POSTs /ghg_statements, reconciles ghg_entry_ids, and marks the ledger submitted", async () => {
    const remote = makeRemoteStatement();
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remote);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remote);

    const result = await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    if (!result.success) throw new Error(`Action failed: ${result.error}`);
    expect(result.data).toMatchObject({
      ghgStatementId: STATEMENT_ID,
      externalId: EXTERNAL_STATEMENT_ID,
      linkedRemovalIds: [REMOVAL_ID],
      warnings: [],
    });

    // The remote POST was invoked with the period-first payload shape
    // Isometric requires (project_id + end_on only).
    expect(isometric.createGhgStatement).toHaveBeenCalledExactlyOnceWith({
      project_id: EXTERNAL_PROJECT_ID,
      end_on: REPORTING_PERIOD_END,
    });

    // Ledger row transitioned draft → submitted carrying the external id.
    expect(storedLedger).toHaveLength(1);
    expect(storedLedger[0]).toMatchObject({
      version: 1,
      status: "submitted",
      externalId: EXTERNAL_STATEMENT_ID,
      localEntityType: "ghgStatement",
      localEntityId: STATEMENT_ID,
    });

    // Removal membership reconciled from the server-side ghg_entry_ids; the
    // server-derived reporting window was persisted onto the local row.
    expect(ghgDA.reconcileRemovalMembership).toHaveBeenCalledWith(
      "user-test-1",
      STATEMENT_ID,
      [EXTERNAL_REMOVAL_ID],
      expect.any(Object),
    );
    expect(ghgDA.updateGhgStatementReportingWindow).toHaveBeenCalledWith(
      "user-test-1",
      STATEMENT_ID,
      { reportingPeriodStartOn: "2026-01-01" },
      expect.any(Object),
    );
  });

  it("re-creating with the same period returns the existing externalId and does not POST again", async () => {
    const remote = makeRemoteStatement();
    vi.mocked(isometric.createGhgStatement).mockResolvedValue(remote);
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remote);

    await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    vi.mocked(isometric.createGhgStatement).mockClear();
    vi.mocked(isometric.getGhgStatement).mockClear();
    vi.mocked(ghgDA.reconcileRemovalMembership).mockClear();
    vi.mocked(ghgDA.updateGhgStatementReportingWindow).mockClear();

    const second = await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.externalId).toBe(EXTERNAL_STATEMENT_ID);
    expect(isometric.createGhgStatement).not.toHaveBeenCalled();
    // Idempotent return-existing must not trigger any remote read or local
    // membership/window reconciliation — only the externalId is replayed.
    expect(isometric.getGhgStatement).not.toHaveBeenCalled();
    expect(ghgDA.reconcileRemovalMembership).not.toHaveBeenCalled();
    expect(ghgDA.updateGhgStatementReportingWindow).not.toHaveBeenCalled();
    // No new ledger row — the existing v=1 row was returned.
    expect(storedLedger).toHaveLength(1);
  });
});

describe("createGhgStatementDraft — empty-statement guard (#245)", () => {
  it("adopts one exact remote draft before POSTing even when a removal is still open locally", async () => {
    const remote = makeRemoteStatement();
    vi.mocked(isometric.findDraftGhgStatementsByPeriod).mockResolvedValue([
      remote,
    ]);
    vi.mocked(isometric.reconcileGhgStatement).mockResolvedValue({
      found: "single",
      externalId: EXTERNAL_STATEMENT_ID,
      status: "DRAFT",
    });
    vi.mocked(isometric.getGhgStatement).mockResolvedValue(remote);

    const result = await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(result).toMatchObject({
      success: true,
      data: { externalId: EXTERNAL_STATEMENT_ID },
    });
    expect(isometric.createGhgStatement).not.toHaveBeenCalled();
  });

  it("fail-closes before any local row or remote POST when no removals are open", async () => {
    vi.mocked(ghgDA.listOpenRemovalsForFacility).mockResolvedValue([]);

    const result = await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no submitted removals/i);
    // Refused before minting anything: no local statement upsert, no ledger
    // draft, no registry POST.
    expect(ghgDA.getOrCreateGhgStatementDraft).not.toHaveBeenCalled();
    expect(isometric.createGhgStatement).not.toHaveBeenCalled();
    expect(storedLedger).toHaveLength(0);
  });

  it("fail-closes when the only open removal completed outside the window", async () => {
    vi.mocked(ghgDA.listOpenRemovalsForFacility).mockResolvedValue([
      makeOpenRemoval({ completedOn: OUT_OF_WINDOW_COMPLETED_ON }),
    ]);

    const result = await createGhgStatementDraft({
      facilityId: FACILITY_ID,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no submitted removals/i);
    expect(isometric.createGhgStatement).not.toHaveBeenCalled();
    expect(storedLedger).toHaveLength(0);
  });
});

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
  it("POSTs /ghg_statements/{id}/submit, flips remote status, attaches a report document, and updates ledger metadata", async () => {
    // Arrange the ledger to look like createGhgStatementDraft already ran.
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

    // For the submit-to-verifier flow, getGhgStatement is called for the
    // pre-state read, and submitGhgStatement returns the post-state.
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

    // Submit body carries the operator-supplied report URL.
    expect(isometric.submitGhgStatement).toHaveBeenCalledExactlyOnceWith(
      EXTERNAL_STATEMENT_ID,
      { ghg_statement_report_url: REPORT_URL },
    );

    // The report document was attached against the ledger row.
    expect(ledger.attachReportDocument).toHaveBeenCalledWith(
      "user-test-1",
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
});
