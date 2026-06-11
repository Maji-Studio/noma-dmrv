/**
 * Unit tests for `performRegistryCreate` — the shared registry
 * create-or-reconcile choreography (reliability-track Phase 2).
 *
 * The module composes the caller-supplied create/reconcile thunks with
 * ledger + sync-event writes, so the data-access layer is mocked and the
 * thunks are plain spies. The pipeline tests (isometric-submit-removal,
 * isometric-ghg-statement-submit) prove the call sites wire real registry
 * wrappers into this module; the boundary tests against a registry-shaped
 * counterparty are Phase 3.
 *
 * Coverage:
 *   1. Fresh create        → POST, succeeded event, source "create".
 *   2. Resumed + orphan    → reconcile-first claims it, NO POST,
 *                            `:reconciled` event, source "reconciliation".
 *   3. Resumed + no orphan → falls through to a normal POST.
 *   4. POST fails + orphan → claimed by lookup, `:reconciled` event,
 *                            row NOT rejected, no throw.
 *   5. POST fails + miss   → failed event carries the registry response
 *                            body + mapping_revision, row rejected,
 *                            SafeError with the caller's prefix.
 *   6. Ambiguous lookup    → row rejected with the caller's message,
 *                            SafeError, no failed event.
 *   7. Best-effort events  → a failing sync-event insert never unwinds a
 *                            successful create.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data-access/certification");

import * as ledger from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import { IsometricApiError } from "@/lib/isometric";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";
import {
  performRegistryCreate,
  supplierRefLookup,
  type PerformRegistryCreateArgs,
  type ReconcileLookup,
} from "@/fn/certification/registry-create";

const USER_ID = "user-test-1";
const ENTITY_ID = "rem-test-1";
const ROW_ID = "sub-test-1";
const EXTERNAL_ID = "ext_created_1";
const ORPHAN_ID = "ext_orphan_1";
const OPERATION = "removal:create";
const REQUEST_PAYLOAD = { project_id: "prj_1", supplier_reference_id: "nm-x" };
const FAILURE_PREFIX = "Removal POST failed";

function makeArgs(
  overrides: Partial<PerformRegistryCreateArgs> = {},
): PerformRegistryCreateArgs {
  return {
    userId: USER_ID,
    entityType: "removal",
    entityId: ENTITY_ID,
    submissionRowId: ROW_ID,
    operation: OPERATION,
    requestPayload: REQUEST_PAYLOAD,
    resumed: false,
    create: vi.fn(async () => EXTERNAL_ID),
    reconcile: vi.fn(async (): Promise<ReconcileLookup> => ({ found: "none" })),
    failureMessagePrefix: FAILURE_PREFIX,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ledger.appendSyncEvent).mockResolvedValue(undefined as never);
  vi.mocked(ledger.markSubmissionRejected).mockResolvedValue(
    undefined as never,
  );
});

describe("performRegistryCreate", () => {
  it("POSTs on a fresh attempt and records a succeeded event with the supplier ref", async () => {
    const args = makeArgs({ supplierRefId: "nm-x" });

    const result = await performRegistryCreate(args);

    expect(result).toEqual({ externalId: EXTERNAL_ID, source: "create" });
    expect(args.create).toHaveBeenCalledTimes(1);
    expect(args.reconcile).not.toHaveBeenCalled();
    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(USER_ID, {
      provider: "isometric",
      entityType: "removal",
      entityId: ENTITY_ID,
      operation: OPERATION,
      status: "succeeded",
      requestPayload: REQUEST_PAYLOAD,
      responsePayload: {
        id: EXTERNAL_ID,
        supplier_reference_id: "nm-x",
        mapping_revision: MAPPING_REVISION,
      },
    });
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("reconciles BEFORE posting on a resumed draft and skips the POST when the orphan exists", async () => {
    const args = makeArgs({
      resumed: true,
      reconcile: vi.fn(
        async (): Promise<ReconcileLookup> => ({
          found: "single",
          externalId: ORPHAN_ID,
        }),
      ),
    });

    const result = await performRegistryCreate(args);

    expect(result).toEqual({ externalId: ORPHAN_ID, source: "reconciliation" });
    expect(args.create).not.toHaveBeenCalled();
    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      expect.objectContaining({
        operation: `${OPERATION}:reconciled`,
        status: "succeeded",
        responsePayload: {
          id: ORPHAN_ID,
          source: "reconciliation",
          mapping_revision: MAPPING_REVISION,
        },
      }),
    );
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("falls through to a normal POST when the resumed reconcile finds nothing", async () => {
    const args = makeArgs({ resumed: true });

    const result = await performRegistryCreate(args);

    expect(result).toEqual({ externalId: EXTERNAL_ID, source: "create" });
    expect(args.reconcile).toHaveBeenCalledTimes(1);
    expect(args.create).toHaveBeenCalledTimes(1);
  });

  it("claims the orphan when the POST fails but the lookup finds it", async () => {
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new IsometricApiError("network dropped", undefined, undefined, "network");
      }),
      reconcile: vi.fn(
        async (): Promise<ReconcileLookup> => ({
          found: "single",
          externalId: ORPHAN_ID,
        }),
      ),
    });

    const result = await performRegistryCreate(args);

    expect(result).toEqual({ externalId: ORPHAN_ID, source: "reconciliation" });
    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      expect.objectContaining({
        operation: `${OPERATION}:reconciled`,
        status: "succeeded",
      }),
    );
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("rejects the row with a failed event carrying the registry response body when the POST fails and the lookup misses", async () => {
    const registryBody = { errors: [{ detail: "quantity must be positive" }] };
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new IsometricApiError("422 Unprocessable", 422, registryBody, "http");
      }),
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(
      new SafeError(`${FAILURE_PREFIX}: 422 Unprocessable`),
    );

    expect(args.reconcile).toHaveBeenCalledTimes(1);
    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(USER_ID, {
      provider: "isometric",
      entityType: "removal",
      entityId: ENTITY_ID,
      operation: OPERATION,
      status: "failed",
      requestPayload: REQUEST_PAYLOAD,
      responsePayload: {
        mapping_revision: MAPPING_REVISION,
        body: registryBody,
      },
      errorMessage: "422 Unprocessable",
    });
    expect(ledger.markSubmissionRejected).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      ROW_ID,
      { errorMessage: "422 Unprocessable" },
    );
  });

  it("omits the body but keeps mapping_revision when the failure is not an IsometricApiError", async () => {
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(SafeError);

    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      expect.objectContaining({
        status: "failed",
        responsePayload: { mapping_revision: MAPPING_REVISION },
        errorMessage: "socket hang up",
      }),
    );
  });

  it("rejects with the caller's ambiguity message when the lookup finds multiple candidates", async () => {
    const ambiguousMessage =
      "Multiple draft GHG statements exist for this project and period in Isometric.";
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new Error("network dropped");
      }),
      reconcile: vi.fn(
        async (): Promise<ReconcileLookup> => ({ found: "multiple" }),
      ),
      ambiguousMessage,
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(
      new SafeError(ambiguousMessage),
    );

    expect(ledger.markSubmissionRejected).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      ROW_ID,
      { errorMessage: ambiguousMessage },
    );
    // Parity with the pre-module GHG path: ambiguity rejects without a
    // failed sync event (the rejection itself carries the message).
    expect(ledger.appendSyncEvent).not.toHaveBeenCalled();
  });

  it("never unwinds a successful create because the audit insert failed (best-effort events)", async () => {
    vi.mocked(ledger.appendSyncEvent).mockRejectedValue(
      new Error("sync-event table unavailable"),
    );
    const args = makeArgs();

    await expect(performRegistryCreate(args)).resolves.toEqual({
      externalId: EXTERNAL_ID,
      source: "create",
    });
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });
});

describe("supplierRefLookup", () => {
  it("maps the two-way supplier-ref shape onto the three-way lookup", () => {
    expect(supplierRefLookup({ found: true, externalId: "dpt_1" })).toEqual({
      found: "single",
      externalId: "dpt_1",
    });
    expect(supplierRefLookup({ found: false })).toEqual({ found: "none" });
  });
});
