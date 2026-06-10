import { describe, expect, it } from "vitest";
import type { GhgStatement } from "@/lib/isometric";
import {
  chooseGhgSubmitMode,
  ghgSubmitFingerprintChanged,
} from "@/lib/isometric/utils/ghg-statement-state";

describe("GHG statement submit state", () => {
  it("submits drafts and resubmits verifier failures", () => {
    expect(chooseGhgSubmitMode(statement({ status: "DRAFT" }))).toBe("submit");
    expect(
      chooseGhgSubmitMode(statement({ status: "FAILED_VERIFICATION" })),
    ).toBe("resubmit");
  });

  it("resubmits verified statements only when pending changes exist", () => {
    expect(
      chooseGhgSubmitMode(
        statement({
          status: "VERIFIED",
          pending_total_co2e_removed_kg: 42,
        }),
      ),
    ).toBe("resubmit");
    expect(chooseGhgSubmitMode(statement({ status: "VERIFIED" }))).toBe(
      "blocked-verified",
    );
    expect(
      chooseGhgSubmitMode(
        statement({
          status: "VERIFIED",
          pending_total_co2e_removed_kg: 0,
        }),
      ),
    ).toBe("blocked-verified");
    expect(
      chooseGhgSubmitMode(
        statement({
          status: "AWAITING_VERIFICATION",
          pending_total_co2e_removed_kg: 42,
        }),
      ),
    ).toBe("blocked-awaiting");
  });

  it("detects ambiguous submit success by remote fingerprint", () => {
    const before = statement({ status: "DRAFT", submitted_at: null });
    const after = statement({
      status: "AWAITING_VERIFICATION",
      submitted_at: "2026-05-05T10:00:00Z",
      ghg_statement_report_url: "https://example.com/report.pdf",
    });

    expect(ghgSubmitFingerprintChanged(before, after)).toBe(true);
    expect(ghgSubmitFingerprintChanged(before, { ...before })).toBe(false);
  });
});

function statement(overrides: Partial<GhgStatement>): GhgStatement {
  return {
    id: "ggs_1",
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
    ...overrides,
  };
}
