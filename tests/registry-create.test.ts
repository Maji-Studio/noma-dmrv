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
import { makeTestOrgContext } from "./helpers/test-org";

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
const LOCKED_AT = new Date("2026-08-10T12:00:00.000Z");
const EXTERNAL_ID = "ext_created_1";
const ORPHAN_ID = "ext_orphan_1";
const OPERATION = "removal:create";
const REQUEST_PAYLOAD = { project_id: "prj_1", supplier_reference_id: "nm-x" };
const FAILURE_PREFIX = "Removal POST failed";

function makeArgs(
  overrides: Partial<PerformRegistryCreateArgs> = {},
): PerformRegistryCreateArgs {
  return {
    orgCtx: makeTestOrgContext(USER_ID),
    entityType: "removal",
    entityId: ENTITY_ID,
    submissionRowId: ROW_ID,
    expectedLockedAt: LOCKED_AT,
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
  it("reports confirmed external mutation for fresh create and reconciliation", async () => {
    const freshMutation = vi.fn();
    await performRegistryCreate(makeArgs({ onExternalMutation: freshMutation }));
    expect(freshMutation).toHaveBeenCalledExactlyOnceWith("confirmed");

    const reconciledMutation = vi.fn();
    await performRegistryCreate(
      makeArgs({
        resumed: true,
        reconcile: vi.fn(
          async (): Promise<ReconcileLookup> => ({
            found: "single",
            externalId: ORPHAN_ID,
          }),
        ),
        onExternalMutation: reconciledMutation,
      }),
    );
    expect(reconciledMutation).toHaveBeenCalledExactlyOnceWith("confirmed");
  });

  it("reports possible external mutation after an ambiguous lost response without rejecting the draft", async () => {
    const onExternalMutation = vi.fn();
    await expect(
      performRegistryCreate(
        makeArgs({
          create: vi.fn(async () => {
            throw new IsometricApiError(
              "network dropped",
              undefined,
              undefined,
              "network",
            );
          }),
          onExternalMutation,
        }),
      ),
    ).rejects.toThrow(/Removal POST failed/i);

    expect(onExternalMutation).toHaveBeenCalledExactlyOnceWith("possible");
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("reports possible when an ambiguous create and its reconciliation lookup both fail", async () => {
    const onExternalMutation = vi.fn();
    const lookupError = new Error("lookup unavailable");
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new IsometricApiError(
          "network dropped",
          undefined,
          undefined,
          "network",
        );
      }),
      reconcile: vi.fn(async () => {
        throw lookupError;
      }),
      onExternalMutation,
    });

    await expect(performRegistryCreate(args)).rejects.toBe(lookupError);
    expect(onExternalMutation).toHaveBeenCalledExactlyOnceWith("possible");
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("reports possible when a resumed recovery lookup fails", async () => {
    const onExternalMutation = vi.fn();
    const lookupError = new Error("lookup unavailable");
    const args = makeArgs({
      resumed: true,
      reconcile: vi.fn(async () => {
        throw lookupError;
      }),
      onExternalMutation,
    });

    await expect(performRegistryCreate(args)).rejects.toBe(lookupError);
    expect(onExternalMutation).toHaveBeenCalledExactlyOnceWith("possible");
    expect(args.create).not.toHaveBeenCalled();
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("preserves a definitive provider refusal when its reconciliation lookup also fails", async () => {
    const onExternalMutation = vi.fn();
    const providerError = new IsometricApiError(
      "422 Unprocessable",
      422,
      { errors: [{ detail: "quantity must be positive" }] },
      "http",
    );
    const args = makeArgs({
      create: vi.fn(async () => {
        throw providerError;
      }),
      reconcile: vi.fn(async () => {
        throw new Error("lookup unavailable");
      }),
      onExternalMutation,
    });

    await expect(performRegistryCreate(args)).rejects.toThrow(
      "Provider rejected the request (422): quantity must be positive",
    );
    expect(ledger.markSubmissionRejected).toHaveBeenCalledExactlyOnceWith(
      makeTestOrgContext(USER_ID),
      ROW_ID,
      {
        errorMessage:
          "Provider rejected the request (422): quantity must be positive",
        expectedLockedAt: LOCKED_AT,
      },
    );
    expect(onExternalMutation).not.toHaveBeenCalled();
  });

  it("does not mask a definitive provider refusal when rejection cleanup fails", async () => {
    vi.mocked(ledger.markSubmissionRejected).mockRejectedValue(
      new Error("ledger unavailable"),
    );
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new IsometricApiError(
          "422 Unprocessable",
          422,
          { errors: [{ detail: "quantity must be positive" }] },
          "http",
        );
      }),
    });

    await expect(performRegistryCreate(args)).rejects.toThrow(
      "Provider rejected the request (422): quantity must be positive",
    );
  });

  it("runs confirmed persistence before the success audit and never retries create when persistence fails", async () => {
    const onConfirmed = vi.fn(async () => undefined);
    const successArgs = makeArgs({ onConfirmed });

    await performRegistryCreate(successArgs);

    expect(successArgs.create).toHaveBeenCalledBefore(onConfirmed);
    expect(onConfirmed).toHaveBeenCalledBefore(
      vi.mocked(ledger.appendSyncEvent),
    );
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(EXTERNAL_ID);

    vi.clearAllMocks();
    vi.mocked(ledger.appendSyncEvent).mockResolvedValue(undefined as never);
    const persistenceError = new Error("local ledger unavailable");
    const failingPersistence = vi.fn(async () => {
      throw persistenceError;
    });
    const failingArgs = makeArgs({ onConfirmed: failingPersistence });

    await expect(performRegistryCreate(failingArgs)).rejects.toBe(
      persistenceError,
    );
    expect(failingArgs.create).toHaveBeenCalledTimes(1);
    expect(failingArgs.reconcile).not.toHaveBeenCalled();
    expect(ledger.appendSyncEvent).not.toHaveBeenCalled();
  });

  it("POSTs on a fresh attempt and records a succeeded event with the supplier ref", async () => {
    const args = makeArgs({ supplierRefId: "nm-x" });

    const result = await performRegistryCreate(args);

    expect(result).toEqual({ externalId: EXTERNAL_ID, source: "create" });
    expect(args.create).toHaveBeenCalledTimes(1);
    expect(args.reconcile).not.toHaveBeenCalled();
    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(USER_ID), {
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
      makeTestOrgContext(USER_ID),
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
      makeTestOrgContext(USER_ID),
      expect.objectContaining({
        operation: `${OPERATION}:reconciled`,
        status: "succeeded",
      }),
    );
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("rejects the row with a failed event carrying the registry response body when the POST fails and the lookup misses", async () => {
    const registryBody = {
      errors: [{ detail: "quantity must be positive" }],
      client_secret: "do-not-store",
    };
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new IsometricApiError("422 Unprocessable", 422, registryBody, "http");
      }),
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(
      new SafeError(
        `${FAILURE_PREFIX}: Provider rejected the request (422): quantity must be positive`,
      ),
    );

    expect(args.reconcile).toHaveBeenCalledTimes(1);
    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(USER_ID), {
      provider: "isometric",
      entityType: "removal",
      entityId: ENTITY_ID,
      operation: OPERATION,
      status: "failed",
      requestPayload: REQUEST_PAYLOAD,
      responsePayload: {
        mapping_revision: MAPPING_REVISION,
        body: {
          errors: [{ detail: "quantity must be positive" }],
          client_secret: "[REDACTED]",
        },
      },
      errorMessage: "Provider rejected the request (422): quantity must be positive",
    });
    expect(ledger.markSubmissionRejected).toHaveBeenCalledExactlyOnceWith(
      makeTestOrgContext(USER_ID),
      ROW_ID,
      {
        errorMessage:
          "Provider rejected the request (422): quantity must be positive",
        expectedLockedAt: LOCKED_AT,
      },
    );
  });

  it("keeps the draft locked when an ambiguous non-provider failure cannot be reconciled", async () => {
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(SafeError);

    expect(ledger.appendSyncEvent).toHaveBeenCalledExactlyOnceWith(
      makeTestOrgContext(USER_ID),
      expect.objectContaining({
        status: "failed",
        responsePayload: { mapping_revision: MAPPING_REVISION },
        errorMessage: "Registry create failed. Try again.",
      }),
    );
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("keeps standalone sync failures audited without rejecting an unrelated ledger", async () => {
    const args = makeArgs({
      submissionRowId: undefined,
      create: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(SafeError);

    expect(ledger.appendSyncEvent).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      expect.objectContaining({ status: "failed" }),
    );
    expect(ledger.markSubmissionRejected).not.toHaveBeenCalled();
  });

  it("rejects with the caller's ambiguity message when the lookup finds multiple candidates", async () => {
    const ambiguousMessage =
      "Multiple draft GHG statements exist for this project and period in Isometric.";
    const args = makeArgs({
      create: vi.fn(async () => {
        throw new IsometricApiError("request refused", 422, undefined, "http");
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
      makeTestOrgContext(USER_ID),
      ROW_ID,
      { errorMessage: ambiguousMessage, expectedLockedAt: LOCKED_AT },
    );
    // Parity with the pre-module GHG path: ambiguity rejects without a
    // failed sync event (the rejection itself carries the message).
    expect(ledger.appendSyncEvent).not.toHaveBeenCalled();
  });

  it("records a refused lookup on the claimed ledger row", async () => {
    const refusalMessage =
      "Registry statement ggs_verified is VERIFIED and already covers this reporting period.";
    const args = makeArgs({
      resumed: true,
      reconcile: vi.fn(
        async (): Promise<ReconcileLookup> => ({
          found: "refused",
          message: refusalMessage,
        }),
      ),
    });

    await expect(performRegistryCreate(args)).rejects.toThrowError(
      new SafeError(refusalMessage),
    );

    expect(ledger.markSubmissionRejected).toHaveBeenCalledExactlyOnceWith(
      makeTestOrgContext(USER_ID),
      ROW_ID,
      { errorMessage: refusalMessage, expectedLockedAt: LOCKED_AT },
    );
    expect(args.create).not.toHaveBeenCalled();
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
