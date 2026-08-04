import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui";
import {
  findApprovedGhgStatementReport,
  GhgStatementWorkflow,
} from "./ghg-statement-workflow";

const prepareMutation = {
  mutate: vi.fn(),
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
  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    prepareMutation.mutateAsync.mockReset();
    prepareMutation.mutate.mockReset();
    approveMutation.mutateAsync.mockReset();
  });

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
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).toContain("Created in registry");
    expect(html).toContain("Report generated");
    expect(html).toContain("Report approved");
    expect(html).toContain("Submitted to verifier");
    expect(html).not.toContain(">Generate report<");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="checkbox"');
  });

  it("renders separate report actions inside the interactive submit flow", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        interactive
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).toContain(">Generate report<");
    expect(html).not.toContain(">Review report<");
    expect(html).not.toContain(">Approve report<");
  });

  it("runs generation from its own step button", async () => {
    prepareMutation.mutateAsync.mockResolvedValue({ id: "report-1" });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementWorkflow
          ghgStatementId="11111111-1111-4111-8111-111111111111"
          created
          canManageReports
          interactive
          verifierStep={{ status: "skipped" }}
          reportsQuery={reportsQuery([])}
        />,
      );
    });

    const generate = renderer!.root
      .findAllByType(Button)
      .find((button) => button.props.children === "Generate report");
    await act(async () => generate?.props.onClick());

    expect(prepareMutation.mutateAsync).toHaveBeenCalledWith({
      ghgStatementId: "11111111-1111-4111-8111-111111111111",
      preparationKey: expect.any(String),
    });
    await act(async () => renderer?.unmount());
  });

  it("requires Review report before Approve report", async () => {
    approveMutation.mutateAsync.mockResolvedValue({ id: "report-2" });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementWorkflow
          ghgStatementId="11111111-1111-4111-8111-111111111111"
          created
          canManageReports
          interactive
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
    });

    const review = renderer!.root
      .findAllByType("a")
      .find((link) => link.props.children === "Review report");
    let approve = renderer!.root
      .findAllByType(Button)
      .find((button) => button.props.children === "Approve report");
    expect(approve?.props.disabled).toBe(true);

    await act(async () => review?.props.onClick());
    approve = renderer!.root
      .findAllByType(Button)
      .find((button) => button.props.children === "Approve report");
    expect(approve?.props.disabled).toBe(false);
    await act(async () => approve?.props.onClick());

    expect(approveMutation.mutateAsync).toHaveBeenCalledWith({
      ghgStatementId: "11111111-1111-4111-8111-111111111111",
      reportId: "22222222-2222-4222-8222-222222222222",
      version: 2,
    });
    await act(async () => renderer?.unmount());
  });

  it("keeps review and approval explicit for a prepared version", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        interactive
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
    expect(html).toContain("Review report");
    expect(html).toContain("Approve report");
    expect(html).toContain("Review version 2, then approve it.");
  });

  it("withholds generation until the live statement has entries", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        canGenerate={false}
        interactive
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
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        interactive
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
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
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

  it("keeps retained report actions after a background refresh fails", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        canGenerate
        interactive
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

    expect(html).toContain("Generate new version");
    expect(html).toContain("Review");
    expect(html).toContain("Approve");
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
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
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
        canManageReports
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
