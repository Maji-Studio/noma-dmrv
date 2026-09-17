/**
 * The production-run actions answer every refusal with the shared
 * `ActionResult` failure shape. A stale-version refusal must keep its typed
 * `conflict` so the hook can re-throw it as `StaleVersionError` and the edit
 * sheet can keep the operator's draft (issue #768); an overlap keeps the run
 * it collides with (#259); anything unexpected is logged and replaced by the
 * fallback. The data-access layer is mocked; the guards themselves run
 * against the database in tests/expected-version-blanket.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionConflictError } from "@/lib/errors";
import {
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
} from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  updateProductionRun: vi.fn(),
  deleteProductionRun: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ productionRuns: { code: "code" } }));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mocks.requireOrgContext,
}));

vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/code-generator", () => ({
  CODE_CONFLICT_MESSAGES: { productionRun: "duplicate" },
  withAutoCode: vi.fn(),
}));

vi.mock("@/data-access/production-runs", async () => {
  const { SafeError } = await import("@/lib/errors");
  class ProductionRunOverlapError extends SafeError {
    readonly conflict: { entity: string; id: string; code: string };
    constructor(message: string, conflict: { entity: string; id: string; code: string }) {
      super(message);
      this.name = "ProductionRunOverlapError";
      this.conflict = conflict;
    }
  }
  class ProductionRunDependencyError extends ProductionRunOverlapError {}
  return {
    createProductionRun: vi.fn(),
    deleteProductionRun: mocks.deleteProductionRun,
    getProductionRunById: vi.fn(),
    getFacilityEnergyTotals: vi.fn(),
    getProductionRunReadings: vi.fn(),
    updateProductionRun: mocks.updateProductionRun,
    ProductionRunOverlapError,
    ProductionRunDependencyError,
  };
});

vi.mock("@/lib/log", () => ({
  logger: { error: mocks.loggerError, child: () => ({ error: mocks.loggerError }) },
  sanitizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { ProductionRunOverlapError } from "@/data-access/production-runs";
import { deleteProductionRunFn, updateProductionRunFn } from "./production-runs";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID = "00000000-0000-4000-8000-000000000002";
const OPENED_AT = new Date("2026-09-01T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgContext.mockResolvedValue({
    organizationId: "org",
    userId: "user",
    orgRole: "owner",
    isPlatformAdmin: false,
  });
});

describe("updateProductionRunFn", () => {
  it("keeps the stale-version conflict on a refused save", async () => {
    mocks.updateProductionRun.mockRejectedValue(
      new ActionConflictError(STALE_VERSION_MESSAGE, {
        entity: "productionRun",
        id: RUN_ID,
        code: STALE_VERSION_CONFLICT_CODE,
      }),
    );

    const result = await updateProductionRunFn({
      productionRunId: RUN_ID,
      expectedUpdatedAt: OPENED_AT,
      feedingRateKgHr: 10,
    });

    expect(result).toEqual({
      success: false,
      error: STALE_VERSION_MESSAGE,
      conflict: {
        entity: "productionRun",
        id: RUN_ID,
        code: STALE_VERSION_CONFLICT_CODE,
      },
    });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("keeps the overlapping run on an overlap refusal", async () => {
    mocks.updateProductionRun.mockRejectedValue(
      new ProductionRunOverlapError("Overlaps PR-002.", {
        entity: "productionRun",
        id: OTHER_RUN_ID,
        code: "PR-002",
      }),
    );

    const result = await updateProductionRunFn({ productionRunId: RUN_ID });

    expect(result).toEqual({
      success: false,
      error: "Overlaps PR-002.",
      conflict: { entity: "productionRun", id: OTHER_RUN_ID, code: "PR-002" },
    });
  });

  it("logs an unexpected failure and answers with the fallback", async () => {
    mocks.updateProductionRun.mockRejectedValue(new Error("connection reset"));

    const result = await updateProductionRunFn({ productionRunId: RUN_ID });

    expect(result).toEqual({
      success: false,
      error: "Production run was not saved. Try again.",
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ op: "production-run:update" }),
      "production run action failed",
    );
  });

  it("answers invalid input with the field message", async () => {
    const result = await updateProductionRunFn({
      productionRunId: "not-a-uuid",
    });

    expect(result.success).toBe(false);
    expect(mocks.updateProductionRun).not.toHaveBeenCalled();
  });
});

describe("deleteProductionRunFn", () => {
  it("reports a committed delete", async () => {
    mocks.deleteProductionRun.mockResolvedValue(undefined);

    await expect(
      deleteProductionRunFn({ productionRunId: RUN_ID }),
    ).resolves.toEqual({ success: true, data: undefined });
  });
});
