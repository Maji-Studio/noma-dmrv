import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GhgStatement, IsometricClient } from "@/lib/isometric";
import {
  reconcileDatapoint,
  reconcileGhgStatement,
  reconcileRemoval,
} from "@/lib/isometric/utils/reconciliation";
import {
  findDatapointBySupplierRef,
  findGhgEntryBySupplierRef,
} from "@/lib/isometric/submissions";
import { findDraftGhgStatementsByPeriod } from "@/lib/isometric/ghg-statements";

vi.mock("@/lib/isometric/submissions", () => ({
  findDatapointBySupplierRef: vi.fn(),
  findGhgEntryBySupplierRef: vi.fn(),
}));

vi.mock("@/lib/isometric/ghg-statements", () => ({
  findDraftGhgStatementsByPeriod: vi.fn(),
}));

const mockedFindDatapoint = vi.mocked(findDatapointBySupplierRef);
const mockedFindRemoval = vi.mocked(findGhgEntryBySupplierRef);
const mockedFindGhg = vi.mocked(findDraftGhgStatementsByPeriod);
const client = {} as IsometricClient;

describe("Isometric reconciliation helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("claims a datapoint by supplier reference", async () => {
    mockedFindDatapoint.mockResolvedValue({ id: "dpt_123" } as Awaited<
      ReturnType<typeof findDatapointBySupplierRef>
    >);

    await expect(
      reconcileDatapoint(client, { supplierRefId: "nm-rmv-1-dp-a-v1" }),
    ).resolves.toEqual({ found: true, externalId: "dpt_123" });
  });

  it("returns not found for missing removals", async () => {
    mockedFindRemoval.mockResolvedValue(null);

    await expect(
      reconcileRemoval(client, { supplierRefId: "nm-rmv-1-removal-v1" }),
    ).resolves.toEqual({ found: false });
  });

  it("surfaces multiple draft GHG statement matches", async () => {
    mockedFindGhg.mockResolvedValue([
      ghgStatement("ggs_1"),
      ghgStatement("ggs_2"),
    ]);

    await expect(
      reconcileGhgStatement(client, { projectId: "prj_1", endOn: "2026-05-05" }),
    ).resolves.toEqual({ found: "multiple", ids: ["ggs_1", "ggs_2"] });
  });
});

function ghgStatement(id: string): GhgStatement {
  return {
    id,
    project_id: "prj_1",
    verifier: null,
    ghg_entry_ids: [],
    removal_ids: [],
    credit_allocation: null,
    ghg_statement_report_url: null,
    status: "DRAFT",
    reporting_period_start_at: "2026-01-01",
    reporting_period_end_at: "2026-05-05",
    submitted_at: null,
    credits_issued_at: null,
    pending_total_co2e_removed_kg: null,
  };
}
