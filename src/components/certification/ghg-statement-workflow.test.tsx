import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementWorkflow } from "./ghg-statement-workflow";

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

function reportsQuery(data: unknown[]) {
  return {
    isLoading: false,
    error: null,
    data,
  } as never;
}

describe("GhgStatementWorkflow", () => {
  beforeEach(() => {
    prepareMutation.mutateAsync.mockReset();
    approveMutation.mutateAsync.mockReset();
  });

  it("renders all four steps with one-click generation and no narrative fields", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).toContain("Created in registry");
    expect(html).toContain("Report generated");
    expect(html).toContain("Report approved");
    expect(html).toContain("Submitted to verifier");
    expect(html).toContain("Generate report");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="checkbox"');
  });

  it("keeps review and approval explicit for a prepared version", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 2,
            lifecycle: "prepared",
            reviewUrl: "/api/documents/report",
          },
        ])}
      />,
    );

    expect(html).toContain("Generate new version");
    expect(html).toContain("Review");
    expect(html).toContain("Approve");
    expect(html).toContain("Review version 2, then approve it.");
  });

  it("withholds generation until the live statement has entries", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canGenerate={false}
        generationUnavailableReason="Add a live GHG Entry before generating a report."
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).not.toContain("Generate report");
    expect(html).toContain("Add a live GHG Entry before generating a report.");
  });

  it("surfaces the verifier step detail next to the step", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        verifierStep={{
          status: "met",
          detail: "In verification. No action is needed.",
        }}
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 1,
            lifecycle: "submitted",
            reviewUrl: "/api/documents/report",
          },
        ])}
      />,
    );

    expect(html).toContain("In verification. No action is needed.");
    expect(html).toContain("Version 1 approved.");
  });

  it("renders the inline submit action on the verifier step when submittable", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        verifierStep={{
          status: "active",
          detail: "Submit the approved report to the verifier.",
        }}
        onSubmit={() => undefined}
        submitLabel="Submit"
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 1,
            lifecycle: "approved",
            reviewUrl: "/api/documents/report",
          },
        ])}
      />,
    );

    expect(html).toContain("Submit the approved report to the verifier.");
    expect(html).toContain(">Submit<");
  });

  it("collapses older report versions behind a disclosure", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 2,
            lifecycle: "prepared",
            reviewUrl: "/api/documents/report-2",
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            version: 1,
            lifecycle: "approved",
            reviewUrl: "/api/documents/report-1",
          },
        ])}
      />,
    );

    expect(html).toContain("All report versions (2)");
    expect(html).toContain("<details");
  });
});
