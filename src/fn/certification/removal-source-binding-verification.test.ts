import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import type { IsometricClient } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import type { Logger } from "@/lib/log";

vi.mock("@/data-access/certifier-removals");
vi.mock("@/lib/isometric/source-binding-verification");
vi.mock("./shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shared")>();
  return {
    ...actual,
    appendSyncEventBestEffort: vi.fn(),
  };
});

import { updateRemovalSourceBindingVerification } from "@/data-access/certifier-removals";
import { verifyRemovalSourceBindings } from "@/lib/isometric/source-binding-verification";
import { verifyAndPersistRemovalSourceBindings } from "./removal-source-binding-verification";
import { appendSyncEventBestEffort } from "./shared";

const orgCtx = {
  organizationId: "org-test-1",
  userId: "user-test-1",
} as OrgContext;
const client = {} as IsometricClient;

function makeLogger(): Logger {
  const log = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  return log;
}

function makeRow(sourceBindingPlan: unknown): CertificationSubmissionRow {
  return {
    id: "submission-test-1",
    version: 2,
    payloadSnapshot: { sourceBindingPlan },
  } as CertificationSubmissionRow;
}

const validPlan = [
  {
    documentId: "document-test-1",
    sourceId: "source-test-1",
    nomaRole: "inventory",
    lineage: {
      entityType: "application",
      entityId: "application-test-1",
      entityLabel: "Application APP-TEST-1",
    },
    intendedTarget: {
      kind: "sequestration",
      groupKey: "co2-stored",
      componentId: "component-test-1",
      componentBlueprintKey: "carbon_rich_substance_sequestration",
      inputKey: "product_mass",
      creditBatchIds: ["batch-test-1"],
    },
    mappingRevision: "source-binding-v1",
  },
];

describe("verifyAndPersistRemovalSourceBindings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(updateRemovalSourceBindingVerification).mockResolvedValue();
    vi.mocked(appendSyncEventBestEffort).mockResolvedValue();
  });

  it("persists a stale stored plan as a terminal mismatch", async () => {
    const log = makeLogger();

    await verifyAndPersistRemovalSourceBindings({
      client,
      orgCtx,
      removalId: "removal-test-1",
      submissionRow: makeRow([{}]),
      externalRemovalId: "removal-external-1",
      log,
    });

    expect(verifyRemovalSourceBindings).not.toHaveBeenCalled();
    expect(updateRemovalSourceBindingVerification).toHaveBeenCalledWith(
      orgCtx,
      "removal-test-1",
      expect.objectContaining({
        state: "mismatch",
        verifiedCount: 0,
        totalCount: 1,
      }),
    );
    expect(appendSyncEventBestEffort).toHaveBeenCalledWith(
      orgCtx,
      expect.objectContaining({
        status: "failed",
        responsePayload: expect.objectContaining({ state: "mismatch" }),
        errorMessage: expect.stringMatching(/stale submission/i),
      }),
      { submissionId: "submission-test-1" },
    );
  });

  it.each([
    new Error("registry timeout"),
    new SafeError("registry response is not ready"),
  ])("keeps registry verification failures awaiting sync", async (error) => {
    vi.mocked(verifyRemovalSourceBindings).mockRejectedValue(error);

    await verifyAndPersistRemovalSourceBindings({
      client,
      orgCtx,
      removalId: "removal-test-1",
      submissionRow: makeRow(validPlan),
      externalRemovalId: "removal-external-1",
      log: makeLogger(),
    });

    expect(updateRemovalSourceBindingVerification).toHaveBeenCalledWith(
      orgCtx,
      "removal-test-1",
      expect.objectContaining({
        state: "awaiting_sync",
        verifiedCount: 0,
        totalCount: 1,
      }),
    );
  });

  it("sanitizes persistence errors before logging them", async () => {
    vi.mocked(verifyRemovalSourceBindings).mockResolvedValue({
      state: "verified",
      verifiedCount: 1,
      totalCount: 1,
      mismatches: [],
    });
    vi.mocked(updateRemovalSourceBindingVerification).mockRejectedValue(
      new Error(
        "Failed query: update removals set metadata = $1 params: person@example.com",
      ),
    );
    const log = makeLogger();

    await verifyAndPersistRemovalSourceBindings({
      client,
      orgCtx,
      removalId: "removal-test-1",
      submissionRow: makeRow(validPlan),
      externalRemovalId: "removal-external-1",
      log,
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: "Failed query: update removals set metadata = $1 params: [REDACTED]",
      }),
      "failed to persist Removal Source binding verification",
    );
  });
});
