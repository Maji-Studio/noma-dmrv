import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GhgStatement } from "@/lib/isometric";
import {
  reconcileDatapoint,
  reconcileGhgStatement,
  reconcileRemoval,
} from "@/lib/isometric/utils/reconciliation";
import {
  findDatapointBySupplierRef,
  findRemovalBySupplierRef,
} from "@/lib/isometric/submissions";
import { findDraftGhgStatementsByPeriod } from "@/lib/isometric/ghg-statements";

vi.mock("@/lib/isometric/submissions", () => ({
  findDatapointBySupplierRef: vi.fn(),
  findRemovalBySupplierRef: vi.fn(),
}));

vi.mock("@/lib/isometric/ghg-statements", () => ({
  findDraftGhgStatementsByPeriod: vi.fn(),
}));

const mockedFindDatapoint = vi.mocked(findDatapointBySupplierRef);
const mockedFindRemoval = vi.mocked(findRemovalBySupplierRef);
const mockedFindGhg = vi.mocked(findDraftGhgStatementsByPeriod);

describe("Isometric reconciliation helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("claims a datapoint by supplier reference", async () => {
    mockedFindDatapoint.mockResolvedValue({ id: "dpt_123" } as Awaited<
      ReturnType<typeof findDatapointBySupplierRef>
    >);

    await expect(
      reconcileDatapoint({ supplierRefId: "nm-rmv-1-dp-a-v1" }),
    ).resolves.toEqual({ found: true, externalId: "dpt_123" });
  });

  it("returns not found for missing removals", async () => {
    mockedFindRemoval.mockResolvedValue(null);

    await expect(
      reconcileRemoval({ supplierRefId: "nm-rmv-1-removal-v1" }),
    ).resolves.toEqual({ found: false });
  });

  it("surfaces multiple draft GHG statement matches", async () => {
    mockedFindGhg.mockResolvedValue([
      ghgStatement("ggs_1"),
      ghgStatement("ggs_2"),
    ]);

    await expect(
      reconcileGhgStatement({ projectId: "prj_1", endOn: "2026-05-05" }),
    ).resolves.toEqual({ found: "multiple", ids: ["ggs_1", "ggs_2"] });
  });
});

function ghgStatement(id: string): GhgStatement {
  return {
    id,
    project_id: "prj_1",
    verifier: null,
    removal_ids: [],
    ghg_statement_report_url: null,
    status: "DRAFT",
    reporting_period_start_at: "2026-01-01",
    reporting_period_end_at: "2026-05-05",
    submitted_at: null,
    credits_issued_at: null,
    pending_total_co2e_removed_kg: null,
  };
}
