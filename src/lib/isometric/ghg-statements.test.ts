import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    ISOMETRIC_CLIENT_SECRET: "test-client-secret",
    ISOMETRIC_ACCESS_TOKEN: "test-access-token",
    ISOMETRIC_ENVIRONMENT: "sandbox",
  },
}));

import { getIsometricClientFromEnv } from "./client";
import {
  getGhgStatementPeriod,
  listGhgStatementsForProject,
  matchGhgStatementForCreate,
  type GhgStatement,
  type GhgStatementStatus,
} from "./ghg-statements";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GHG statement registry discovery", () => {
  it("follows every cursor page before filtering to the project", async () => {
    const pages = [
      {
        nodes: [
          statement("ggs_first", "prj_target"),
          statement("ggs_other", "prj_other"),
        ],
        page_info: { has_next_page: true, end_cursor: "cursor-2" },
        total_count: 3,
      },
      {
        nodes: [statement("ggs_second", "prj_target")],
        page_info: { has_next_page: false, end_cursor: null },
        total_count: 3,
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(pages.shift()),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listGhgStatementsForProject(
        getIsometricClientFromEnv(),
        "prj_target",
      ),
    ).resolves.toMatchObject([{ id: "ggs_first" }, { id: "ggs_second" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1] as unknown as [string];
    const secondUrl = new URL(secondCall[0]);
    expect(secondUrl.searchParams.get("after")).toBe("cursor-2");
  });
});

describe("GHG statement create matching", () => {
  it("does not adopt a DRAFT with no registry period for an arbitrary date", () => {
    const remote = statement("ggs_null", "prj_target", {
      reporting_period_start_at: null,
      reporting_period_end_at: null,
    });

    expect(getGhgStatementPeriod(remote)).toEqual({
      startOn: null,
      endOn: null,
    });
    expect(matchGhgStatementForCreate(remote, "2026-03-31").behavior).toBe(
      "unrelated",
    );
  });

  it("refuses a non-DRAFT covering the requested end and names its state", () => {
    const remote = statement("ggs_verified", "prj_target", {
      status: "VERIFIED",
      reporting_period_start_at: "2026-01-01",
      reporting_period_end_at: "2026-04-01",
    });

    expect(matchGhgStatementForCreate(remote, "2026-03-31")).toMatchObject({
      behavior: "refuse",
      statement: { id: "ggs_verified", status: "VERIFIED" },
    });
  });

  it("adopts a DRAFT whose end is one calendar day away", () => {
    const remote = statement("ggs_adjacent", "prj_target", {
      reporting_period_end_at: "2026-03-30",
    });

    expect(matchGhgStatementForCreate(remote, "2026-03-31").behavior).toBe(
      "adopt",
    );
  });

  it("leaves an unrelated remote period alone", () => {
    const remote = statement("ggs_old", "prj_target", {
      reporting_period_start_at: "2025-01-01",
      reporting_period_end_at: "2025-03-31",
    });

    expect(matchGhgStatementForCreate(remote, "2026-03-31").behavior).toBe(
      "unrelated",
    );
  });
});

function statement(
  id: string,
  projectId: string,
  overrides: Partial<GhgStatement> = {},
): GhgStatement {
  return {
    id,
    project_id: projectId,
    verifier: null,
    ghg_entry_ids: [],
    removal_ids: [],
    credit_allocation: null,
    ghg_statement_report_url: null,
    status: "DRAFT" as GhgStatementStatus,
    reporting_period_start_at: "2026-01-01",
    reporting_period_end_at: "2026-03-31",
    submitted_at: null,
    credits_issued_at: null,
    pending_total_co2e_removed_kg: null,
    ...overrides,
  };
}
