import { beforeEach, describe, expect, it, vi } from "vitest";

const client = {
  get: vi.fn(),
  post: vi.fn(),
};

vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => client),
    payloadHash: vi.fn(() => "semantic-hash"),
  };
});
vi.mock("@/data-access/certification", () => ({
  appendSubmissionJournal: vi.fn(),
  markSubmissionRejected: vi.fn(),
  markSubmissionSubmitted: vi.fn(),
  setSubmissionTerminalStatus: vi.fn(),
  updateSubmissionMetadata: vi.fn(),
}));
vi.mock("@/data-access/certification-submissions", () => ({
  getLatestSubmission: vi.fn(),
  insertDraftSubmissionWithMappingLock: vi.fn(),
  recordTerminalStatusIfCurrent: vi.fn(),
  resetSubmissionToDraftWithMappingLock: vi.fn(),
}));
vi.mock("@/data-access/certifier-sensors", () => ({
  ensureSensorForReactor: vi.fn(),
  listSensorsForReactors: vi.fn(),
}));
vi.mock("@/data-access/telemetry-readings", () => ({
  listTelemetryReadingsForRuns: vi.fn(),
}));
vi.mock("@/fn/certification/certify-context-core", () => ({
  loadRemovalSubmissionContext: vi.fn(),
}));
vi.mock("@/lib/isometric/parquet/writer", () => ({
  DATA_UPLOAD_PARQUET_CONTENT_TYPE: "application/vnd.apache.parquet",
  writeDataUploadParquet: vi.fn(() => new Uint8Array([1, 2, 3])),
}));
vi.mock("@/lib/isometric/utils/signed-upload", () => ({
  assertUploadHostAllowed: vi.fn(),
  fetchSignedUploadWithTimeout: vi.fn(),
}));
vi.mock("@/fn/certification/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fn/certification/shared")>();
  return {
    ...actual,
    appendSyncEventBestEffort: vi.fn(),
    assertProductionConfirmed: vi.fn(),
  };
});

import * as ledger from "@/data-access/certification";
import * as claims from "@/data-access/certification-submissions";
import * as sensors from "@/data-access/certifier-sensors";
import * as telemetry from "@/data-access/telemetry-readings";
import { submitTelemetry } from "@/fn/certification/submit-telemetry";
import { loadRemovalSubmissionContext } from "@/fn/certification/certify-context-core";
import { fetchSignedUploadWithTimeout } from "@/lib/isometric/utils/signed-upload";
import { IsometricApiError } from "@/lib/isometric";
import type { OrgContext } from "@/lib/auth/server";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";

const ORG_CTX: OrgContext = {
  userId: "telemetry-test-user",
  organizationId: "telemetry-test-org",
  orgRole: "admin",
  isPlatformAdmin: false,
};
const REMOVAL_ID = "10000000-0000-4000-8000-000000000001";
const ROW_ID = "20000000-0000-4000-8000-000000000002";

function submissionRow(
  overrides: Partial<CertificationSubmissionRow> = {},
): CertificationSubmissionRow {
  return {
    id: ROW_ID,
    organizationId: ORG_CTX.organizationId,
    provider: "isometric",
    submissionType: "dataUpload",
    localEntityType: "removal",
    localEntityId: REMOVAL_ID,
    externalId: null,
    version: 1,
    status: "draft",
    payloadSnapshot: null,
    payloadHash: null,
    submittedAt: null,
    lockedAt: new Date(),
    supersededAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function installMutableLedger(
  initial: CertificationSubmissionRow | null = null,
) {
  let current = initial;
  vi.mocked(claims.getLatestSubmission).mockImplementation(async () => current);
  vi.mocked(
    claims.insertDraftSubmissionWithMappingLock,
  ).mockImplementation(async (_ctx, input) => {
    current = submissionRow({
      id: `${ROW_ID}-v${input.version}`,
      version: input.version,
      payloadHash: input.payloadHash,
      payloadSnapshot: input.payloadSnapshot as Record<string, unknown>,
      lockedAt: new Date(),
    });
    return current;
  });
  vi.mocked(
    claims.resetSubmissionToDraftWithMappingLock,
  ).mockImplementation(async () => {
    if (!current) throw new Error("Test ledger row is missing");
    current = {
      ...current,
      status: "draft",
      lockedAt: new Date(),
    };
    return current;
  });
  vi.mocked(ledger.appendSubmissionJournal).mockImplementation(
    async (_ctx, _rowId, patch) => {
      if (!current) throw new Error("Test ledger row is missing");
      const snapshot = (current.payloadSnapshot ?? {}) as Record<
        string,
        unknown
      >;
      current.payloadSnapshot = {
        ...snapshot,
        journaled: {
          ...((snapshot.journaled ?? {}) as Record<string, unknown>),
          ...patch,
        },
      };
    },
  );
  vi.mocked(ledger.markSubmissionRejected).mockImplementation(
    async (_ctx, _rowId, args) => {
      if (!current) throw new Error("Test ledger row is missing");
      if (
        current.status !== "draft" ||
        !current.lockedAt ||
        !args.expectedLockedAt ||
        current.lockedAt.getTime() !== args.expectedLockedAt.getTime()
      ) {
        return;
      }
      current.status = "rejected";
      current.lockedAt = null;
      current.metadata = {
        ...((current.metadata ?? {}) as Record<string, unknown>),
        lastError: args.errorMessage,
      };
    },
  );
  vi.mocked(ledger.markSubmissionSubmitted).mockImplementation(
    async (_ctx, _rowId, args) => {
      if (!current) throw new Error("Test ledger row is missing");
      current.status = "submitted";
      current.externalId = args.externalId;
      current.lockedAt = null;
    },
  );
  vi.mocked(ledger.updateSubmissionMetadata).mockImplementation(
    async (_ctx, _rowId, patch) => {
      if (!current) throw new Error("Test ledger row is missing");
      current.metadata = {
        ...((current.metadata ?? {}) as Record<string, unknown>),
        ...patch,
      };
    },
  );
  vi.mocked(ledger.setSubmissionTerminalStatus).mockImplementation(
    async (_ctx, _rowId, args) => {
      if (!current) throw new Error("Test ledger row is missing");
      current.status = args.status;
      current.metadata = {
        ...((current.metadata ?? {}) as Record<string, unknown>),
        ...(args.metadataPatch ?? {}),
      };
    },
  );
  vi.mocked(claims.recordTerminalStatusIfCurrent).mockImplementation(
    async (_ctx, _rowId, args) => {
      if (!current || current.status !== args.expectedStatus) return false;
      current.status = args.status;
      current.metadata = {
        ...((current.metadata ?? {}) as Record<string, unknown>),
        ...args.metadataPatch,
      };
      return true;
    },
  );
  return { current: () => current };
}

const FRESH_UPLOAD_URL =
  "https://storage.googleapis.com/upload?X-Goog-Date=20990101T000000Z&X-Goog-Expires=300";
const PENDING_UPLOAD = {
  id: "dus_pending",
  facility_id: "fac_telemetry",
  storage_location_id: null,
  submission_type: "biochar_pyrolysis_reactor_facility_time_series",
  status: "pending",
  error_message: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockReset();
  client.post.mockReset();
  vi.mocked(fetchSignedUploadWithTimeout).mockReset();
  vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({
    facilityId: "30000000-0000-4000-8000-000000000003",
    mapping: {
      externalProjectId: "prj_telemetry",
      externalFacilityId: "fac_telemetry",
    },
    runs: [
      {
        id: "40000000-0000-4000-8000-000000000004",
        code: "RUN-TELEMETRY",
        reactorId: "50000000-0000-4000-8000-000000000005",
        startTime: new Date("2026-08-15T10:00:00.000Z"),
        endTime: new Date("2026-08-15T10:01:00.000Z"),
      },
    ],
  } as never);
  vi.mocked(sensors.listSensorsForReactors).mockResolvedValue([
    {
      reactorId: "50000000-0000-4000-8000-000000000005",
      measurementProperty: "temperature",
      sensorReference: "sensor-temperature",
    },
    {
      reactorId: "50000000-0000-4000-8000-000000000005",
      measurementProperty: "pressure",
      sensorReference: "sensor-pressure",
    },
  ] as never);
  vi.mocked(telemetry.listTelemetryReadingsForRuns).mockResolvedValue([
    {
      productionRunId: "40000000-0000-4000-8000-000000000004",
      reactorId: "50000000-0000-4000-8000-000000000005",
      timestamp: new Date("2026-08-15T10:00:30.000Z"),
      temperatureC: 500,
      pressureBar: 1.2,
      gasFlowRate: null,
    },
  ] as never);
});

describe("submitTelemetry terminal retry behavior", () => {
  it("retries immediately when FileUpload creation fails", async () => {
    const state = installMutableLedger();
    client.post.mockImplementation(async (path: string) => {
      if (path === "/file-uploads") {
        if (
          client.post.mock.calls.filter(([calledPath]) =>
            calledPath === "/file-uploads",
          ).length === 1
        ) {
          throw new Error("file upload creation failed");
        }
        return { id: "tfu_retry", upload_url: FRESH_UPLOAD_URL };
      }
      return PENDING_UPLOAD;
    });
    vi.mocked(fetchSignedUploadWithTimeout).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).rejects.toThrow("Telemetry was not submitted");
    expect(state.current()).toMatchObject({ status: "rejected", version: 1 });

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).resolves.toMatchObject({ status: "pending", version: 1 });
    expect(
      client.post.mock.calls.filter(([path]) => path === "/file-uploads"),
    ).toHaveLength(2);
    expect(
      client.post.mock.calls.filter(
        ([path]) => path === "/data-upload-submissions",
      ),
    ).toHaveLength(1);
  });

  it("reuses the FileUpload when the signed PUT fails", async () => {
    installMutableLedger();
    client.post.mockImplementation(async (path: string) =>
      path === "/file-uploads"
        ? { id: "tfu_reused", upload_url: FRESH_UPLOAD_URL }
        : PENDING_UPLOAD,
    );
    vi.mocked(fetchSignedUploadWithTimeout)
      .mockRejectedValueOnce(new Error("signed PUT failed"))
      .mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).rejects.toThrow("Telemetry was not submitted");
    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).resolves.toMatchObject({ status: "pending", version: 1 });

    expect(
      client.post.mock.calls.filter(([path]) => path === "/file-uploads"),
    ).toHaveLength(1);
    expect(fetchSignedUploadWithTimeout).toHaveBeenCalledTimes(2);
    expect(
      client.post.mock.calls.filter(
        ([path]) => path === "/data-upload-submissions",
      ),
    ).toHaveLength(1);
  });

  it("reuses the FileUpload after a definitive DataUploadSubmission refusal", async () => {
    installMutableLedger();
    client.post.mockImplementation(async (path: string) => {
      if (path === "/file-uploads") {
        return { id: "tfu_reused", upload_url: FRESH_UPLOAD_URL };
      }
      if (
        client.post.mock.calls.filter(
          ([calledPath]) => calledPath === "/data-upload-submissions",
        ).length === 1
      ) {
        throw new IsometricApiError(
          "invalid DataUploadSubmission",
          422,
          { detail: "invalid upload" },
          "http",
        );
      }
      return PENDING_UPLOAD;
    });
    vi.mocked(fetchSignedUploadWithTimeout).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).rejects.toThrow("Telemetry was not submitted");
    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).resolves.toMatchObject({ status: "pending", version: 1 });

    expect(
      client.post.mock.calls.filter(([path]) => path === "/file-uploads"),
    ).toHaveLength(1);
    expect(
      client.post.mock.calls.filter(
        ([path]) => path === "/data-upload-submissions",
      ),
    ).toHaveLength(2);
  });

  it("polls the journaled DataUploadSubmission instead of POSTing again after local finalization fails", async () => {
    installMutableLedger();
    client.post.mockImplementation(async (path: string) =>
      path === "/file-uploads"
        ? { id: "tfu_finalization", upload_url: FRESH_UPLOAD_URL }
        : PENDING_UPLOAD,
    );
    client.get.mockResolvedValue(PENDING_UPLOAD);
    vi.mocked(fetchSignedUploadWithTimeout).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    vi.mocked(ledger.markSubmissionSubmitted).mockRejectedValueOnce(
      new Error("local telemetry finalization failed"),
    );

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).rejects.toThrow("Telemetry was not submitted");
    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).resolves.toMatchObject({ status: "pending", version: 1 });

    expect(client.get).toHaveBeenCalledWith(
      "/data-upload-submissions/dus_pending",
    );
    expect(
      client.post.mock.calls.filter(
        ([path]) => path === "/data-upload-submissions",
      ),
    ).toHaveLength(1);
  });

  it("records a remotely failed existing submission as locally rejected", async () => {
    vi.mocked(claims.getLatestSubmission).mockResolvedValue(
      submissionRow({
        status: "submitted",
        externalId: "dus_failed",
        payloadHash: "semantic-hash",
      }),
    );
    client.get.mockResolvedValue({
      id: "dus_failed",
      facility_id: "fac_telemetry",
      storage_location_id: null,
      submission_type: "biochar_pyrolysis_reactor_facility_time_series",
      status: "failed",
      error_message: "invalid parquet shape",
    });

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).resolves.toMatchObject({
      dataUploadSubmissionId: "dus_failed",
      status: "failed",
      errorMessage: "invalid parquet shape",
    });
    expect(claims.recordTerminalStatusIfCurrent).toHaveBeenCalledWith(
      ORG_CTX,
      ROW_ID,
      {
        status: "rejected",
        expectedStatus: "submitted",
        metadataPatch: {
          [SUBMISSION_METADATA_KEYS.remoteStatus]: "failed",
          [SUBMISSION_METADATA_KEYS.lastError]: "invalid parquet shape",
        },
      },
    );
  });

  it("does not overwrite a version superseded while remote status loads", async () => {
    const state = installMutableLedger(
      submissionRow({
        status: "submitted",
        externalId: "dus_failed",
        payloadHash: "semantic-hash",
      }),
    );
    client.get.mockImplementation(async () => {
      state.current()!.status = "superseded";
      return {
        id: "dus_failed",
        status: "failed",
        error_message: "invalid parquet shape",
      };
    });

    await submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID });

    expect(state.current()?.status).toBe("superseded");
    expect(claims.recordTerminalStatusIfCurrent).toHaveBeenCalledWith(
      ORG_CTX,
      ROW_ID,
      expect.objectContaining({ expectedStatus: "submitted" }),
    );
  });

  it("rejects a reset resume-poll row when status polling fails", async () => {
    const row = submissionRow({
      payloadHash: "semantic-hash",
      payloadSnapshot: {
        journaled: { dataUploadSubmissionId: "dus_uncertain" },
      },
      lockedAt: new Date(0),
    });
    vi.mocked(claims.getLatestSubmission).mockResolvedValue(row);
    vi.mocked(claims.resetSubmissionToDraftWithMappingLock).mockResolvedValue(
      row,
    );
    client.get.mockRejectedValue(
      new Error('status poll failed\nparams: ["operator@example.com"]'),
    );

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).rejects.toThrow("Telemetry was not submitted");
    expect(ledger.markSubmissionRejected).toHaveBeenCalledWith(
      ORG_CTX,
      ROW_ID,
      expect.objectContaining({
        errorMessage: "status poll failed\nparams: [REDACTED]",
        expectedLockedAt: row.lockedAt,
      }),
    );
  });

  it("rejects a reset resume-re-put row when the signed upload fails", async () => {
    const row = submissionRow({
      payloadHash: "semantic-hash",
      payloadSnapshot: {
        journaled: {
          fileUploadId: "tfu_resume",
          uploadUrl: "https://storage.googleapis.com/upload",
          uploadUrlExpiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
      lockedAt: new Date(0),
    });
    vi.mocked(claims.getLatestSubmission).mockResolvedValue(row);
    vi.mocked(claims.resetSubmissionToDraftWithMappingLock).mockResolvedValue(
      row,
    );
    vi.mocked(fetchSignedUploadWithTimeout).mockRejectedValue(
      new Error("signed upload failed"),
    );

    await expect(
      submitTelemetry(ORG_CTX, { removalId: REMOVAL_ID }),
    ).rejects.toThrow("Telemetry was not submitted");
    expect(ledger.markSubmissionRejected).toHaveBeenCalledWith(
      ORG_CTX,
      ROW_ID,
      expect.objectContaining({ errorMessage: "signed upload failed" }),
    );
  });
});
