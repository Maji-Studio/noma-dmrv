import { describe, expect, it } from "vitest";
import type { GhgStatement } from "@/lib/isometric";
import {
  deriveGhgStatementWorkflowState,
  deriveVerifierStep,
} from "./ghg-statement-workflow-state";

function statement(
  overrides: Partial<GhgStatement> = {},
): GhgStatement {
  return {
    id: "ggs_1",
    project_id: "prj_1",
    status: "DRAFT",
    ghg_entry_ids: ["entry_1"],
    removal_ids: [],
    pending_total_co2e_removed_kg: 100,
    reporting_period_start_at: "2026-01-01",
    reporting_period_end_at: "2026-01-31",
    ghg_statement_report_url: null,
    submitted_at: null,
    credits_issued_at: null,
    verifier: null,
    credit_allocation: null,
    ...overrides,
  };
}

const availableRollup = {
  status: "available" as const,
  message: "Exact registry roll-up available.",
};

describe("GHG Statement workflow state", () => {
  it("derives verifier status from membership and registry status", () => {
    expect(deriveVerifierStep(statement(), false, true)).toEqual({
      status: "active",
      detail:
        "Review the statement and submit it. noma attaches the report automatically.",
    });
    expect(
      deriveVerifierStep(
        statement({ status: "AWAITING_VERIFICATION" }),
        false,
        true,
      ),
    ).toEqual({
      status: "met",
      detail: "In verification. No action is needed.",
    });
  });

  it("requires both exact roll-up data and the statement total to generate", () => {
    const ready = deriveGhgStatementWorkflowState({
      created: true,
      canManageReports: true,
      remote: statement(),
      linkedRemovalCount: 1,
      rollup: availableRollup,
    });
    expect(ready.rollupReady).toBe(true);
    expect(ready.canGenerate).toBe(true);

    const missingStatementTotal = deriveGhgStatementWorkflowState({
      created: true,
      canManageReports: true,
      remote: statement({ pending_total_co2e_removed_kg: null }),
      linkedRemovalCount: 1,
      rollup: availableRollup,
    });
    expect(missingStatementTotal.rollupReady).toBe(false);
    expect(missingStatementTotal.canGenerate).toBe(false);
    expect(missingStatementTotal.generationUnavailableReason).toBe(
      "Wait for Isometric to finish calculating the GHG Statement total.",
    );
  });

  it("reports the specific roll-up blocker", () => {
    const pending = deriveGhgStatementWorkflowState({
      created: true,
      canManageReports: true,
      remote: statement(),
      linkedRemovalCount: 1,
      rollup: {
        status: "pending",
        message: "Registry totals are waiting for linked GHG Entries.",
      },
    });
    expect(pending.generationUnavailableReason).toBe(
      "Registry totals are waiting for linked GHG Entries.",
    );

    const failed = deriveGhgStatementWorkflowState({
      created: true,
      canManageReports: true,
      remote: statement(),
      linkedRemovalCount: 1,
      rollup: { status: "error" },
    });
    expect(failed.generationUnavailableReason).toBe(
      "The registry roll-up could not be loaded. Refresh and try again.",
    );
  });

  it("offers Submit for a live statement because the dialog resolves the report", () => {
    const input = {
      created: true,
      canManageReports: true,
      remote: statement(),
      linkedRemovalCount: 1,
      rollup: availableRollup,
    };

    expect(deriveGhgStatementWorkflowState(input).canSubmit).toBe(true);
    expect(
      deriveGhgStatementWorkflowState({
        ...input,
        remote: null,
      }).canSubmit,
    ).toBe(false);
  });
});
