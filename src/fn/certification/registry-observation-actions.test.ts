import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const ORG_CTX = {
  userId: "user-test-1",
  organizationId: "org-test-1",
  orgRole: "owner",
  isPlatformAdmin: false,
} as OrgContext;

vi.mock("../with-action", () => ({
  withAction: async <T>(fn: (ctx: OrgContext) => Promise<T>) => {
    try {
      return { success: true as const, data: await fn(ORG_CTX) };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Unexpected error",
      };
    }
  },
}));
vi.mock("@/data-access/certification", () => ({
  getLatestSubmissionsForEntities: vi.fn(),
}));
vi.mock("@/data-access/certification-submissions", () => ({
  getLatestSubmission: vi.fn(),
}));
vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: vi.fn(),
  getCreditBatchesByRemovalId: vi.fn(),
}));
vi.mock("@/data-access/certifier-ghg-statements", () => ({
  getCertifierGhgStatementById: vi.fn(),
  getRemovalsByGhgStatementId: vi.fn(),
}));
vi.mock("@/lib/isometric", () => ({
  getIsometricClientForOrg: vi.fn(async () => ({})),
  getGhgEntry: vi.fn(),
  getGhgStatement: vi.fn(),
}));

import { getLatestSubmissionsForEntities } from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import {
  getCertifierGhgStatementById,
  getRemovalsByGhgStatementId,
} from "@/data-access/certifier-ghg-statements";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
} from "@/data-access/certifier-removals";
import {
  getGhgEntry,
  getGhgStatement,
  getIsometricClientForOrg,
} from "@/lib/isometric";
import { loadGhgStatementBreakdown } from "./ghg-statement-breakdown";
import { loadRemovalBreakdown } from "./removal-breakdown";
import { readRemovalDurabilityComponent } from "@/lib/certification/removal-durability-component";

const REMOVAL_ID = "removal-1";
const STATEMENT_ID = "statement-1";
const ENTRY_ID = "entry-1";
const EXTERNAL_STATEMENT_ID = "external-statement-1";

function registryEntry(id = ENTRY_ID) {
  return {
    id,
    co2e_net_removed_kg: 900,
    co2e_net_removed_without_discount_kg: 1000,
    co2e_net_removed_standard_deviation_kg: 12,
    risk_of_reversal_percentage: 10,
    credit_allocation: null,
    ghg_statement_id: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getIsometricClientForOrg).mockResolvedValue({} as never);
  vi.mocked(getCertifierRemovalById).mockResolvedValue({
    id: REMOVAL_ID,
    startedOn: "2026-01-01",
    completedOn: "2026-01-31",
  } as never);
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([
    { id: "batch-1" },
  ] as never);
  vi.mocked(getCertifierGhgStatementById).mockResolvedValue({
    id: STATEMENT_ID,
    reportingPeriodStartOn: "2026-01-01",
    reportingPeriodEndOn: "2026-12-31",
  } as never);
  vi.mocked(getRemovalsByGhgStatementId).mockResolvedValue([
    { id: REMOVAL_ID },
  ] as never);
});

describe("Removal RegistryObservation", () => {
  it("labels deprecated snapshot components with legacy total-carbon uncapped semantics", () => {
    expect(
      readRemovalDurabilityComponent({
        semantic: {
          sequestrationTemplate: [
            { blueprintKey: "biochar_sequestration_1000_year" },
          ],
        },
      }),
    ).toEqual({
      key: "biochar_sequestration_1000_year",
      label:
        "Legacy 1,000-year calculation: total-carbon basis, uncapped durability",
      deprecated: true,
    });
  });

  it("returns pending without an external ID and makes no registry request", async () => {
    vi.mocked(getLatestSubmission).mockResolvedValue(null);

    const result = await loadRemovalBreakdown(REMOVAL_ID);

    expect(result).toMatchObject({
      success: true,
      data: { status: "pending", value: null },
    });
    expect(getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(getGhgEntry).not.toHaveBeenCalled();
  });

  it("returns unavailable on a failed GET and available only for complete registry figures", async () => {
    vi.mocked(getLatestSubmission).mockResolvedValue({
      externalId: ENTRY_ID,
    } as never);
    vi.mocked(getGhgEntry).mockRejectedValueOnce(new Error("GET failed"));

    await expect(loadRemovalBreakdown(REMOVAL_ID)).resolves.toMatchObject({
      success: true,
      data: { status: "unavailable", value: null },
    });

    vi.mocked(getGhgEntry).mockResolvedValue(registryEntry() as never);
    await expect(loadRemovalBreakdown(REMOVAL_ID)).resolves.toMatchObject({
      success: true,
      data: {
        status: "available",
        value: { netRemovedKg: 900 },
      },
    });
  });
});

describe("GHG Statement RegistryObservation", () => {
  it("returns pending without every exact submitted member and makes no registry request", async () => {
    vi.mocked(getLatestSubmissionsForEntities).mockResolvedValue(new Map());
    vi.mocked(getLatestSubmission).mockResolvedValue({
      externalId: EXTERNAL_STATEMENT_ID,
    } as never);

    const result = await loadGhgStatementBreakdown(STATEMENT_ID);

    expect(result).toMatchObject({
      success: true,
      data: { status: "pending", value: null },
    });
    expect(getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(getGhgEntry).not.toHaveBeenCalled();
  });

  it("shows no partial total for unreadable or mismatched registry membership", async () => {
    vi.mocked(getLatestSubmissionsForEntities).mockResolvedValue(
      new Map([[REMOVAL_ID, { externalId: ENTRY_ID }]]) as never,
    );
    vi.mocked(getLatestSubmission).mockResolvedValue({
      externalId: EXTERNAL_STATEMENT_ID,
    } as never);
    vi.mocked(getGhgEntry).mockResolvedValue(registryEntry() as never);
    vi.mocked(getGhgStatement).mockResolvedValue({
      id: EXTERNAL_STATEMENT_ID,
      status: "DRAFT",
      ghg_entry_ids: ["different-entry"],
      credit_allocation: null,
    } as never);

    await expect(loadGhgStatementBreakdown(STATEMENT_ID)).resolves.toMatchObject({
      success: true,
      data: { status: "pending", value: null },
    });

    vi.mocked(getGhgEntry).mockRejectedValueOnce(new Error("GET failed"));
    await expect(loadGhgStatementBreakdown(STATEMENT_ID)).resolves.toMatchObject({
      success: true,
      data: { status: "unavailable", value: null },
    });
  });

  it("returns an available roll-up only for readable exact members", async () => {
    vi.mocked(getLatestSubmissionsForEntities).mockResolvedValue(
      new Map([[REMOVAL_ID, { externalId: ENTRY_ID }]]) as never,
    );
    vi.mocked(getLatestSubmission).mockResolvedValue({
      externalId: EXTERNAL_STATEMENT_ID,
    } as never);
    vi.mocked(getGhgEntry).mockResolvedValue(registryEntry() as never);
    vi.mocked(getGhgStatement).mockResolvedValue({
      id: EXTERNAL_STATEMENT_ID,
      status: "DRAFT",
      ghg_entry_ids: [ENTRY_ID],
      credit_allocation: null,
    } as never);

    await expect(loadGhgStatementBreakdown(STATEMENT_ID)).resolves.toMatchObject({
      success: true,
      data: {
        status: "available",
        value: {
          netRemovedKg: 900,
          memberRemovalCount: 1,
        },
      },
    });
  });
});
