import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  findApprovedGhgStatementReport,
  GhgStatementWorkflow,
} from "./ghg-statement-workflow";

vi.mock("@/hooks/use-certification", () => ({
  useGhgStatementReports: vi.fn(),
}));

function reportsQuery(data: unknown[]) {
  return {
    isLoading: false,
    error: null,
    data,
  } as never;
}

function failedReportsQuery() {
  return {
    isLoading: false,
    error: new Error("unavailable"),
    data: undefined,
  } as never;
}

function failedReportsRefresh(data: unknown[]) {
  return {
    isLoading: false,
    isFetching: false,
    error: new Error("unavailable"),
    data,
    refetch: vi.fn(),
  } as never;
}

describe("GhgStatementWorkflow", () => {
  it("does not reuse an older approval after generating a new version", () => {
    expect(
      findApprovedGhgStatementReport([
        {
          id: "report-2",
          version: 2,
          lifecycle: "prepared",
        } as never,
        {
          id: "report-1",
          version: 1,
          lifecycle: "approved",
        } as never,
      ]),
    ).toBeUndefined();
  });

  it("keeps the sheet workflow passive except for its Submit entry point", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        created
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).toContain("Created in registry");
    expect(html).toContain("Report generated");
    expect(html).toContain("Report approved");
    expect(html).toContain("Submitted to verifier");
    expect(html).toContain(
      "The report is generated automatically when you submit.",
    );
    expect(html).toContain(
      "The report is approved automatically when you submit.",
    );
    expect(html).not.toContain(">Generate report<");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="checkbox"');
  });

  it("withholds generation until the live statement has entries", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        created
        canGenerate={false}
        generationUnavailableReason="Submit a Removal in this reporting period before generating a report."
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).not.toContain("Generate report");
    expect(html).toContain(
      "Submit a Removal in this reporting period before generating a report.",
    );
  });

  it("surfaces the verifier step detail next to the step", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
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

  it("keeps all four steps visible when reports cannot be loaded", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        created
        verifierStep={{ status: "skipped" }}
        reportsQuery={failedReportsQuery()}
      />,
    );

    expect(html).toContain("Created in registry");
    expect(html).toContain("Report generated");
    expect(html).toContain("Report approved");
    expect(html).toContain("Submitted to verifier");
    expect(html).toContain(
      "Reports could not be loaded. Refresh the page and try again.",
    );
    expect(html).toContain("Retry");
    expect(html).not.toContain("Generate report");
  });

  it("keeps retained report status after a background refresh fails", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        created
        canGenerate
        verifierStep={{ status: "active" }}
        onSubmit={() => undefined}
        reportsQuery={failedReportsRefresh([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 2,
            lifecycle: "prepared",
            reviewUrl: "/api/documents/report",
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

    expect(html).toContain("Review");
    expect(html).toContain(">Submit<");
    expect(html).toContain(
      "Reports could not be refreshed. Showing the last loaded versions.",
    );
    expect(html).toContain("Retry");
    expect(html).not.toContain("Load the reports before reviewing");
  });

  it("renders the inline submit action on the verifier step when submittable", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
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
