import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementReportWorkflow } from "./ghg-statement-report-workflow";

const prepareMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
};
const approveMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock("@/hooks/use-certification", () => ({
  usePrepareGhgStatementReport: () => prepareMutation,
  useApproveGhgStatementReport: () => approveMutation,
  useGhgStatementReports: vi.fn(),
}));

describe("GhgStatementReportWorkflow", () => {
  beforeEach(() => {
    prepareMutation.mutateAsync.mockReset();
    approveMutation.mutateAsync.mockReset();
  });

  it("renders one-click generation without narrative fields", () => {
    const html = renderToStaticMarkup(
      <GhgStatementReportWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        reportsQuery={
          {
            isLoading: false,
            error: null,
            data: [],
          } as never
        }
      />,
    );

    expect(html).toContain("Generate report");
    expect(html).toContain("No report generated yet.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("System boundary");
    expect(html).not.toContain("Human reviewed");
  });

  it("keeps review and approval explicit for a prepared version", () => {
    const html = renderToStaticMarkup(
      <GhgStatementReportWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        reportsQuery={
          {
            isLoading: false,
            error: null,
            data: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                version: 2,
                lifecycle: "prepared",
                reviewUrl: "/api/documents/report",
              },
            ],
          } as never
        }
      />,
    );

    expect(html).toContain("Generate new version");
    expect(html).toContain("Review");
    expect(html).toContain("Approve");
    expect(html).toContain("Version 2");
  });

  it("disables generation until the live statement has entries", () => {
    const html = renderToStaticMarkup(
      <GhgStatementReportWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        canGenerate={false}
        reportsQuery={
          {
            isLoading: false,
            error: null,
            data: [],
          } as never
        }
      />,
    );

    expect(html).toContain("Generate report");
    expect(html).toMatch(/<button[^>]*\sdisabled/);
    expect(html).toContain("A live GHG Statement with entries is required.");
  });
});
